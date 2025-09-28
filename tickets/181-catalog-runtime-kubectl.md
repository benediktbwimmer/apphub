# Ticket 181: Bundle Kubernetes Tooling into Catalog Runtime

## Problem
Catalog build and launch flows now assume Kubernetes orchestration (`services/catalog/src/buildRunner/kubernetes.ts`, `services/catalog/src/launchRunner.ts`). The code shells out to `kubectl` and expects supporting env (service account, builder image, registry hints). The current runtime image (and newly proposed modular images) do not install `kubectl`, nor do they ship auxiliary binaries (helm/buildctl) or configuration scaffolding. Without these dependencies, catalog pods in minikube/production will fail every build/launch job, blocking the remote build platform rollout.

## Scope
Augment the catalog runtime image(s) so Kubernetes tooling is present and configurable. Deliver:
- `kubectl` binary compatible with Kubernetes ≥1.27.
- Optional `helm` CLI for future chart interactions (document whether we install now or gate behind feature flag).
- BuildKit/registry environment wiring in container entrypoint and documentation (APPHUB_K8S_* envs).
- Image variants for API vs worker processes that share the tooling layer.
- Basic health check to verify `kubectl version --client` works on pod start, surfacing actionable errors when credentials are missing.

## Implementation
- Extend the shared base image (from Ticket 180) to download and verify `kubectl` (and `helm` if included) during build.
- Add lightweight smoke script that runs at container start (before Fastify boot) to confirm binaries are executable and warn if `$KUBECONFIG`/in-cluster service account tokens are absent.
- Parameterize builder image, registry endpoint, and service account via env/secret mounts. Provide defaults compatible with minikube (registry addon exposes port 5000, service accounts `apphub-builder`, `apphub-preview`).
- Update catalog deployment manifests (Ticket 183) so worker pods mount the correct service account and any registry secrets needed by the `kubectl` job template.
- Document new env vars + required secrets in `docs/runbooks/remote-build-launch.md` and README.

## Acceptance Criteria
- Catalog API pods log a clear startup warning if `kubectl` is missing; with the new image the warning disappears and `kubectl version --client` succeeds inside the container.
- Build worker pods successfully submit a synthetic build job to a test cluster when provided with `APPHUB_K8S_*` env vars; failures reference Kubernetes job events instead of “kubectl not found”.
- Launch worker pods create and tear down preview Deployments/Services on minikube during a smoke test.
- Documentation lists newly required service accounts/roles and how to mount kubeconfigs for local development.

## Rollout & Risks
- Installing CLI binaries increases image size; monitor for >10% growth. Consider multi-stage download caching or `distroless` + `kubectl` layer optimizations.
- Ensure cluster credentials are mounted read-only; misconfigured RBAC could allow catalog pods to mutate unintended namespaces.
- Validate `kubectl` version compatibility with production clusters; schedule periodic dependency bumps.
