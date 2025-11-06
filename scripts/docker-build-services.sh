#!/usr/bin/env bash
set -euo pipefail

# Builds the modular AppHub service images defined in docker/Dockerfile.services.
# Customise the image prefix/tag via APPHUB_IMAGE_PREFIX and APPHUB_IMAGE_TAG.

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd -- "${SCRIPT_DIR}/.." && pwd)

IMAGE_PREFIX=${APPHUB_IMAGE_PREFIX:-apphub}
IMAGE_TAG=${APPHUB_IMAGE_TAG:-dev}
BUILD_ARGS=()

if [[ -n "${VITE_API_BASE_URL:-}" ]]; then
  BUILD_ARGS+=("--build-arg" "VITE_API_BASE_URL=${VITE_API_BASE_URL}")
fi

# Allow Dockerfile to skip missing optional dependency metadata gracefully.
# When this flag is unset (default), we pass a build arg that tells the helper
# script inside docker/Dockerfile.services to ignore missing optional deps
# instead of failing the build. Opt-in failure behaviour remains available by
# setting DOCKER_OPTIONAL_DEPS_FAIL=true before invoking this script.
if [[ "${DOCKER_OPTIONAL_DEPS_FAIL:-false}" != "true" ]]; then
  BUILD_ARGS+=("--build-arg" "OPTIONAL_DEPS_SHOULD_FAIL=false")
fi

# target:repo suffix
declare -a TARGETS=(
  "core-runtime:core"
  "metastore-runtime:metastore"
  "filestore-runtime:filestore"
  "timestore-runtime:timestore"
  "frontend-runtime:frontend"
  "website-runtime:website"
)

for descriptor in "${TARGETS[@]}"; do
  stage="${descriptor%%:*}"
  name="${descriptor##*:}"
  image_ref="${IMAGE_PREFIX}/${name}:${IMAGE_TAG}"
  echo "[docker-build-services] Building ${image_ref} (target ${stage})"
  if ((${#BUILD_ARGS[@]})); then
    docker build \
      "${BUILD_ARGS[@]}" \
      --target "${stage}" \
      -t "${image_ref}" \
      -f "${REPO_ROOT}/docker/Dockerfile.services" \
      "${REPO_ROOT}"
  else
    docker build \
      --target "${stage}" \
      -t "${image_ref}" \
      -f "${REPO_ROOT}/docker/Dockerfile.services" \
      "${REPO_ROOT}"
  fi
  echo "[docker-build-services] Built ${image_ref}"
done
