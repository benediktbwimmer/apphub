# Ticket 086: Workflow Step Durable Retries

## Problem Statement
Workflow steps rely on transient retry loops in memory. If a step fails and the process crashes, attempts reset, and operators lack visibility or control. Building on durable retry primitives, we need to persist retry state and requeue workflow runs so steps resume with exponential backoff and warning indicators.

## Goals
- Persist retry metadata for failed steps/runs (`retry_state`, `next_attempt_at`, attempts) and enqueue delayed jobs for orchestration to resume.
- Teach `workflowOrchestrator` to resume from persisted state, increment attempts, and stop when policies hit limits or cancellations occur.
- Provide reconciliation so outstanding retries requeue on orchestrator startup.
- Expose warning state in runtime metadata so the UI can flag runs with active retries (actual UI handled later).

## Non-Goals
- Frontend changes for user actions.
- Trigger retry handling (covered separately).

## Implementation Sketch
1. **Orchestrator persistence**
   - When a step fails and retry policy allows another attempt, update the step record with `next_attempt_at`, `retry_state = 'scheduled'`, `retry_attempts`, then enqueue a workflow-run retry job.
   - On resume, load persisted step/run state, continue execution, and clear retry metadata on success.

2. **Queue integration**
   - Introduce job types for workflow retry scheduling with deterministic IDs; add helpers to compute delays based on policy/backoff.
   - On orchestrator startup, scan for scheduled step retries and ensure jobs exist.

3. **Warning states**
   - Update run context to include warning indicator when retries are pending so UI can display status badges later.

4. **Testing**
   - Integration tests covering step failure with retries, process restart mid-backoff, cancellation, and exhaustion.

## Deliverables
- Orchestrator updates for durable step retries.
- Queue scheduling/reconciliation for workflow retries.
- Tests validating persistence and resumption.
