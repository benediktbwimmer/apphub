#!/usr/bin/env bash
set -Euo pipefail

if [[ "${APPHUB_K8S_DISABLE_DEFAULTS:-0}" != "1" ]]; then
  export APPHUB_K8S_BUILDER_SERVICE_ACCOUNT="${APPHUB_K8S_BUILDER_SERVICE_ACCOUNT:-apphub-builder}"
  export APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT="${APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT:-apphub-preview}"
  export APPHUB_K8S_REGISTRY_ENDPOINT="${APPHUB_K8S_REGISTRY_ENDPOINT:-registry.kube-system.svc.cluster.local:5000}"
fi

SMOKE_SCRIPT="/app/services/catalog/dist/scripts/kubernetesSmoke.js"
if [[ -f "${SMOKE_SCRIPT}" ]]; then
  node "${SMOKE_SCRIPT}" --source=entrypoint || true
fi

exec "$@"
