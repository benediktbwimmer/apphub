# Ticket 062: Implement Event Trigger Worker & Workflow Launch Integration

## Problem Statement
Trigger definitions alone do not run workflows. We need a worker that evaluates incoming events against trigger predicates, enforces throttling/idempotency, and enqueues workflow runs via the existing orchestration pipeline. Without this worker, events pile up with no automation, and we cannot ensure safe, deduplicated execution.

## Goals
- Build an `EventTriggerWorker` that consumes validated events, matches eligible triggers, and records delivery attempts in `workflow_trigger_deliveries`.
- Enforce per-trigger throttles (events per interval), outstanding run caps, and idempotency keys before launching workflows.
- Render workflow parameters using a sandboxed template engine fed by the event payload and envelope metadata.
- Attach `triggerContext` metadata to workflow runs (`type: "event"`, event id, trigger id, correlation id) for downstream visibility.

## Non-Goals
- Managing trigger CRUD or UI surfaces.
- Handling cross-service event publishing (covered elsewhere).
- Implementing complex rate limiting at the Redis layer (basic in-process throttles suffice initially).

## Implementation Sketch
1. Create the worker in `services/catalog/src/eventTriggerWorker.ts` using BullMQ and shared queue connection utilities.
2. Load candidate triggers via new DB helpers filtered by event type/source; evaluate JSONPath predicates against the payload.
3. Persist delivery records with optimistic locking, tracking status transitions (`pending`, `matched`, `throttled`, `launched`, `failed`).
4. Integrate with workflow orchestration by calling `createWorkflowRun` + `enqueueWorkflowRun`, injecting parameters from the template engine (e.g., `liquidjs` without eval) and recording `triggerContext`.
5. Publish structured logs, metrics (matches, throttles, failures), and push problematic events to DLQ when evaluation crashes.
6. Add tests for predicate matching, throttling enforcement, idempotency handling, and parameter rendering edge cases.

## Acceptance Criteria
- Worker processes events end-to-end, launching workflows when predicates pass and throttles allow.
- Duplicate events with the same idempotency key are skipped, with delivery history reflecting dedupe.
- Throttled triggers are recorded without launching runs and resume once limits allow.
- Workflow runs contain `triggerContext` metadata accessible via API and logs.
- Test suite covers matching, throttling, idempotency, and template rendering behaviors.
