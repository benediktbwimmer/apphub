# Remote Build & Launch Platform

Ticket 153 replaced the Docker socket runner with a Kubernetes-first workflow. Catalog workers now schedule build Jobs and preview Deployments directly in the target cluster so local minikube environments and remote environments share the same orchestration path.

## Prerequisites
- Kubernetes 1.27+ cluster (minikube or managed service).
- Access credentials for the catalog process (kubeconfig or in-cluster service account).
- Container registry reachable from the cluster. For minikube, enable the built-in registry; for production use your managed registry.
- `kubectl` binary on the catalog worker `$PATH`.

## Environment Variables

| Variable | Description |
| --- | --- |
| `APPHUB_BUILD_EXECUTION_MODE` | Defaults to `kubernetes`. Set to `docker` for the legacy Docker runner or `stub` to bypass builds. |
| `APPHUB_LAUNCH_EXECUTION_MODE` | Defaults to `kubernetes`. Use `docker` for the old local runner or `stub` to skip launches. |
| `APPHUB_K8S_NAMESPACE` | Namespace used for build Jobs and preview Deployments/Services. |
| `APPHUB_K8S_BUILDER_IMAGE` | Image containing the BuildKit client/logic. Default `ghcr.io/apphub/builder:latest`. |
| `APPHUB_K8S_BUILDER_SERVICE_ACCOUNT` | Optional service account for build Jobs. |
| `APPHUB_K8S_BUILD_TIMEOUT_SECONDS` | Max wait for build completion (default 900). |
| `APPHUB_K8S_PREVIEW_URL_TEMPLATE` | Optional preview URL template (for example `https://{launch}.preview.local`). |
| `APPHUB_K8S_PREVIEW_HOST_TEMPLATE` | Alternative host-only template (paired with `APPHUB_K8S_PREVIEW_SCHEME`). |
| `APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT` | Optional service account for preview Deployments. |
| `APPHUB_K8S_INGRESS_CLASS` | Ingress class to use when creating preview routes. |

## Minikube Setup

1. **Start minikube with ingress and registry enabled**
   ```bash
   minikube start --memory=8192 --cpus=4
   minikube addons enable ingress
   minikube addons enable registry
   ```
2. **Provision Redis for queues (matches staging/prod credentials)**
   ```bash
   helm repo add bitnami https://charts.bitnami.com/bitnami
   helm upgrade --install apphub-redis bitnami/redis \
     --namespace apphub \
     --create-namespace \
     --set auth.enabled=false
   kubectl rollout status statefulset/apphub-redis-master -n apphub
   ```
   Point catalog, filestore, metastore, and timestore at the instance:
   ```bash
   export REDIS_URL=redis://apphub-redis-master.apphub.svc.cluster.local:6379
   export FILESTORE_REDIS_URL=$REDIS_URL
   export APPHUB_ALLOW_INLINE_MODE=false
   ```
   For debugging, port-forward locally:
   ```bash
   kubectl port-forward svc/apphub-redis-master -n apphub 6379:6379
   ```

3. **Expose the registry endpoint**
   ```bash
   kubectl port-forward --namespace kube-system svc/registry 5000:80
   ```
4. **Configure the catalog environment**
   ```bash
   export APPHUB_BUILD_EXECUTION_MODE=kubernetes
   export APPHUB_LAUNCH_EXECUTION_MODE=kubernetes
   export APPHUB_K8S_NAMESPACE=apphub
   export APPHUB_K8S_PREVIEW_URL_TEMPLATE="http://preview.minikube.local/{launch}"
   export KUBECONFIG=$(minikube kubeconfig)
   ```
   Create the namespace and service accounts:
   ```bash
   kubectl create namespace apphub
   kubectl create serviceaccount apphub-builder -n apphub
   kubectl create serviceaccount apphub-preview -n apphub
   kubectl create rolebinding apphub-builder-edit \
     --clusterrole=edit \
     --serviceaccount apphub:apphub-builder \
     --namespace apphub
   kubectl create rolebinding apphub-preview-edit \
     --clusterrole=edit \
     --serviceaccount apphub:apphub-preview \
     --namespace apphub
   ```
   Then export:
   ```bash
   export APPHUB_K8S_BUILDER_SERVICE_ACCOUNT=apphub-builder
   export APPHUB_K8S_LAUNCH_SERVICE_ACCOUNT=apphub-preview
   ```
5. **Configure DNS for preview URLs (optional)**
   - Add a wildcard entry in `/etc/hosts` for `preview.minikube.local` pointing to `$(minikube ip)`.
   - Alternatively, use `kubectl port-forward` to reach the preview Service manually.

6. **Restart the catalog workers**
   Ensure the catalog API and worker processes inherit the environment variables above. Builds will render as Kubernetes Jobs and previews as Deployments/Services/Ingress resources in the `apphub` namespace.

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
   - Set `APPHUB_BUILD_EXECUTION_MODE=kubernetes` and `APPHUB_LAUNCH_EXECUTION_MODE=kubernetes` on one worker and validate end-to-end from the catalog UI.
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
kubectl delete namespace apphub
minikube stop
```

The catalog will automatically fall back to the Docker stub if `APPHUB_BUILD_EXECUTION_MODE=stub` or if Kubernetes commands fail, but the preferred flow is to keep the execution modes consistent across local and remote environments.
