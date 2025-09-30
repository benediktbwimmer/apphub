# Observatory dashboard aggregator times out waiting for dataset

## Context
- Scenario: `environmentalObservatoryEventDrivenBenchmark` (examples/tests/catalog/environmentalObservatoryEventDrivenBenchmark.e2e.ts)
- Stack: local catalog/timestore/filestore test harness using external Postgres (127.0.0.1:6543) and Redis.
- When the benchmark reaches the `observatory-dashboard-aggregator` job the handler loops on `waitForDatasetReady` (examples/environmental-observatory-event-driven/jobs/observatory-dashboard-aggregator/src/index.ts) and eventually fails with `Timestore dataset observatory-timeseries not ready after waiting 24000ms`.
- A timestore ingestion job finishes earlier in the flow, but because the dataset poll runs immediately after ingestion, the dashboard aggregator has to retry ~24 times (24s) per run. With multiple retries from the workflow orchestrator, the publication workflow never completes within the benchmark timeout.

## Impact
- Benchmark consistently fails while waiting for the publication workflow (minute 2032-06-15T09:00) even though ingest succeeds.
- Dashboard reports are never generated so the downstream workflows are not validated.
- Iteration time is high: every retry spends the full 24s waiting before the aggregator fails again.

## Proposed direction
1. Revisit the dataset readiness logic in the dashboard aggregator bundle:
   - Either wait for the partition build queue to publish its completion event before invoking `waitForDatasetReady`, or
   - Decrease the polling window/attempt count for local runs via configuration (e.g. read `OBSERVATORY_BENCH_MAX_ATTEMPTS` / dedicate env for dataset wait).
2. Confirm that the timestore partition build queue is drained synchronously in the benchmark harness (temporary helper code currently mimics worker behaviour). Plan to revert this to true queue processing once the benchmark is stable.
3. After adjustments, rerun the benchmark end-to-end and ensure the publication workflow succeeds (or at least fails fast with actionable errors).

## Acceptance criteria
- Benchmark test completes without timing out on `observatory-daily-publication`.
- Dashboard aggregator either succeeds in fetching data within the new budget or reports a failure that no longer blocks the entire scenario.
- Document any new knobs (e.g. reduced dataset wait attempts) in the README for the environmental observatory example.
- Outline a follow-up plan to remove the synchronous queue draining in the benchmark and rely on real workers again once the pipeline timing is fixed.
