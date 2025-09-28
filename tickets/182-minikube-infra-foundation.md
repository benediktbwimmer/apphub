# Ticket 182: Provision Core Minikube Infrastructure (Postgres, Redis, MinIO)

## Problem
A turnkey Kubernetes workflow requires shared infrastructure inside the cluster: Postgres for all services, Redis for BullMQ/event fan-out, and MinIO for S3-compatible storage. Today engineers must run these dependencies manually on their laptop or craft ad-hoc `kubectl apply` sequences. No manifests or Helm values exist for minikube, so every setup is bespoke and fragile. Without standardized infrastructure scaffolding we cannot provide a one-command bootstrap.

## Scope
Deliver Kubernetes manifests (or Helm values) that deploy:
- PostgreSQL with persistent volume, database/user bootstrap (`apphub` DB + schemas for catalog, metastore, filestore, timestore).
- Redis with configurable persistence (optional) and auth disabled for local dev.
- MinIO single-replica deployment with persistent volume, default credentials, and bucket initialization for example bundles / filestore / timestore.
- Supporting ConfigMaps/Secrets for connection strings consumed by AppHub services.

## Implementation
- Choose templating strategy (raw manifests + kustomize, or Helm dependency values) consistent with future Tickets 183/184.
- Define namespace (e.g., `apphub-system`) and storage classes compatible with minikube.
- Provision PVCs sized for local dev (e.g., 10Gi Postgres, 5Gi MinIO). Document how to adjust for larger workloads.
- Create Kubernetes Jobs or init containers to run database migrations: create roles (`apphub:apphub`), schemas (`metastore`, `filestore`, `timestore`), and default extensions if required.
- Add a MinIO bootstrap Job that creates the `apphub-example-bundles` bucket and any additional buckets (filestore mounts, timestore partitions) using `mc` or `aws` CLI.
- Expose Postgres and Redis inside the cluster via Services; add optional `kubectl port-forward` docs for local access.
- Store default credentials in Kubernetes Secrets; keep compatibility with existing env variable names (`DATABASE_URL`, `REDIS_URL`, `APPHUB_BUNDLE_STORAGE_*`).

## Acceptance Criteria
- Running `kubectl apply -k infra/minikube` (or analogous Helm command) installs Postgres, Redis, and MinIO in a dedicated namespace with pods in `Running` state.
- Postgres Service accepts connections from inside the cluster; connecting with the default credentials allows schema creation.
- Redis Service is reachable and responds to `PING`.
- MinIO pod exposes port 9000 (`kubectl port-forward` works) and the bootstrap job confirms required bucket(s) exist.
- Secrets/ConfigMaps provide URLs and credentials that align with service expectations; catalog/filestore pods can read them without manual edits.

## Rollout & Risks
- Persisted volumes increase minikube disk usage; document cleanup commands and provide lightweight storage options for constrained environments.
- Bucket/job bootstrap must be idempotent to support repeated installs (use `mc mb --ignore-existing` or equivalent).
- Keep credentials clearly marked as **dev only**; avoid committing production secrets. Consider generating random passwords per install and printing connection info in the bootstrap script.
