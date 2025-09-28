# Ticket 150: Persist Service Registry & Health State

## Problem
The catalog service keeps manifests, service networks, and health polling results in process-local maps (`manifestEntries`, `manifestNetworks`, etc.). When multiple API instances run, those maps diverge and health probes stomp on each other. We also lack an auditable history of manifest imports and status transitions.

## Scope
Implement a Postgres-backed source of truth for service manifests and health results that works identically in production and in the local Kubernetes environment (minikube). Cache can remain for hot reads, but all writes and invalidations must travel through the shared store.

## Implementation
- Design and apply database migrations for `service_manifests`, `service_networks`, and `service_health_snapshots` with versioning, timestamps, and repository/service indices.
- Replace in-memory storage in `services/catalog/src/serviceRegistry.ts` with read-through/write-through accessors targeting the new tables. Keep a short-lived cache layer (e.g., LRU) per process for performance.
- Publish invalidation events via Redis (existing connection) and subscribe on boot so every replica, including the minikube deployment, refreshes cached entries on change.
- Backfill existing manifest data via a one-off script (`npm run backfill:service-registry`) that reads current YAML modules and writes through the new DAG.
- Extend `/services` API responses to include persisted health metadata (last probe, latency, status message) sourced from the snapshot table.

## Acceptance Criteria
- Multiple catalog pods (tested with two replicas in minikube) see consistent manifests after importing via UI/API.
- Health polling updates reflect across pods within one polling interval, with cache metrics showing hit/miss counts.
- Automated tests cover: manifest import, health update fan-out, backfill idempotency.
- Runbook updated with migration + rollback steps and minikube instructions.

## Rollout & Risks
- Ship dual-write guarded by feature flag; verify in staging before removing legacy maps.
- Index slug/repository columns to avoid slow queries. Monitor query latency dashboards post-rollout.
- If Redis is unavailable, fail fast (surface readiness failure) instead of silently reverting to local maps.
