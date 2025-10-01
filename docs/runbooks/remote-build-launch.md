# Remote Build & Launch Platform

Ticket 153 replaced the Docker socket runner with a Kubernetes-first workflow. Core workers now schedule build Jobs and preview Deployments directly in the target cluster so local minikube environments and remote environments share the same orchestration path.

## Prerequisites
- Kubernetes 1.27+ cluster (minikube or managed service).
- Access credentials for the core process (kubeconfig or in-cluster service account).
- Container registry reachable from the cluster. For minikube, enable the built-in registry; for production use your managed registry.
- Kubernetes tooling (`kubectl`, optional `helm`) ships in the core runtime image. If you execute the workers outside the container, ensure `kubectl version --client` succeeds locally.

## Environment Variables

| Variable | Description |
| --- | --- |
| `APPHUB_BUILD_EXECUTION_MODE` | Defaults to `kubernetes`. Set to `docker` for the legacy Docker runner or `stub` to bypass builds. |
| `APPHUB_LAUNCH_EXECUTION_MODE` | Defaults to `kubernetes`. Use `docker` for the old local runner or `stub` to skip launches. |
| `APPHUB_K8S_NAMESPACE` | Namespace used for build Jobs and preview Deployments/Services. |
| `APPHUB_K8S_BUILDER_IMAGE` | Image containing the BuildKit client/logic. Default `ghcr.io/apphub/builder:latest`. |
| `APPHUB_K8S_BUILDER_SERVICE_ACCOUNT` | Service account for build Jobs. Defaults to `apphub-builder`. |
| `APPHUB_K8S_REGISTRY_ENDPOINT` | Registry host:port that builder jobs push to. Defaults to `registry.kube-system.svc.cluster.local:5000` in the runtime entrypoint. |
| `APPHUB_K8S_REGISTRY_SECRET` | Optional image pull secret name exposed to build jobs. |
| `APPHUB_K8S_BUILDKIT_ADDRESS` | Optional BuildKit TCP endpoint override exposed to build jobs. |
| `APPHUB_K8S_BUILD_TIMEOUT_SECONDS` | Max wait for build completion (default 900). |
| `APPHUB_K8S_PREVIEW_URL_TEMPLATE` | Optional preview URL template (for example `https://{launch}.preview.local`). |
| `APPHUB_K8S_PREVIEW_HOST_TEMPLATE` | Alternative host-only template (paired with `APPHUB_K8S_PREVIEW_SCHEME`). |
| `APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT` | Service account for preview Deployments. Defaults to `apphub-preview`. |
| `APPHUB_K8S_INGRESS_CLASS` | Ingress class to use when creating preview routes. |
| `APPHUB_K8S_DISABLE_DEFAULTS` | Set to `1` to disable the entrypoint defaults listed above (registry/service accounts). |
| `APPHUB_K8S_REQUIRE_TOOLING` | Set to `1` to fail startup if the kubectl smoke check reports an error. |

### Kubernetes Tooling Smoke Check

The core runtime image now bundles `kubectl` (1.29) and `helm` (3.14). On startup the container runs `node services/core/dist/scripts/kubernetesSmoke.js`, which executes `kubectl version --client`, verifies the binary is executable, and logs actionable warnings when credentials are missing. Sample output:

```
[core][kubernetes][entrypoint] kubectl client detected (version: v1.29.3)
[core][kubernetes][entrypoint] warning: No Kubernetes credentials detected. Mount a kubeconfig or in-cluster service account.
```

Set `APPHUB_K8S_REQUIRE_TOOLING=1` to fail fast when the smoke check reports errors (for example, when `kubectl` is absent). Use `APPHUB_K8S_DISABLE_DEFAULTS=1` if the minikube defaults conflict with production namespace or registry naming.

## Minikube (local development)

Use the turnkey runner introduced in Tickets 182–185:

```bash
npm run minikube:up
npm run minikube:verify
```

This combination starts minikube (if needed), enables the ingress addon, builds the modular service images, loads them into the cluster cache, applies `infra/minikube`, and validates Redis/Postgres/MinIO plus the HTTP health checks. Review `docs/runbooks/minikube-bootstrap.md` for ingress DNS, troubleshooting, and teardown (`npm run minikube:down`).

Need to iterate rapidly on manifests or reuse existing images? Combine flags:

```bash
npm run minikube:up -- --skip-build --skip-start
```

After bootstrap, the core API and workers read credentials from the manifests (Secrets/ConfigMaps), and build/launch workers rely on the `apphub-builder` and `apphub-preview` service accounts defined in `infra/minikube/rbac.yaml`.

## Production Checklist

1. **Namespace & Service Accounts**
   - Create or reuse a namespace dedicated to AppHub previews.
   - Provision service accounts with permissions to manage `Jobs`, `Deployments`, `Services`, and `Ingress` resources.

2. **Registry Credentials**
   - Ensure build Jobs have credentials to push to the production registry (mount secrets referenced by `APPHUB_K8S_REGISTRY_SECRET`).

3. **Ingress Controller**
   - Configure `APPHUB_K8S_PREVIEW_URL_TEMPLATE` or host template to reflect your ingress routing.
   - Provide TLS certificates via the ingress controller or use a service mesh to inject.

4. **Resource Quotas**
   - Define resource requests/limits on the builder image and preview workloads using standard Kubernetes policies.
   - Optionally configure namespaces with `ResourceQuota` and `LimitRange` objects.

5. **Rollout Steps**
   - Set `APPHUB_BUILD_EXECUTION_MODE=kubernetes` and `APPHUB_LAUNCH_EXECUTION_MODE=kubernetes` on one worker and validate end-to-end from the core UI.
   - Monitor the namespace for Job completions and Deployment rollouts.
   - Gradually enable the mode on remaining workers.

6. **Fallback Plan**
   - Switch the modes to `docker` (legacy) or `stub` to disable builds/launches if issues arise.
   - Delete incomplete Jobs/Deployments with `kubectl delete job/deployment apphub-* -n <namespace>`.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Build stuck in `Pending` | Inspect Job events (`kubectl describe job/apphub-build-*`) for image pull or permission errors. |
| Preview URL returns 404 | Confirm ingress host matches `APPHUB_K8S_PREVIEW_URL_TEMPLATE` and that the controller routes to the namespace. |
| Jobs cleaned too late | Adjust `APPHUB_K8S_BUILD_JOB_TTL_SECONDS` to shorten post-completion retention. |
| Workers cannot reach cluster | Validate `kubectl get ns` succeeds from the worker environment; ensure kubeconfig/service account is mounted. |

## Minikube Teardown

```bash
npm run minikube:down
```

Use `-- --purge-images --stop-cluster` to remove cached images and halt the VM after deleting the namespace.

The core will automatically fall back to the Docker stub if `APPHUB_BUILD_EXECUTION_MODE=stub` or if Kubernetes commands fail, but the preferred flow is to keep the execution modes consistent across local and remote environments.
