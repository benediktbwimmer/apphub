# Ticket 174: Event Sampling Backfill & Observability

## Problem Statement
New sampling only captures forward events; historical runs remain invisible and regressions might silently zero out sampling. We need a replay mechanism to hydrate legacy edges and monitoring that alerts when sampling drops unexpectedly.

## Goals
- Build a replay worker that scans recent workflow events missing context, derives relationships via `correlationId` and run history, and seeds the sampling table.
- Establish guardrails (metrics, alerts) indicating sampling volume per workflow and flagging prolonged inactivity.
- Provide operator tooling to trigger ad-hoc replays for specific time ranges or workflows.

## Non-Goals
- Modify the core ingest path (handled previously).
- Guarantee full historical reconstruction beyond configurable lookback windows.
- Deliver UI visualizations for sampling health (future work may expand here).

## Implementation Sketch
1. Implement a catalog script/worker that queries workflow events for the last N days without sampling rows, correlates them via `workflow_run_steps` data, and upserts inferred samples.
2. Add configuration for replay chunk size and lookback window; record progress markers to avoid duplicate work.
3. Expose Prometheus metrics or existing observability hooks for sampling insert/update counts, stale sample detection, and replay success/failure.
4. Wire alerts/dashboards plus admin endpoints or CLI commands to kick off replays on demand; cover critical flows with integration tests.

## Deliverables
- Replay worker code checked in with scheduler/CLI entry point and tests.
- Observability instrumentation (metrics, log messages, alerting docs) demonstrating how to monitor sampling health.
- Operational runbook under `docs/` describing replay usage and troubleshooting steps.
