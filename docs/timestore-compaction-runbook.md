# Timestore Compaction Runbook

Compaction now processes partitions in shard-level chunks and persists resumable checkpoints so operators can safely resume work after failures. This runbook outlines tuning levers and operational checks.

## Configuration

Chunk sizing and retry behaviour are exposed via environment variables:

- `TIMESTORE_LIFECYCLE_COMPACTION_CHUNK_PARTITIONS` (default `48`): maximum source partitions processed per chunk before we swap manifest entries.
- `TIMESTORE_LIFECYCLE_COMPACTION_MAX_CHUNK_RETRIES` (default `3`): number of automatic retries before surfacing failures.
- `TIMESTORE_LIFECYCLE_COMPACTION_CHECKPOINT_TTL_HOURS` (default `24`): how long completed checkpoints remain queryable for audits.

Adjust chunk size upward to reduce checkpoint churn when partitions are small; decrease it when S3 or DuckDB pressure approaches resource limits. Always restart the lifecycle worker after changing these values so the checkpoint plan is rebuilt with the new settings.

## Monitoring checkpoints

Each shard maintains a single row in `compaction_checkpoints` while work is in progress. Key fields:

- `status` — `pending` while compaction is active, `completed` once all chunks have been swapped.
- `cursor` — zero-based index of the next unprocessed group.
- `metadata` — JSON payload that describes chunk partition IDs, completed groups, and attempt counters.
- `stats` — aggregate bytes, partitions, and per-chunk history (for the last 200 samples).

Example query to inspect pending work:

```sql
SELECT manifest_id,
       cursor,
       (metadata->>'completedGroupIds')::jsonb ?| array['cg-0'] AS first_chunk_done,
       stats->>'chunksCompleted' AS chunks
FROM compaction_checkpoints
WHERE status = 'pending';
```

## Metrics

The lifecycle metrics endpoint now exposes `compactionChunks`, an array of chunk samples with bytes, attempt count, and completion time. These samples mirror the contents of `stats.chunkHistory` and appear in Prometheus/observability dashboards as `timestore_lifecycle_compaction_chunks`.

Monitor:

- `operationTotals.compaction` — total partitions/bytes swapped across runs.
- `compactionChunks[*].attempts` — spikes indicate repeated retries (often due to S3 throttling or DuckDB attachment failures).

## Resume procedure

1. Inspect `compaction_checkpoints` to verify the remaining chunk count and confirm the job is still `pending`.
2. Resolve underlying failures (for example, S3 permissions or exhausted disk space).
3. Rerun the lifecycle job for the affected dataset. The worker reads the existing checkpoint, resumes at `cursor`, and continues processing.
4. After success, confirm `status` transitions to `completed` and `stats.lastError` clears.

## Cleanup

Completed checkpoints are retained for the configured TTL and can be removed manually:

```sql
DELETE FROM compaction_checkpoints
WHERE status = 'completed'
  AND updated_at < NOW() - INTERVAL '48 hours';
```

This preserves an audit trail while preventing unbounded table growth.
