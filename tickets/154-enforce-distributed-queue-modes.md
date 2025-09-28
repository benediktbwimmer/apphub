# Ticket 154: Enforce Redis-Backed Queueing Everywhere

## Problem
Several workers downgrade to inline/in-memory mode when Redis is misconfigured. That defeats horizontal scaling for catalog, filestore, metastore, and timestore. Local developers hit the inline fallback too, so minikube behavior diverges from production.

## Scope
Require Redis connectivity for all queue-backed services, with explicit configuration for both remote clusters and minikube.

## Implementation
- Update `queueManager.ts`, filestore rollup queue, metastore filestore consumer, and timestore lifecycle queue to fail fast if Redis is unreachable. Provide descriptive readiness/liveness errors.
- Add configuration validation during boot: ensure `REDIS_URL` and related env vars are set; emit structured logs when loading telemetry handlers.
- Instrument queue metrics (depth, latency) and expose them via `/admin/queue-health`, Prometheus, and the frontend admin view.
- Extend Helm/minikube charts to deploy Redis (or connect to a shared instance) with the same credentials and TLS settings used in production. Document port-forward instructions for local debugging.
- Remove `inline` fallbacks from production builds; keep them behind `APPHUB_ALLOW_INLINE_MODE` defaulting to false. Force minikube setup scripts to provision Redis instead of relying on inline mode.

## Acceptance Criteria
- Pod startup fails with clear error if Redis is unavailable, both in minikube and remote clusters.
- Queue metrics appear in Prometheus/Grafana and `/admin/queue-health` returns structured counts.
- Automated tests simulate Redis outage and confirm graceful shutdown/health failure.
- Developer documentation updated to include `helm upgrade redis` instructions for minikube.

## Rollout & Risks
- Roll out by environment: enable strict mode in staging/minikube first, monitor, then production.
- Provide fallback toggle for emergency disable (feature flag) with associated runbook.
