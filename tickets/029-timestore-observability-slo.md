# Ticket 029: Timestore Observability & SLO Instrumentation

## Problem Statement
While lifecycle jobs emit basic counters, the core timestore service lacks visibility into ingestion latency, queue depth, query durations, and cache behavior. Operators cannot enforce SLOs or detect backlogs until customer complaints arise. We need consistent metrics and tracing to monitor the health of ingestion, query processing, and lifecycle workers.

## Goals
- Instrument ingestion, query, and lifecycle flows with Prometheus-friendly metrics capturing latency, throughput, queue depth, cache hit rates, and failure counts.
- Expose a `/metrics` endpoint (or integrate with existing platform exporter) guarded behind IAM.
- Optionally add OpenTelemetry spans for ingestion and query execution to integrate with distributed tracing.
- Provide runbooks/documentation describing critical metrics, alert thresholds, and dashboard recommendations.

## Non-Goals
- Building bespoke alerting pipelines; rely on existing monitoring stacks once metrics are available.
- Instrumenting every internal helper; focus on high-level service SLOs and major failure modes first.

## Implementation Sketch
1. Define metric names, labels, and histogram buckets for ingestion durations, query execution times, job queue sizes, and cache hits/misses.
2. Add lightweight instrumentation to the ingestion route, queue processor, query executor, and lifecycle worker harness, ensuring low overhead.
3. Wire up a Fastify plugin or shared exporter module to register the metrics endpoint with IAM protection.
4. Integrate optional OpenTelemetry instrumentation hooks for tracing if the platform enables it via configuration.
5. Write tests validating metric registration and basic increments, and document dashboards/runbooks in `docs/`.

## Deliverables
- Metrics instrumentation across ingestion, query, and lifecycle paths with a protected `/metrics` endpoint.
- Optional tracing hooks and configuration.
- Documentation covering key metrics, suggested alerts, and operational guidance.
