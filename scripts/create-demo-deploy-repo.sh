#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$(mktemp -d "${TMPDIR:-/tmp}/takcli-demo-repo.XXXXXX")}"
COMPOSE_DIR="${REPO_DIR}/src/takserver-core/docker/full"

rm -rf "${REPO_DIR}"
mkdir -p "${COMPOSE_DIR}"

cat > "${COMPOSE_DIR}/docker-compose.yml" <<'EOF'
version: "3.4"
services:
  takserver:
    image: takserver:latest
EOF

cat > "${COMPOSE_DIR}/EDIT_ME.env" <<'EOF'
POSTGRES_PASSWORD=
EOF

git -C "${REPO_DIR}" init >/dev/null 2>&1
git -C "${REPO_DIR}" checkout -b main >/dev/null 2>&1
git -C "${REPO_DIR}" config user.name "TAKCLI Demo"
git -C "${REPO_DIR}" config user.email "takcli-demo@example.invalid"
git -C "${REPO_DIR}" add .
git -C "${REPO_DIR}" commit -m "init" >/dev/null 2>&1

echo "${REPO_DIR}"
