# Ticket 085: Trigger Delivery Retry Pipeline

## Problem Statement
Event triggers marked `throttled` or blocked by max concurrency stay stuck because we never retry them. With durable storage in place, we need a pipeline that reschedules throttled deliveries when capacity returns, including reconciliation and operator controls.

## Goals
- Persist retry intent on throttled/concurrency-limited deliveries (`next_attempt_at`, `retry_state`, metadata) and schedule delayed jobs.
- Rehydrate deliveries on retry: load the original envelope + trigger definitions, re-run predicates/throttle checks, and launch workflows when allowed.
- Provide reconciliation on worker startup to requeue missing jobs.
- Track attempts/backoff per delivery and skip counting the delivery’s previous `throttled` state in rate-limit queries so retries can succeed.
- Surface metrics/logs for throttled queued, retried, succeeded, exhausted.

## Non-Goals
- UI changes for manual cancellation (handled later).
- Workflow step retries.

## Implementation Sketch
1. **Delivery persistence**
   - Update `processEventTriggersForEnvelope` to set `retry_state`, `next_attempt_at`, `retry_metadata` when throttle/concurrency fires; use shared backoff utilities.
   - Create helpers to enqueue trigger retry jobs (`event-trigger-retry:<deliveryId>:<attempt>`), keyed by delivery + attempt.

2. **Retry processing**
   - Extend `eventTriggerWorker` to handle retry jobs: fetch delivery + event, ensure not cancelled, call the same processing flow with adjustments to avoid counting the old `throttled` record.
   - When retry succeeds, clear retry state; when throttle persists, reschedule with incremented attempts.

3. **DB adjustments**
   - Update `countRecentWorkflowTriggerDeliveries` to exclude the delivery ID being evaluated when retrying to avoid perpetual throttling.
   - Provide helper queries to list scheduled trigger retries for reconciliation.

4. **Metrics/testing**
   - Record metrics for retries scheduled/completed/exhausted.
   - Add integration tests involving throttle windows and max concurrency to ensure retries eventually launch once limits reset.

## Deliverables
- Trigger processor and worker support for durable retries.
- Queue scheduling/reconciliation for trigger delivery retries.
- Tests and metrics covering retry lifecycle.
