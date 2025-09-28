# Ticket 184: Ship Turnkey Minikube Bootstrap Command

## Problem
After modular images and manifests exist, operators still need a streamlined workflow to build, load, and deploy everything onto minikube. Currently they would have to run `npm run build`, manually build/push images, apply charts, create buckets, and run migrations. This contradicts the goal of “one command builds everything and deploys it.”

## Scope
Provide an automated CLI/script that orchestrates:
1. Building the per-service images (Ticket 180).
2. Pushing/loading them into the minikube registry (`minikube image load` or `docker push` to the addon registry).
3. Applying infrastructure manifests (Ticket 182).
4. Waiting for Postgres/Redis/MinIO readiness and seeding buckets/schemas if necessary.
5. Deploying AppHub workloads (Ticket 183).
6. Reporting endpoints/credentials for the developer.

## Implementation
- Add a node-based script under `scripts/` (or npm workspace command) named e.g. `npm run minikube:up`.
- Detect minikube status (shell out to `minikube status`); optionally start the cluster with recommended resources (`--memory 8192 --cpus 4`) when absent.
- Build Docker images via `docker buildx bake` or sequential `docker build --target <service>`; load them into the minikube registry using `minikube image load` or by tagging and pushing to `registry.local:5000` if the addon is enabled.
- Apply infrastructure manifests (`kubectl apply -k infra/minikube`) and wait for StatefulSets to become ready (use `kubectl rollout status`).
- Store generated secrets (random passwords) in `infra/minikube/secrets/` or inline Kubernetes Secrets; print them at the end.
- Deploy the AppHub chart/overlay; wait for Deployments to roll out and Jobs (if any) to complete.
- Emit final summary with URLs (catalog API, frontend), credentials, and next steps (port-forward or edit `/etc/hosts` for Ingress).
- Provide complementary `npm run minikube:down` to tear everything down (delete namespace, clean PVs, optionally stop minikube).

## Acceptance Criteria
- Running the command on a clean workstation with minikube installed provisions the full stack end-to-end in <15 minutes with minimal interaction (only confirmation prompts as needed).
- The script handles retries for transient image loads or `kubectl apply` ordering (e.g., waits for namespace creation before applying resources).
- Final output lists reachable endpoints and credentials; hitting the catalog API returns 200, and the frontend loads the UI.
- Repeat execution detects existing deployments and either upgrades them or exits gracefully with instructions.

## Rollout & Risks
- Provide clear prerequisites: Docker daemon, minikube, kubectl, helm (if used). Fail fast with helpful errors if missing.
- Running builds sequentially may be slow; consider parallelization but keep resource usage reasonable for laptops.
- Ensure the script respects sandboxed environments; provide flags to skip cluster start or image build when CI preloads artifacts.
- Document cleanup to avoid orphaned persistent volumes eating disk space.
