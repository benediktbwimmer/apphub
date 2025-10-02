# Workflow step status stuck at `running` after successful job completion

## Summary
- Workflow run `80ffaf7d-bde9-48a9-ab91-6efc1e931c6c` (observatory-daily-publication) is marked `succeeded`, and both underlying job runs succeeded, but the `workflow_run_steps` rows for `generate-plots` and `publish-reports` remain `status='running'`, `retry_state='pending'/'scheduled'`, `completed_at=NULL`.
- UI shows the run as succeeded yet still flags step errors from an earlier retry, which is confusing.

## Observations
- `workflow_run_steps` row for `generate-plots` still has `retry_state='pending'`, `job_run_id=…aec27be3…`, no `completed_at`.
- The corresponding `job_runs` row has `status='succeeded'`, `completed_at` set, `result` populated.
- `workflow_execution_history` shows multiple `step.retry-scheduled` events and repeated `run.status = succeeded` entries every ~30s, suggesting the orchestrator kept re-enqueuing the step even after success.
- `retry_state` never flips to `completed`, so the retry backlog likely keeps scheduling the step despite the job's success.
- This mismatch persists across new dashboard/publish runs, so it isn’t just stale UI cache.

## Hypothesis
- When the retry pipeline schedules a step, the orchestrator updates the job run but fails to write the final `workflow_run_steps` row (maybe due to race with retry worker / transaction ordering). Result: job completes, but the step stays in `running` with `retry_state='scheduled'` and is reprocessed indefinitely.
- Alternatively, the orchestrator might return early because the job succeeded but the retry record wasn’t cleared.

## Suggested investigation
1. Inspect `services/core/src/workflow/executors.ts` + `db/workflows.ts:updateWorkflowRunStep` to confirm we always set `status='completed'`, `retry_state='completed'`, `completed_at` in the same transaction as job success.
2. Trace the retry backlog processor (`services/core/src/retryBacklog.ts`) to ensure it clears `retry_state` when a `job_run` completes successfully.
3. Add logging when the orchestrator updates a step to `completed` to verify whether it’s invoked for this run.
4. Once fixed, write a regression test (or harness) that simulates job success after retries and asserts that `workflow_run_steps.status` transitions to `completed`.

## Acceptance criteria
- After a job run succeeds, the related `workflow_run_steps` row transitions to `status='completed'` (or appropriate terminal state) with `retry_state='completed'` and `completed_at` populated.
- The retry backlog no longer repeatedly schedules finished steps.
- Workflow UI reflects the correct step status without lingering “Running” badges or stale errors.
