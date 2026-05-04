#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Build and optionally push unhardened TAK Server Docker images from a tak-server checkout.

Usage:
  build-unhardened-takserver-images.sh [options]

Options:
  --tak-server-repo <path>    Path to the tak-server repository.
                              Default: /workspaces/tak/tak-server
  --tag <tag>                 Image tag to publish. If omitted, tries the exact git tag on HEAD.
  --image-prefix <prefix>     Registry/repository prefix.
                              Default: docker.io/codehausau
  --platforms <list>          Comma-separated target platforms for docker buildx.
                              Default: linux/amd64,linux/arm64
  --workspace <path>          Reuse a workspace directory instead of a temporary one.
  --push                      Push images after building them.
  --tag-latest                Also tag and optionally push :latest.
  --skip-gradle               Reuse existing tak-server build outputs.
  --assemble-only             Assemble the Docker build context but do not build images.
  --help                      Show this help.

Examples:
  ./scripts/build-unhardened-takserver-images.sh \
    --tak-server-repo /path/to/tak-server \
    --tag 5.2-RELEASE-16 \
    --image-prefix docker.io/codehausau

  ./scripts/build-unhardened-takserver-images.sh \
    --tak-server-repo /path/to/tak-server \
    --tag 5.2-RELEASE-16 \
    --platforms linux/amd64,linux/arm64 \
    --image-prefix docker.io/codehausau \
    --push \
    --tag-latest
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$1" >&2
    exit 1
  fi
}

select_java_home() {
  local candidates=(
    "${JAVA17_HOME:-}"
    "/usr/lib/jvm/java-17-openjdk-amd64"
    "/usr/lib/jvm/java-1.17.0-openjdk-amd64"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate/bin/java" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

copy_directory_contents() {
  local source_dir="$1"
  local destination_dir="$2"

  mkdir -p "$destination_dir"
  cp -R "$source_dir"/. "$destination_dir"/
}

resolve_default_tag() {
  local repo="$1"

  if git -C "$repo" describe --tags --exact-match >/dev/null 2>&1; then
    git -C "$repo" describe --tags --exact-match
    return 0
  fi

  return 1
}

normalize_platforms() {
  printf '%s' "$1" | tr -d '[:space:]'
}

is_multi_platform() {
  [[ "$1" == *,* ]]
}

ensure_buildx() {
  if ! docker buildx version >/dev/null 2>&1; then
    printf 'Missing required Docker Buildx support. Install or enable docker buildx before building.\n' >&2
    exit 1
  fi

  if ! docker buildx inspect >/dev/null 2>&1; then
    printf 'Unable to find an active docker buildx builder. Create one with `docker buildx create --use` and retry.\n' >&2
    exit 1
  fi

  docker buildx inspect --bootstrap >/dev/null
}

build_image() {
  local dockerfile_path="$1"
  local primary_tag="$2"
  local latest_tag="${3:-}"
  local archive_path="${4:-}"
  local -a cmd=(
    docker buildx build
    --platform "$PLATFORMS"
    -f "$dockerfile_path"
    -t "$primary_tag"
  )

  if [[ -n "$latest_tag" ]]; then
    cmd+=(-t "$latest_tag")
  fi

  if [[ "$PUSH" -eq 1 ]]; then
    cmd+=(--push)
  elif is_multi_platform "$PLATFORMS"; then
    cmd+=(--output "type=oci,dest=$archive_path")
  else
    cmd+=(--load)
  fi

  cmd+=("$CONTEXT_DIR")
  "${cmd[@]}"
}

TAK_SERVER_REPO="/workspaces/tak/tak-server"
IMAGE_PREFIX="docker.io/codehausau"
PLATFORMS="linux/amd64,linux/arm64"
WORKSPACE=""
TAG=""
PUSH=0
TAG_LATEST=0
SKIP_GRADLE=0
ASSEMBLE_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tak-server-repo)
      TAK_SERVER_REPO="$2"
      shift 2
      ;;
    --tag)
      TAG="$2"
      shift 2
      ;;
    --image-prefix)
      IMAGE_PREFIX="$2"
      shift 2
      ;;
    --platforms)
      PLATFORMS="$2"
      shift 2
      ;;
    --workspace)
      WORKSPACE="$2"
      shift 2
      ;;
    --push)
      PUSH=1
      shift
      ;;
    --tag-latest)
      TAG_LATEST=1
      shift
      ;;
    --skip-gradle)
      SKIP_GRADLE=1
      shift
      ;;
    --assemble-only)
      ASSEMBLE_ONLY=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command git
require_command docker
require_command find
require_command mktemp
require_command tr

PLATFORMS="$(normalize_platforms "$PLATFORMS")"
if [[ -z "$PLATFORMS" ]]; then
  printf 'Expected at least one target platform. Pass --platforms <platform[,platform...]>\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTRYPOINT_OVERLAY="$SCRIPT_DIR/assets/unhardened-takserver-entrypoint.sh"

if [[ ! -d "$TAK_SERVER_REPO/.git" ]]; then
  printf 'Expected a git checkout at %s\n' "$TAK_SERVER_REPO" >&2
  exit 1
fi

if [[ ! -f "$ENTRYPOINT_OVERLAY" ]]; then
  printf 'Expected the TAKCLI entrypoint overlay at %s\n' "$ENTRYPOINT_OVERLAY" >&2
  exit 1
fi

if [[ -z "$TAG" ]]; then
  if ! TAG="$(resolve_default_tag "$TAK_SERVER_REPO")"; then
    printf 'Unable to infer an image tag from git. Pass --tag <release-tag>.\n' >&2
    exit 1
  fi
fi

if [[ -n "$WORKSPACE" ]]; then
  mkdir -p "$WORKSPACE"
  CLEANUP_WORKSPACE=0
else
  WORKSPACE="$(mktemp -d "${TMPDIR:-/tmp}/takcli-unhardened-images-XXXXXX")"
  CLEANUP_WORKSPACE=1
fi

cleanup() {
  if [[ "$CLEANUP_WORKSPACE" -eq 1 ]]; then
    rm -rf "$WORKSPACE"
  fi
}

trap cleanup EXIT

SRC_DIR="$TAK_SERVER_REPO/src"
CLUSTER_BUILD_DIR="$SRC_DIR/takserver-cluster/build"
CORE_BUILD_DIR="$CLUSTER_BUILD_DIR/takserver-core"
SCHEMA_BUILD_DIR="$CLUSTER_BUILD_DIR/takserver-schemamanager"
USERMANAGER_BUILD_DIR="$CLUSTER_BUILD_DIR/takserver-usermanager"

if [[ "$SKIP_GRADLE" -eq 0 ]]; then
  require_command bash
  JAVA_HOME_FOR_BUILD="$(select_java_home || true)"
  if [[ -z "$JAVA_HOME_FOR_BUILD" ]]; then
    printf 'Unable to find a Java 17 runtime. Set JAVA17_HOME or install JDK 17 before building.\n' >&2
    exit 1
  fi
  printf 'Building cluster packaging artifacts from %s\n' "$SRC_DIR"
  (
    cd "$SRC_DIR"
    export JAVA_HOME="$JAVA_HOME_FOR_BUILD"
    export PATH="$JAVA_HOME/bin:$PATH"
    ./gradlew :takserver-cluster:buildCluster
  )
fi

WAR_FILE="$(find "$CORE_BUILD_DIR" -maxdepth 1 -type f -name 'takserver-core-*.war' | head -n 1)"
PLUGIN_MANAGER_JAR="$CORE_BUILD_DIR/takserver-pm.jar"
SCHEMA_MANAGER_JAR="$SCHEMA_BUILD_DIR/SchemaManager.jar"
USER_MANAGER_JAR="$USERMANAGER_BUILD_DIR/UserManager.jar"

for required_path in \
  "$WAR_FILE" \
  "$PLUGIN_MANAGER_JAR" \
  "$SCHEMA_MANAGER_JAR" \
  "$USER_MANAGER_JAR" \
  "$SRC_DIR/takserver-core/docker/full/Dockerfile.takserver" \
  "$SRC_DIR/takserver-schemamanager/docker/Dockerfile.takserver-db" \
  "$SRC_DIR/takserver-core/docker/full/docker_entrypoint.sh" \
  "$SRC_DIR/takserver-core/docker/full/coreConfigEnvHelper.py" \
  "$SRC_DIR/takserver-schemamanager/docker/configureInDocker.sh" \
  "$SRC_DIR/takserver-schemamanager/docker/pg_hba.conf" \
  "$SRC_DIR/takserver-schemamanager/docker/postgresql.conf" \
  "$SRC_DIR/takserver-core/example/CoreConfig.example.docker.xml" \
  "$SRC_DIR/takserver-core/example/TAKIgniteConfig.example.xml" \
  "$SRC_DIR/takserver-core/example/UserAuthenticationFile.cluster.xml" \
  "$SRC_DIR/takserver-core/example/logging-restrictsize.xml" \
  "$SRC_DIR/takserver-core/scripts"; do
  if [[ ! -e "$required_path" ]]; then
    printf 'Required path is missing: %s\n' "$required_path" >&2
    exit 1
  fi
done

CONTEXT_DIR="$WORKSPACE/context"
DOCKER_DIR="$CONTEXT_DIR/docker"
TAK_DIR="$CONTEXT_DIR/tak"
DB_UTILS_DIR="$TAK_DIR/db-utils"
UTILS_DIR="$TAK_DIR/utils"

rm -rf "$CONTEXT_DIR"
mkdir -p "$DOCKER_DIR" "$DB_UTILS_DIR" "$UTILS_DIR" "$TAK_DIR/data/certs" "$TAK_DIR/data/logs" "$TAK_DIR/certs/files"

cp "$SRC_DIR/takserver-core/docker/full/Dockerfile.takserver" "$DOCKER_DIR/Dockerfile.takserver"
cp "$SRC_DIR/takserver-schemamanager/docker/Dockerfile.takserver-db" "$DOCKER_DIR/Dockerfile.takserver-db"

copy_directory_contents "$SRC_DIR/takserver-core/scripts" "$TAK_DIR"

cp "$ENTRYPOINT_OVERLAY" "$TAK_DIR/docker_entrypoint.sh"
cp "$SRC_DIR/takserver-core/docker/full/coreConfigEnvHelper.py" "$TAK_DIR/coreConfigEnvHelper.py"
cp "$SRC_DIR/takserver-core/docker/configureInDocker.sh" "$TAK_DIR/configureInDocker.sh"
cp "$SRC_DIR/takserver-core/example/CoreConfig.example.docker.xml" "$TAK_DIR/CoreConfig.example.xml"
cp "$SRC_DIR/takserver-core/example/TAKIgniteConfig.example.xml" "$TAK_DIR/TAKIgniteConfig.example.xml"
cp "$SRC_DIR/takserver-core/example/UserAuthenticationFile.cluster.xml" "$TAK_DIR/UserAuthenticationFile.xml"
cp "$SRC_DIR/takserver-core/example/logging-restrictsize.xml" "$TAK_DIR/logging-restrictsize.xml"

cp "$WAR_FILE" "$TAK_DIR/takserver.war"
cp "$PLUGIN_MANAGER_JAR" "$TAK_DIR/takserver-pm.jar"
cp "$SCHEMA_MANAGER_JAR" "$DB_UTILS_DIR/SchemaManager.jar"
cp "$SRC_DIR/takserver-schemamanager/docker/configureInDocker.sh" "$DB_UTILS_DIR/configureInDocker.sh"
cp "$SRC_DIR/takserver-schemamanager/docker/pg_hba.conf" "$DB_UTILS_DIR/pg_hba.conf"
cp "$SRC_DIR/takserver-schemamanager/docker/postgresql.conf" "$DB_UTILS_DIR/postgresql.conf"
cp "$USER_MANAGER_JAR" "$UTILS_DIR/UserManager.jar"

printf '%s\n' "$TAG" > "$TAK_DIR/version.txt"

chmod +x "$TAK_DIR/docker_entrypoint.sh" "$TAK_DIR/configureInDocker.sh" "$DB_UTILS_DIR/configureInDocker.sh"

SERVER_IMAGE="${IMAGE_PREFIX%/}/takserver-full:${TAG}"
DB_IMAGE="${IMAGE_PREFIX%/}/takserver-db:${TAG}"

printf 'Assembled Docker context at %s\n' "$CONTEXT_DIR"
printf 'Server image: %s\n' "$SERVER_IMAGE"
printf 'Database image: %s\n' "$DB_IMAGE"

if [[ "$ASSEMBLE_ONLY" -eq 1 ]]; then
  printf 'Skipping docker build because --assemble-only was requested.\n'
  exit 0
fi

if [[ "$PUSH" -eq 0 ]] && is_multi_platform "$PLATFORMS" && [[ "$CLEANUP_WORKSPACE" -eq 1 ]]; then
  CLEANUP_WORKSPACE=0
fi

if [[ "$TAG_LATEST" -eq 1 ]]; then
  SERVER_IMAGE_LATEST="${IMAGE_PREFIX%/}/takserver-full:latest"
  DB_IMAGE_LATEST="${IMAGE_PREFIX%/}/takserver-db:latest"
fi

ensure_buildx

SERVER_ARCHIVE="$WORKSPACE/takserver-full-${TAG}.oci.tar"
DB_ARCHIVE="$WORKSPACE/takserver-db-${TAG}.oci.tar"

build_image "$DOCKER_DIR/Dockerfile.takserver" "$SERVER_IMAGE" "${SERVER_IMAGE_LATEST:-}" "$SERVER_ARCHIVE"
build_image "$DOCKER_DIR/Dockerfile.takserver-db" "$DB_IMAGE" "${DB_IMAGE_LATEST:-}" "$DB_ARCHIVE"

if [[ "$PUSH" -eq 1 ]]; then
  printf 'Pushed multi-platform images for %s\n' "$PLATFORMS"
elif is_multi_platform "$PLATFORMS"; then
  printf 'Exported multi-platform OCI archives:\n'
  printf '  %s\n' "$SERVER_ARCHIVE"
  printf '  %s\n' "$DB_ARCHIVE"
  printf 'Workspace preserved at %s\n' "$WORKSPACE"
else
  printf 'Loaded single-platform images into the local Docker daemon for %s\n' "$PLATFORMS"
fi

printf 'Done.\n'
