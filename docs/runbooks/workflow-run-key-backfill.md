# Workflow Run Key Backfill

Use this runbook when migrating existing workflow runs to the new human-readable `runKey` column. The companion script assigns friendly keys to historic runs so operators can correlate records without UUIDs.

## Prerequisites
- `DATABASE_URL` must point at the target Postgres instance with privileges to update `workflow_runs`.
- Ensure migration `041_workflow_run_keys` has been applied. The unique index on active runs prevents duplicate keys for inflight executions.
- Take a recent backup or enable PITR before modifying production data.

## Dry Run
Validate the proposed changes before mutating data:

```bash
npx tsx scripts/workflow-run-key-backfill.ts --dry-run --batch-size 100
```

The script prints the run ID, workflow ID, and the derived key for each candidate and emits Prometheus-style counters summarising activity.

## Execution
To apply keys in batches of 200 rows:

```bash
npx tsx scripts/workflow-run-key-backfill.ts --batch-size 200
```

Use `--max-updates` to cap the number of updates in a single session (useful for canaries):

```bash
npx tsx scripts/workflow-run-key-backfill.ts --max-updates 1000
```

The script prefers partition keys, trigger dedupe keys, and event identifiers when available. If none exist, it falls back to a slug derived from the run UUID.

## Monitoring
The script writes counters to stdout in Prometheus exposition format:

- `workflow_run_key_backfill_processed_total`
- `workflow_run_key_backfill_updated_total`
- `workflow_run_key_backfill_skipped_total`
- `workflow_run_key_backfill_conflicts_total`
- `workflow_run_key_backfill_failures_total`

Capture the output and feed it into a temporary dashboard or include it in change-management notes.

## Rolling Back
- If the script reports unexpected conflicts or failures, stop execution and review the emitted warning lines.
- To revert, set `run_key` and `run_key_normalized` to `NULL` for affected runs using the recorded IDs.
- Consider rerunning in dry run mode with a smaller batch to diagnose problematic records before reattempting.
