#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAPE_PATH="${1:-docs/demos/readme-live.tape}"
TMP_ROOT="${TMPDIR:-/tmp}"
DEMO_ROOT="${TMP_ROOT}/takcli-live-render"
DEMO_PACK_DIR="${DEMO_ROOT}/pack"
DEMO_HOME="${DEMO_ROOT}/home"
DEMO_FAKE_BIN="${DEMO_ROOT}/fake-bin"
TAKCLI_FAKE_SERVER_REPO="${TMP_ROOT}/takcli-demo-repo"
LIVE_ROOT="${TAKCLI_LIVE_DEMO_ROOT:-/tmp/takcli-live-demo}"
TAK_CONTAINER="${TAKCLI_LIVE_DEMO_CONTAINER:-}"
RENDER_IMAGE="${TAKCLI_LIVE_RENDER_IMAGE:-takcli-live-demo-renderer:local}"

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

detect_network() {
  local container_name="$1"
  docker inspect "$container_name" --format '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' | head -n 1
}

cd "${REPO_ROOT}"

if [[ ! -f "${TAPE_PATH}" ]]; then
  echo "Tape not found: ${TAPE_PATH}" >&2
  exit 1
fi

require_command docker
require_command npm
require_command pnpm

if [[ -z "${TAK_CONTAINER}" ]]; then
  TAK_CONTAINER="$(detect_container)"
fi

if [[ -z "${TAK_CONTAINER}" ]]; then
  echo "Unable to find a running TAK Server container. Set TAKCLI_LIVE_DEMO_CONTAINER explicitly." >&2
  exit 1
fi

TAK_NETWORK="${TAKCLI_LIVE_DEMO_NETWORK:-$(detect_network "${TAK_CONTAINER}")}"

if [[ -z "${TAK_NETWORK}" ]]; then
  echo "Unable to determine the TAK Server Docker network. Set TAKCLI_LIVE_DEMO_NETWORK explicitly." >&2
  exit 1
fi

rm -rf "${DEMO_ROOT}" "${TAKCLI_FAKE_SERVER_REPO}"
mkdir -p "${DEMO_PACK_DIR}" "${DEMO_HOME}" "${DEMO_FAKE_BIN}"

cleanup() {
  rm -rf "${DEMO_ROOT}" "${LIVE_ROOT}" "${TAKCLI_FAKE_SERVER_REPO}"
}

trap cleanup EXIT

pnpm pack --pack-destination "${DEMO_PACK_DIR}" >/dev/null
TAKCLI_DEMO_TARBALL="$(find "${DEMO_PACK_DIR}" -maxdepth 1 -name '*.tgz' | head -n 1)"

if [[ -z "${TAKCLI_DEMO_TARBALL}" ]]; then
  echo "Failed to create demo tarball." >&2
  exit 1
fi

"${REPO_ROOT}/scripts/setup-live-demo.sh" >/dev/null
"${REPO_ROOT}/scripts/create-demo-deploy-repo.sh" "${TAKCLI_FAKE_SERVER_REPO}" >/dev/null
mkdir -p "${DEMO_FAKE_BIN}"

cat > "${DEMO_FAKE_BIN}/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  --version)
    printf 'Docker version 27.0.0, build demo\n'
    ;;
  compose)
    shift
    case "${1:-}" in
      version)
        printf 'Docker Compose version v2.27.0\n'
        ;;
      *)
        printf 'demo docker shim only supports "docker compose version"\n' >&2
        exit 1
        ;;
    esac
    ;;
  *)
    printf 'demo docker shim only supports version probes used by the README render\n' >&2
    exit 1
    ;;
esac
EOF
chmod +x "${DEMO_FAKE_BIN}/docker"

cat > "${DEMO_FAKE_BIN}/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

resolve_head() {
  local repo_path="$1"
  local git_dir="${repo_path}/.git"
  local head_file="${git_dir}/HEAD"

  if [[ ! -f "${head_file}" ]]; then
    return 1
  fi

  local head_value
  head_value="$(cat "${head_file}")"

  if [[ "${head_value}" == ref:\ * ]]; then
    local ref_path="${git_dir}/${head_value#ref: }"
    [[ -f "${ref_path}" ]] || return 1
    cat "${ref_path}"
    return 0
  fi

  printf '%s\n' "${head_value}"
}

if [[ "${1:-}" == "--version" ]]; then
  printf 'git version 2.45.0-demo\n'
  exit 0
fi

if [[ "${1:-}" == "-C" ]]; then
  repo_path="${2:-}"
  shift 2

  case "${1:-}" in
    rev-parse)
      if [[ "${2:-}" != "HEAD" ]]; then
        printf 'demo git shim only supports "git -C <path> rev-parse HEAD"\n' >&2
        exit 1
      fi
      resolve_head "${repo_path}"
      exit 0
      ;;
    checkout)
      if [[ "${2:-}" != "--detach" ]]; then
        printf 'demo git shim only supports detached checkouts\n' >&2
        exit 1
      fi
      commit="${3:-}"
      mkdir -p "${repo_path}/.git"
      printf '%s\n' "${commit}" > "${repo_path}/.git/HEAD"
      exit 0
      ;;
    *)
      printf 'demo git shim only supports rev-parse and checkout probes used by the README render\n' >&2
      exit 1
      ;;
  esac
fi

if [[ "${1:-}" == "clone" ]]; then
  shift

  repo_url=""
  clone_path=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --quiet|--single-branch)
        shift
        ;;
      --branch|--depth)
        shift 2
        ;;
      *)
        if [[ -z "${repo_url}" ]]; then
          repo_url="$1"
        elif [[ -z "${clone_path}" ]]; then
          clone_path="$1"
        else
          printf 'unexpected extra argument for demo git clone shim: %s\n' "$1" >&2
          exit 1
        fi
        shift
        ;;
    esac
  done

  if [[ -z "${repo_url}" || -z "${clone_path}" ]]; then
    printf 'demo git shim expected source and destination for clone\n' >&2
    exit 1
  fi

  mkdir -p "$(dirname "${clone_path}")"
  cp -a "${repo_url}" "${clone_path}"
  exit 0
fi

printf 'demo git shim only supports the clone/check/rev-parse calls used by the README render\n' >&2
exit 1
EOF
chmod +x "${DEMO_FAKE_BIN}/git"

docker build -f "${REPO_ROOT}/scripts/assets/vhs-live-renderer.Dockerfile" -t "${RENDER_IMAGE}" "${REPO_ROOT}" >/dev/null

echo "Rendering ${TAPE_PATH} inside ${RENDER_IMAGE} on network ${TAK_NETWORK}"
docker run --rm \
  --network "${TAK_NETWORK}" \
  -e HOME=/tmp/demo-home \
  -e TAKCLI_CONFIG=/tmp/demo-home/config.yaml \
  -e NPM_CONFIG_PREFIX=/tmp/demo-home/.local \
  -u "$(id -u):$(id -g)" \
  -v "${REPO_ROOT}:/repo" \
  -v "${DEMO_HOME}:/tmp/demo-home" \
  -v "${DEMO_FAKE_BIN}:${DEMO_FAKE_BIN}" \
  -v "${DEMO_PACK_DIR}:/packages" \
  -v "${TAKCLI_FAKE_SERVER_REPO}:${TAKCLI_FAKE_SERVER_REPO}" \
  -v "${LIVE_ROOT}:/tmp/takcli-live-demo" \
  -w /repo \
  --entrypoint /bin/bash \
  "${RENDER_IMAGE}" \
  -lc "
    set -euo pipefail
    export HOME=/tmp/demo-home
    export NPM_CONFIG_PREFIX=\"\$HOME/.local\"
    export PATH=\"${DEMO_FAKE_BIN}:\$NPM_CONFIG_PREFIX/bin:/usr/local/bin:/usr/bin:/bin\"
    mkdir -p \"\$HOME\" \"\$NPM_CONFIG_PREFIX\"
    npm install -g /packages/*.tgz >/dev/null
    takcli profile add live-demo \
      --server https://takserver:8443 \
      --api-port 8443 \
      --cot-port 8089 \
      --cert-file /tmp/takcli-live-demo/certs/admin.pem \
      --key-file /tmp/takcli-live-demo/certs/admin.key \
      --insecure \
      --set-current >/dev/null
    takcli users delete readme-demo >/dev/null 2>&1 || true
    vhs /repo/${TAPE_PATH}
  "
