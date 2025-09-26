# Ticket 061: Model Workflow Event Triggers & Matching Rules

## Problem Statement
With events landing in `workflow_events`, we still lack a declarative way to describe which workflows should react to specific event types and under what conditions. Today the scheduler only understands asset-based policies; without a schema-backed trigger configuration we cannot safely attach workflows to event patterns, enforce throttles, or reason about idempotency.

## Goals
- Introduce `workflow_event_triggers` and `workflow_trigger_deliveries` tables to capture trigger definitions, status, and delivery history.
- Support matching on event `type`, optional `source`, and JSONPath predicates against the payload metadata.
- Store per-trigger throttling rules (max matches per interval, concurrency caps) and idempotency key expressions.
- Version trigger definitions so changes are auditable and rollbacks are possible.

## Non-Goals
- Building the evaluation worker or queue plumbing (handled in a dedicated ticket).
- Adding UI or CLI management surfaces (addressed later).
- Supporting arbitrary user-authored code inside predicates.

## Implementation Sketch
1. Design migrations for `workflow_event_triggers` (workflow FK, status, type/source filters, predicate JSON, parameter template, throttles, idempotency expression, version metadata) and `workflow_trigger_deliveries` (eventId, triggerId, status, attempts, runId, timestamps).
2. Extend `services/catalog/src/db/workflows.ts` with CRUD helpers for the new tables and typed records in `db/types`.
3. Implement JSONPath predicate storage (include schema validation to ensure allowed operators and depth limits).
4. Capture version history either via `version` column + `updatedBy` metadata or audit table, consistent with existing workflow change-tracking patterns.
5. Write unit tests covering migrations, predicate validation, and CRUD flows.

## Acceptance Criteria
- Database migrations apply cleanly and produce indexes supporting lookup by `event_type`, `event_source`, and trigger status.
- CRUD helpers allow creation, update, soft-delete/disable, and listing of triggers with version metadata.
- Predicate schemas reject unsupported operators and ensure payload references remain bounded.
- Tests confirm the schema constraints and helper behavior.
