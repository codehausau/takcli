#!/usr/bin/env bash

set -e

TR=/opt/tak
CR=${TR}/certs
CONFIG=${TR}/data/CoreConfig.xml
TAKIGNITECONFIG=${TR}/data/TAKIgniteConfig.xml
CONFIG_PID=null
MESSAGING_PID=null
API_PID=null
PM_PID=null
POSTGRES_HOST=${POSTGRES_HOST:-takdb}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
ADMIN_BOOTSTRAP_DELAY_SECONDS=${ADMIN_BOOTSTRAP_DELAY_SECONDS:-5}
ADMIN_BOOTSTRAP_ATTEMPTS=${ADMIN_BOOTSTRAP_ATTEMPTS:-60}
MESSAGING_READY_PATTERN=${MESSAGING_READY_PATTERN:-Server started}

check_env_var() {
	if [[ "${!1}" == "" ]];then
		echo The environment variable "${1}" must be set for ${2}!
		exit 1
	fi
}

kill() {
	echo Please wait a moment. It may take serveral seconds to fully shut down TAKServer.

    if [ $CONFIG_PID != null ];then
        kill $CONFIG_PID
    fi

    if [ $MESSAGING_PID != null ];then
        kill $MESSAGING_PID
    fi

    if [ $API_PID != null ];then
        kill $API_PID
    fi

    if [ $PM_PID != null ];then
        kill $PM_PID
    fi

}

wait_for_admin_ready_log() {
    local log_file="${TR}/data/logs/takserver-messaging.log"
    local attempt=1

    while [[ $attempt -le $ADMIN_BOOTSTRAP_ATTEMPTS ]]; do
        if [[ -f "$log_file" ]] && grep -q "$MESSAGING_READY_PATTERN" "$log_file"; then
            return 0
        fi

        echo "Waiting for TAK messaging to report ready (${attempt}/${ADMIN_BOOTSTRAP_ATTEMPTS})..."
        sleep "$ADMIN_BOOTSTRAP_DELAY_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "TAK messaging did not report ready within the expected time window." >&2
    return 1
}

enable_admin_user() {
    local attempt=1
    local admin_cert="/opt/tak/certs/files/${ADMIN_CERT_NAME}.pem"

    while [[ $attempt -le $ADMIN_BOOTSTRAP_ATTEMPTS ]]; do
        if java -jar /opt/tak/utils/UserManager.jar certmod -A "$admin_cert"; then
            echo ADMIN USER ADDED
            return 0
        fi

        echo "Admin bootstrap is not ready yet (${attempt}/${ADMIN_BOOTSTRAP_ATTEMPTS}); retrying..."
        sleep "$ADMIN_BOOTSTRAP_DELAY_SECONDS"
        attempt=$((attempt + 1))
    done

    echo "Failed to add the admin user after ${ADMIN_BOOTSTRAP_ATTEMPTS} attempts." >&2
    return 1
}

trap kill SIGINT
trap kill SIGTERM

check_env_var POSTGRES_DB "the database connection if TAKSERVER_NO_DB is not set to true!"
check_env_var POSTGRES_USER "the database connection if TAKSERVER_NO_DB is not set to true!"
check_env_var POSTGRES_PASSWORD "the database connection if TAKSERVER_NO_DB is not set to true!"
check_env_var CA_NAME " the Certificate Authority Name"
check_env_var CA_PASS " the Certificate Authority Password"
check_env_var STATE "the Certificate Authority generation"
check_env_var CITY "the Certificate Authority generation"
check_env_var ORGANIZATION "the Certificate Authority generation"
check_env_var ORGANIZATIONAL_UNIT "the Certificate Authority generation"
check_env_var ADMIN_CERT_NAME "the TAKServer management certificate"
check_env_var ADMIN_CERT_PASS "the TAKServer management certificate password"
check_env_var TAKSERVER_CERT_PASS "the TAKServer instance certificate password"

if [[ ! -d "${TR}/data/certs" ]];then
	mkdir "${TR}/data/certs"
fi
if [[ -z "$(ls -A "${TR}/data/certs")" ]];then
	echo Copying initial certificate configuration
	cp -R ${TR}/certs/* ${TR}/data/certs/
else
	echo Using existing certificates.
fi

mv ${TR}/certs ${TR}/certs.orig
ln -s "${TR}/data/certs" "${TR}/certs"

if [[ ! -f "${CONFIG}" ]];then
	echo Copying initial CoreConfig.xml
	if [[ -f "${TR}/CoreConfig.xml" ]];then
		cp ${TR}/CoreConfig.xml ${CONFIG}
		mv ${TR}/CoreConfig.xml ${TR}/CoreConfig.xml.orig
	else
		cp ${TR}/CoreConfig.example.xml ${CONFIG}
	fi
else
	echo Using existing CoreConfig.xml.
fi

if [[ ! -f "${TAKIGNITECONFIG}" ]];then
	echo Copying initial TAKIgniteConfig.xml
	if [[ -f "${TR}/TAKIgniteConfig.xml" ]];then
		cp ${TR}/TAKIgniteConfig.xml ${TAKIGNITECONFIG}
		mv ${TR}/TAKIgniteConfig.xml ${TR}/CoreConfig.xml.orig
	else
		cp ${TR}/TAKIgniteConfig.example.xml ${TAKIGNITECONFIG}
	fi
else
	echo Using existing TAKIgniteConfig.xml.
fi

ln -s "${TR}/data/logs" "${TR}/logs"

cd ${CR}

if [[ ! -f "${CR}/files/root-ca.pem" ]];then
	CAPASS=${CA_PASS} bash /opt/tak/certs/makeRootCa.sh --ca-name "${CA_NAME}"
else
	echo Using existing root CA.
fi

if [[ ! -f "${CR}/files/intermediate-signing.jks" ]];then
  echo "Making new signing certificate."
  export CAPASS=${CA_PASS}
  yes | /opt/tak/certs/makeCert.sh ca intermediate
else
  echo "Using existing intermediate CA certificate."
fi

if [[ ! -f "${CR}/files/takserver.pem" ]];then
	CAPASS=${CA_PASS} PASS="${TAKSERVER_CERT_PASS}" bash /opt/tak/certs/makeCert.sh server takserver
else
	echo Using existing takserver certificate.
fi

if [[ ! -f "${CR}/files/${ADMIN_CERT_NAME}.pem" ]];then
	CAPASS=${CA_PASS} PASS="${ADMIN_CERT_PASS}" bash /opt/tak/certs/makeCert.sh client "${ADMIN_CERT_NAME}"
else
	echo Using existing ${ADMIN_CERT_NAME} certificate.
fi

chmod -R 777 ${TR}/data/

if [[ -z "${POSTGRES_URL:-}" ]]; then
    export POSTGRES_URL="jdbc:postgresql://${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
fi

python3 ${TR}/coreConfigEnvHelper.py "${CONFIG}" "${CONFIG}"

sleep 8

java -jar ${TR}/db-utils/SchemaManager.jar -url jdbc:postgresql://${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB} -user ${POSTGRES_USER} -password ${POSTGRES_PASSWORD} upgrade
sleep 4

cd ${TR}

. ./setenv.sh

java -jar -Xmx${CONFIG_MAX_HEAP}m -Dspring.profiles.active=config takserver.war &
CONFIG_PID=$!
java -jar -Xmx${MESSAGING_MAX_HEAP}m -Dspring.profiles.active=messaging takserver.war &
MESSAGING_PID=$!
java -jar -Xmx${API_MAX_HEAP}m -Dspring.profiles.active=api -Dkeystore.pkcs12.legacy takserver.war &
API_PID=$!
java -jar -Xmx${PLUGIN_MANAGER_MAX_HEAP}m -Dloader.path=WEB-INF/lib-provided,WEB-INF/lib,WEB-INF/classes,file:lib/ takserver-pm.jar &
PM_PID=$!

echo  -e "\033[33;5mWAITING FOR THE SERVER TO START UP BEFORE ADDING THE ADMIN USER...\033[0m"
wait_for_admin_ready_log
TAKCL_CORECONFIG_PATH="${CONFIG}"
TAKCL_TAKIGNITECONFIG_PATH="${TAKIGNITECONFIG}"
enable_admin_user

wait $PM_PID
