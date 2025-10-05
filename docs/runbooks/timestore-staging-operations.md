# Timestore Staging Operations

This runbook covers how to roll out, monitor, and triage the DuckDB-based staging pipeline that now fronts timestore ingestion. The guidance replaces the legacy "direct parquet write" path - only the staging queue should feed partition builds once these steps are complete.

## Enablement Checklist

1. **Provision disk space** - ensure the host (or StatefulSet volume) can accommodate the configured guardrails. Use the defaults (`512 MB` per dataset, optional global ceiling) or set tighter values with `TIMESTORE_STAGING_MAX_DATASET_BYTES` / `TIMESTORE_STAGING_MAX_TOTAL_BYTES`.
2. **Configure the service** - set the following environment variables in the deployment manifest:
   - `TIMESTORE_STAGING_DIRECTORY`
   - `TIMESTORE_STAGING_MAX_DATASET_BYTES`, `TIMESTORE_STAGING_MAX_TOTAL_BYTES`, `TIMESTORE_STAGING_MAX_PENDING`
   - `TIMESTORE_STAGING_FLUSH_MAX_ROWS`, `TIMESTORE_STAGING_FLUSH_MAX_BYTES`, `TIMESTORE_STAGING_FLUSH_MAX_AGE_MS`
3. **Capture dataset overrides** - if a dataset needs custom flush behaviour, add `{"staging": {"flush": { ... }}}` to its metadata and document the override in the operations dashboard (so alerts use the correct thresholds).
4. **Deploy staging-ready workers** - recycle ingestion workers and API pods so they pick up the new configuration and the staged flush pipeline.
5. **Retire direct writers** - remove any cronjobs or scripts that previously wrote Parquet directly to storage; workers should now enqueue through the staging manager.

## Monitoring & Alerting

Embed the new metrics in the timestore dashboard:

- `timestore_staging_queue_depth{metric="batches"}` - staged backlog. Warn at 20, page at 50.
- `timestore_staging_queue_depth{metric="rows"}` - helps size flush batches and correlate with compaction cost.
- `timestore_staging_oldest_age_seconds` - flush lag; alert when the oldest batch waits >120s.
- `timestore_staging_disk_usage_bytes{component="total"}` - compare to the per-dataset max; alert at 75%/90%.
- `timestore_staging_flush_duration_seconds` - histogram for success/failure latency. Track p95 for regression detection.
- `timestore_staging_flush_batches_total` / `timestore_staging_flush_rows_total` - useful for rate panels (successful vs failed flush volume).
- `timestore_staging_dropped_batches_total` - increments when a dataset exhausts its in-memory queue or size guardrail; triggers should investigate backpressure.
- `timestore_staging_retried_batches_total` - increments when a flush aborts and batches are returned to staging; page when this grows together with drop counters.

Tie alerts back to the configuration so operators know whether to scale hardware, raise thresholds, or throttle producers.

## Failure Recovery

1. **Flush aborts** - spikes in `timestore_staging_retried_batches_total` mean the flush failed. Inspect the worker logs for DuckDB export errors. The batches remain staged; once the blocker is cleared, the next ingestion job will reattempt.
2. **Queue saturation** - `timestore_staging_dropped_batches_total{reason="queue_full"}` indicates producers are outpacing the staging manager. Raise `TIMESTORE_STAGING_MAX_PENDING`, spread writes across multiple datasets, or throttle producers.
3. **Disk pressure** - if `timestore_staging_disk_usage_bytes` approaches the guardrail, drain the queue (manual flush via ingestion API) and increase `TIMESTORE_STAGING_MAX_*` or expand storage.
4. **Broken thresholds** - when production datasets require different flush cadence, set metadata overrides instead of tuning global defaults, then update dashboards to reflect the new limits.

## Decommission Legacy Parquet Writes

- Remove or disable any worker feature flags that allowed bypassing staging.
- Delete temporary directories that previously held inline Parquet payloads once the staging directory is stable.
- Update runbooks and dashboards that referenced the legacy compaction alert pipeline; the new metrics supersede them.
- Document the migration in the service release notes (see `docs/timestore-staging-release-notes.md`) and link product teams to the new dashboards.
