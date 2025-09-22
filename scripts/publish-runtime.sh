#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "[publish-runtime] docker CLI is required" >&2
  exit 1
fi

IMAGE_REF=${APPHUB_RUNTIME_IMAGE:-}
if [[ -z "${IMAGE_REF}" ]]; then
  echo "[publish-runtime] Set APPHUB_RUNTIME_IMAGE (e.g. ghcr.io/apphub/runtime)" >&2
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "[publish-runtime] git CLI is required to derive the default tag" >&2
  exit 1
fi

TAG=${APPHUB_RUNTIME_TAG:-$(git rev-parse --short HEAD)}
PUSH_FLAG=${APPHUB_RUNTIME_PUSH:-1}
ALIAS_TAG=${APPHUB_RUNTIME_LATEST_TAG:-}

FULL_REF="${IMAGE_REF}:${TAG}"

echo "[publish-runtime] Building runtime image ${FULL_REF}"
docker build --target runtime -t "${FULL_REF}" .

if [[ -n "${ALIAS_TAG}" ]]; then
  echo "[publish-runtime] Tagging runtime image as ${IMAGE_REF}:${ALIAS_TAG}"
  docker tag "${FULL_REF}" "${IMAGE_REF}:${ALIAS_TAG}"
fi

if [[ "${PUSH_FLAG}" != "0" ]]; then
  echo "[publish-runtime] Pushing ${FULL_REF}"
  docker push "${FULL_REF}"
  if [[ -n "${ALIAS_TAG}" ]]; then
    echo "[publish-runtime] Pushing ${IMAGE_REF}:${ALIAS_TAG}"
    docker push "${IMAGE_REF}:${ALIAS_TAG}"
  fi
else
  echo "[publish-runtime] Skipping push (APPHUB_RUNTIME_PUSH=${PUSH_FLAG})"
fi
