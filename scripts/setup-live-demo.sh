#!/usr/bin/env bash
set -euo pipefail

LIVE_ROOT="${TAKCLI_LIVE_DEMO_ROOT:-/tmp/takcli-live-demo}"
CERTS_DIR="${LIVE_ROOT}/certs"
CONTAINER_NAME="${TAKCLI_LIVE_DEMO_CONTAINER:-}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

detect_container() {
  docker ps --format '{{.Names}}\t{{.Image}}' \
    | awk -F '\t' '
        $1 ~ /takserver/ || $2 ~ /takserver/ {
          print $1
          exit
        }
      '
}

copy_file_from_container() {
  local source_path="$1"
  local destination_path="$2"

  docker exec "${CONTAINER_NAME}" sh -lc "cat '${source_path}'" > "${destination_path}"
}

require_command docker

if [[ -z "${CONTAINER_NAME}" ]]; then
  CONTAINER_NAME="$(detect_container)"
fi

if [[ -z "${CONTAINER_NAME}" ]]; then
  echo "Unable to find a running TAK Server container. Set TAKCLI_LIVE_DEMO_CONTAINER explicitly." >&2
  exit 1
fi

mkdir -p "${CERTS_DIR}"
copy_file_from_container "/opt/tak/certs/files/admin.pem" "${CERTS_DIR}/admin.pem"
copy_file_from_container "/opt/tak/certs/files/admin.unencrypted.key" "${CERTS_DIR}/admin.key"
copy_file_from_container "/opt/tak/certs/files/ca.pem" "${CERTS_DIR}/ca.pem"
chmod 600 "${CERTS_DIR}/admin.key"

cat <<EOF
Prepared live demo assets in ${LIVE_ROOT}
TAK Server container: ${CONTAINER_NAME}
Client cert: ${CERTS_DIR}/admin.pem
Client key: ${CERTS_DIR}/admin.key
CA file: ${CERTS_DIR}/ca.pem
EOF
