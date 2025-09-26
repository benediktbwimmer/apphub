# Ticket 064: Instrument Event Scheduler with Observability & Safeguards

## Problem Statement
Introducing event-driven workflow scheduling adds new failure modes—event storms, trigger misconfiguration, queue backlogs—that we must detect quickly. Without instrumentation, rate limiting, and operator tooling, a misbehaving trigger or upstream service could silently throttle the system or flood workflows.

## Goals
- Add metrics, logs, and traces covering ingress lag, trigger matches, throttling actions, DLQ volume, and per-source publish rates.
- Implement per-source and per-trigger rate limiting controls, including configurable circuit breakers that pause triggers or sources when error thresholds are exceeded.
- Expose health/diagnostic endpoints summarizing queue depth, latest processed event timestamp, and paused sources.
- Provide runbooks and dashboard specs for SRE/operations teams.

## Non-Goals
- Building a full-fledged UI (charts/graphs) beyond health endpoints and documented dashboards.
- Implementing global multi-region failover strategies.
- Handling manual DLQ replay (covered in a later operations ticket if needed).

## Implementation Sketch
1. Extend existing observability infra (Prometheus metrics, pino logs, OpenTelemetry traces) with new gauges/counters/histograms for event ingestion and trigger evaluation.
2. Introduce configuration for per-source rate limits; enforce limits in the ingress worker and trigger worker, pausing sources or triggers when thresholds hit and recording state in Postgres.
3. Add admin endpoints (`GET /admin/event-health`) summarizing queue lag, paused entities, and recent DLQ counts.
4. Wire alerts/dashboards (Grafana or preferred tooling) documenting recommended panels/thresholds in `docs/operations/event-scheduler.md`.
5. Write tests covering rate limit enforcement, paused state persistence, and health endpoint responses.

## Acceptance Criteria
- Metrics for ingress lag, matches, throttles, DLQ size, and paused sources are emitted and scrape-ready.
- Rate limiting pauses misbehaving sources/triggers and persists state for investigation, with logs referencing correlation IDs.
- Health endpoint returns accurate snapshot data and flips status when thresholds exceeded.
- Operations documentation defines alerts and dashboards for the new metrics.
