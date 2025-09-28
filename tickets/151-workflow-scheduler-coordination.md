# Ticket 151: Coordinate Workflow Scheduling Across Replicas

## Problem
Every `workflow-worker` spins up `startWorkflowScheduler` and writes directly to `workflow_schedules.next_run_at`. With more than one worker (including a second replica in minikube), we double enqueue runs and thrash retries because there is no coordination layer.

## Scope
Guarantee single ownership of schedule materialization and retry reconciliation across all pods while keeping the same deployment topology locally (minikube) and remotely.

## Implementation
- Introduce Postgres advisory locking around schedule selection. Wrap `listDueWorkflowSchedules` / `materializeSchedule` so a worker grabs `pg_try_advisory_xact_lock(schedule_id)` before processing, with timeout/backoff.
- Add optimistic concurrency to `updateWorkflowScheduleRuntimeMetadata` (include `updated_at` in `WHERE` clause) to surface contention explicitly.
- Extract scheduler loop into a dedicated module that can be toggled into “leader” mode. Use advisory lock (e.g., `pg_try_advisory_lock(scheduler_tag)`) with keepalive to ensure only one active leader at a time. Other replicas idle until lock is free.
- Emit metrics/logs for: acquired locks, contention, skipped schedules. Wire these into `/admin/event-health` and Grafana dashboards.
- Provide Helm/minikube values to scale scheduler replicas safely (default 2) with documented expectations.

## Acceptance Criteria
- Two workflow workers in minikube produce exactly one workflow run per schedule window across 10-minute soak test.
- Lock contention metrics are visible and alarms fire if lock cannot be acquired for >30s.
- Unit/integration tests simulate dual workers and verify no duplicate runs.
- Documentation updated with leader-election behavior and instructions for scaling worker replicas.

## Rollout & Risks
- Roll out behind feature flag (`WORKFLOW_SCHEDULER_ADVISORY_LOCKS`). Enable in staging, monitor, then promote to prod/local defaults.
- Timeout/lock errors should surface through health checks; ensure worker exits if it cannot maintain leadership.
