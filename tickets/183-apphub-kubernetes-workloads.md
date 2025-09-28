# Ticket 183: Author Kubernetes Manifests for AppHub Services

## Problem
Even with modular images and shared infrastructure, we lack Kubernetes manifests to run AppHub itself. There are no Deployments, Jobs, or Services for the catalog API, queue workers, metastore, filestore, timestore, or frontend. Operators must reinvent manifests by hand, which undermines the goal of a turnkey minikube experience.

## Scope
Create Kubernetes manifests (preferably Helm chart or kustomize overlay) for all AppHub workloads, referencing the infrastructure provisioned in Ticket 182 and the images from Ticket 180. Cover:
- Catalog API Deployment.
- Catalog workers (ingest, build, launch, workflow, asset materializer, example bundle, events, triggers). Each may share a template with different command/env overrides.
- Metastore API Deployment.
- Filestore API Deployment + reconciliation worker Deployment.
- Timestore API Deployment + ingestion/partition/lifecycle worker Jobs/Deployments.
- Frontend Deployment + Service/Ingress.
- Shared ConfigMaps/Secrets for service URLs, tokens, and feature flags.

## Implementation
- Choose a templating approach that plays nicely with Ticket 182 (single chart with subcharts vs. kustomize overlay). Ensure values can swap between minikube and production later.
- Encode environment variables that point services at the cluster resources (e.g., `DATABASE_URL`, `REDIS_URL`, `APPHUB_BUNDLE_STORAGE_*`, `APPHUB_METASTORE_BASE_URL`, `APPHUB_FILESTORE_BASE_URL`, `APPHUB_TIMESTORE_BASE_URL`).
- Mount service account tokens for catalog build/launch workers (Ticket 181) and set `APPHUB_K8S_*` envs.
- Configure horizontal pod counts (defaults: 1 for APIs, 1 for each worker) and resource requests suitable for minikube.
- Expose HTTP entry points via Services; add Ingress definitions for catalog API (`/`), frontend (`/`), metastore (`/metastore`), etc., or document port-forwarding fallback.
- Integrate migrations: ensure catalog/metastore/filestore/timestore pods run schema migrations on startup (these services already run migrations automatically in `onReady`, verify concurrency behavior with multiple replicas).

## Acceptance Criteria
- A single `helm install`/`kubectl apply` command deploys all AppHub workloads into a namespace, referencing images built in Ticket 180 and infrastructure from Ticket 182.
- Pods reach `Running` (or Jobs complete) without manual edits; health endpoints (`/healthz`, `/readyz`) return success once dependencies are ready.
- Workload configuration uses secrets/configmaps rather than hardcoded credentials in manifests.
- Scaling the catalog API to two replicas keeps service registry state in sync (leveraging Ticket 150 work) and workflow scheduler remains coordinated (`WORKFLOW_SCHEDULER_ADVISORY_LOCKS=1`).
- Build/launch workers are able to submit Kubernetes jobs (once service accounts/registry secrets are present).

## Rollout & Risks
- Replica startup ordering matters: catalog workers expect Redis/Postgres ready. Use `initContainers` or startup probes if necessary.
- Ensure env var defaults do not accidentally point to `localhost`; all services must consume cluster DNS names.
- Avoid hardcoding NodePort/HostPorts; rely on Services + optional Ingress for portability.
- Keep manifests modular so production can override resources, DNS, and auth settings.
