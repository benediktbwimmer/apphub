# Ticket 084: Durable Event Ingress Retries

## Problem Statement
Source-level throttling currently drops events after persisting them. With the retry foundation in place, we must make the event ingress worker schedule and reconcile retries using Postgres as the source of truth so events resume once pauses lift or rate limits clear.

## Goals
- When source evaluation rejects an event, persist retry intent in `event_ingress_retries` and schedule a delayed BullMQ job using backoff utilities.
- On retry execution, pull the event from Postgres, re-evaluate rate limits, and either launch triggers or reschedule with incremented attempts.
- Add startup reconciliation to requeue missing retry jobs after worker restarts or Redis flushes.
- Provide operator logging/metrics to observe scheduled, retried, cancelled, or exhausted events.

## Non-Goals
- Trigger-level throttling retries.
- Workflow step retries or UI enhancements.

## Implementation Sketch
1. **Worker updates**
   - Modify `eventIngressWorker` to handle two job types: immediate events and retry jobs (containing event IDs).
   - When `registerSourceEvent` returns disallowed, call a helper that upserts retry state (increment attempts, compute next attempt timestamp, store `retry_state = 'scheduled'`, record reason) and schedules the delayed job.
   - On retry processing, fetch the workflow event, check for cancellation, re-run `registerSourceEvent`, and either enqueue triggers or reschedule via backoff.

2. **Scheduling helpers**
   - Add queue helpers in `queue.ts` to schedule event retry jobs with deterministic job IDs (`event-retry:<eventId>:<attempt>`).
   - On worker startup, scan Postgres for scheduled retries and ensure jobs exist (idempotent).

3. **Metrics & logging**
   - Extend `eventSchedulerMetrics` to emit counters for retry scheduled, due, completed, rescheduled, and cancelled.
   - Emit structured logs for observability (source, attempt, next attempt, reason).

4. **Testing**
   - Integration tests covering: initial throttle scheduling, retry launching after pause, cancellation path, and reconciliation after clearing the queue.

## Deliverables
- Updated event ingress worker and queue helpers with durable retry scheduling.
- Metrics/logging capturing retry lifecycle.
- Tests validating retry persistence and replays.
