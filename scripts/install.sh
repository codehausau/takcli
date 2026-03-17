#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="${TAKCLI_NPM_PACKAGE:-@codehaus-au/takcli}"
INSTALL_SOURCE="${TAKCLI_INSTALL_SOURCE:-}"
NPM_PREFIX="${TAKCLI_NPM_PREFIX:-$HOME/.local}"
VERSION="${TAKCLI_VERSION:-latest}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to install TAKCLI." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to install TAKCLI." >&2
  exit 1
fi

mkdir -p "${NPM_PREFIX}"

if [[ -n "${INSTALL_SOURCE}" ]]; then
  PACKAGE_SPEC="${INSTALL_SOURCE}"
elif [[ "${VERSION}" == "latest" ]]; then
  PACKAGE_SPEC="${PACKAGE_NAME}"
else
  PACKAGE_SPEC="${PACKAGE_NAME}@${VERSION}"
fi

echo "Installing ${PACKAGE_SPEC} into ${NPM_PREFIX}..."
npm install --global --prefix "${NPM_PREFIX}" "${PACKAGE_SPEC}"

BIN_PATH="${NPM_PREFIX}/bin"
echo
echo "TAKCLI installed."
echo "Binary path: ${BIN_PATH}/takcli"

case ":${PATH}:" in
  *":${BIN_PATH}:"*)
    ;;
  *)
    echo "Add ${BIN_PATH} to your PATH if it is not already available."
    ;;
esac
