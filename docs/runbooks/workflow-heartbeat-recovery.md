# Workflow Heartbeat & Recovery Runbook

## Overview
Workflow orchestration now records per-step heartbeats and execution history so stalled workers can be restarted without losing determinism. This runbook explains how to inspect the new metadata, interpret timeout events, and manually recover when automated retries exhaust.

## Key Tables & Columns
- `job_runs.last_heartbeat_at` — ISO timestamp of the most recent job heartbeat (`JobRunContext.update()` or `heartbeat()`).
- `job_runs.retry_count` — Number of retries already consumed (attempts - 1 when backfilled).
- `job_runs.failure_reason` — Categorical failure code (`error`, `timeout`, `canceled`, etc.).
- `workflow_run_steps.last_heartbeat_at`, `retry_count`, `failure_reason` — Same semantics at the workflow step level.
- `workflow_execution_history` — Append-only log of `run.*`, `step.*`, and `step.timeout` events. Replaying this table yields a deterministic timeline for audits and diagnostics.

## Heartbeat Expectations
- Job handlers call `context.update(...)` whenever they mutate run state, automatically refreshing `last_heartbeat_at`. Use `context.heartbeat()` for long-running operations that do not need to persist other fields.
- Service steps emit implicit heartbeats each time orchestration writes metrics or status updates.
- The workflow worker monitors for timeouts using `WORKFLOW_HEARTBEAT_TIMEOUT_MS` (default `60s`) and checks every `WORKFLOW_HEARTBEAT_CHECK_INTERVAL_MS` (default `15s`).

## Timeout Handling
1. The worker selects running steps whose heartbeat or start time is older than the timeout window (see `findStaleWorkflowRunSteps`).
2. If the step has unused retries (`retry_count < maxAttempts - 1`), it is reset to `pending`, `retry_count` is incremented, and a `step.timeout` history event is recorded.
3. When retries are exhausted, the step transitions to `failed`, a timeout history event is written, and the run is re-enqueued so orchestration can surface the failure.

## Investigating Stalled Runs
```sql
-- List stale running steps older than the timeout window
SELECT wrs.id, wrs.step_id, wrs.last_heartbeat_at, wrs.retry_count
FROM workflow_run_steps wrs
JOIN workflow_runs wr ON wr.id = wrs.workflow_run_id
WHERE wrs.status = 'running'
  AND wr.status = 'running'
  AND coalesce(wrs.last_heartbeat_at, wrs.started_at) < NOW() - INTERVAL '60 seconds'
ORDER BY wrs.last_heartbeat_at NULLS FIRST
LIMIT 20;
```

```sql
-- Inspect execution history for a specific run
SELECT event_type, event_payload, created_at
FROM workflow_execution_history
WHERE workflow_run_id = $1
ORDER BY id;
```

## Manual Recovery Steps
1. **Validate Environment:** Ensure workers are online (`npm run workflows --workspace @apphub/catalog`) and Redis connectivity is healthy.
2. **Check History:** Query `workflow_execution_history` for `step.timeout` events to confirm which steps were retried or exhausted.
3. **Requeue If Needed:** If automation has not retried a stalled run, enqueue it manually: `node -e "require('./dist/queue').enqueueWorkflowRun('<run-id>')"` (or use the API endpoint once exposed).
4. **Reset Run:** To force a full rerun, update `workflow_run_steps` for the affected run to `pending`, clear `job_run_id`, `last_heartbeat_at`, and increment `retry_count` as needed, then enqueue the run. Always append a manual event to `workflow_execution_history` describing the intervention.
5. **Escalate:** If heartbeats fail persistently after retries, review worker logs for crashes, validate job handler instrumentation, and update alerting thresholds as required.

## Configuration Reference
- `WORKFLOW_HEARTBEAT_TIMEOUT_MS` — Max age for a running step heartbeat (milliseconds).
- `WORKFLOW_HEARTBEAT_CHECK_INTERVAL_MS` — Interval between heartbeat sweeps.
- `WORKFLOW_HEARTBEAT_CHECK_BATCH` — Max number of stale steps processed per sweep.
- `WORKFLOW_CONCURRENCY` — Worker parallelism; higher values may warrant shorter heartbeat intervals.

## Testing Considerations
- Add integration tests that simulate a stalled step by freezing heartbeats and verifying timeout events appear in `workflow_execution_history`.
- Extend existing e2e specs to assert that retried steps increment `retry_count` and record `failure_reason = 'heartbeat-timeout'` when exhausted.
- When writing unit tests, stub `updateWorkflowRunStep` and `appendWorkflowExecutionHistory` to confirm the worker issues the expected updates during recovery.
