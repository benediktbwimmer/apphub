# Timestore Staging Release Notes

## Summary

The ingestion pipeline now stages all writes through DuckDB before partition builds. This release introduces flush orchestration, queue guardrails, and Prometheus instrumentation so operators can monitor backlog, disk usage, and retry rates. Direct Parquet writes are deprecated and will be removed after this rollout.

## What's New

- DuckDB staging queue with per-dataset concurrency limits and size guardrails.
- Configurable flush thresholds (rows, bytes, age) plus dataset-level overrides.
- New Prometheus series for staging queue depth, disk usage, flush latency, and drop/retry counters.
- Runbook (`docs/runbooks/timestore-staging-operations.md`) covering enablement, monitoring, and recovery.

## Upgrade Checklist

1. Roll the new binaries/workers so ingestion jobs use the staging queue.
2. Set the staging environment variables (`TIMESTORE_STAGING_*`) in deployment manifests; adjust values for production data volumes.
3. Update dashboards to include the new metrics and wire the recommended alerts (see `docs/timestore-observability.md`).
4. Validate on a non-production environment:
   - Run representative ingestion workloads.
   - Confirm `timestore_staging_queue_depth` settles near zero after drains.
   - Verify flush latency (`timestore_staging_flush_duration_seconds`) stays within SLOs.
5. Remove or disable any feature flags or scripts that bypass staging.

## Rollback / Contingency

- If staging introduces regressions, set `TIMESTORE_STAGING_MAX_PENDING` to a higher value and flush manually to buy time.
- As a last resort, redeploy the previous release and restore the legacy ingestion config (be sure to clear the staging directory to avoid disk pressure when rolling forward again).

## Operator Notes

- Use `timestore_staging_dropped_batches_total` and `timestore_staging_retried_batches_total` to page the on-call when backpressure starts.
- Guardrails are soft warnings today; exceeding `TIMESTORE_STAGING_MAX_*` logs a warning and increments metrics—plan follow-up work if hard enforcement is required.
- Document any dataset-level flush overrides so alert thresholds and dashboards stay accurate.
