# Ticket 155: Runtime Scaling Controls & UI Telemetry

## Problem
Worker concurrency and queue throughput are controlled by environment variables. Operators must redeploy services to adjust capacity, and the frontend offers no insight into queue health. This is true both for production and the minikube environment, so local testing cannot mimic runtime scaling scenarios.

## Scope
Implement hot-reloadable scaling controls managed by the catalog API, with a UI surface that works identically in minikube and production.

## Implementation
- Create a `runtime_scaling_policies` table storing desired concurrency per queue/worker plus metadata (who changed it, when, reason).
- Add catalog API endpoints (protected by operator scopes) to read/update scaling settings. Persist changes and publish notifications via Redis so workers adjust in near real time.
- Modify ingestion/build/workflow workers to listen for scaling updates and call BullMQ `setConcurrency` or analogous APIs. Ensure acknowledgement and error reporting are in place.
- Extend `/admin/event-health` (or add `/admin/runtime-scaling`) to return queue depth, active concurrency, and pending scaling updates.
- Build frontend components under the admin section showing metrics (queue depth, worker count, success/failure rates) and interactive controls (bounded sliders/inputs) for capacity adjustments. Use the same endpoints for minikube and production to keep parity.
- Audit log scaling changes and surface history in the UI.

## Acceptance Criteria
- Operators can increase/decrease ingestion/build/workflow concurrency without redeploying, verified in minikube and staging.
- Workers acknowledge changes and report actual concurrency; mismatches raise alerts.
- UI shows live queue depth + scaling controls with integration tests covering permission checks.
- Documentation includes usage guide and safeguards (min/max, confirmation dialogs) and notes for minikube users.

## Rollout & Risks
- Start with read-only telemetry mode; once verified, enable write operations behind a feature flag per environment.
- Enforce bounds and rate limiting on scaling adjustments to avoid runaway settings.
