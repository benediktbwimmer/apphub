# Surface queue and workflow telemetry to operators

## Context
- Queue metrics are emitted via Prometheus gauges (`services/core/src/observability/queueTelemetry.ts:1`), but there is no consolidated dashboard or alerting.
- Workflow analytics snapshots exist, yet operators monitor queue stalls through ad hoc scripts or DB queries.
- The frontend lacks a dedicated surface for queue depth, latency, and retry trends beyond raw event feeds.

## Impact
- Operations teams struggle to detect retry storms or stalled workers until user-facing symptoms appear.
- Lack of prebuilt dashboards increases MTTR and forces teams to wire separate observability stacks per service.
- Without alerts tied to telemetry, auto-scaling and incident playbooks cannot act proactively.

## Proposed direction
1. Aggregate queue metrics and workflow analytics into Timestore datasets for historical analysis.
2. Build frontend panels (e.g. under Overview or Runs) showing queue depth, wait time, and retry rates with thresholds.
3. Define Prometheus alert rules and document recommended Grafana dashboards for core queues.
4. Integrate telemetry summaries into the planned notification relay for proactive incident alerts.
5. Add tests or smoke checks ensuring metrics endpoints expose expected series after worker startup.

## Acceptance criteria
- Operators can view queue/workflow health in the UI with charts and status indicators backed by telemetry data.
- Prometheus/Grafana examples or configs exist so teams can deploy alerting quickly.
- Historical queue latency data persists for capacity planning, and incidents trigger notifications.
