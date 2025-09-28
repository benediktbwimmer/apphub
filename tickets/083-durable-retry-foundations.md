# Ticket 083: Durable Retry Foundations

## Problem Statement
Our current scheduler drops work when throttling or source pauses apply because retries live only in Redis. Before we can deliver full Temporal-style durability, we need shared primitives: persistent retry state, reconciliation utilities, and backoff helpers. This ticket sets the base layer so later work can extend it to triggers, workflow steps, and UI.

## Goals
- Introduce shared exponential backoff utilities usable across event ingress, trigger processing, and workflow orchestration.
- Add Postgres tables/columns for persisted retry state (`retry_state`, `next_attempt_at`, `retry_attempts`, metadata) without yet wiring them into business logic.
- Provide database helpers for working with the new tables/columns and cover them with unit/integration tests.
- Document the new schema, feature flags (if any), and migration process.

## Non-Goals
- Scheduling or processing retries for triggers or workflow steps.
- UI/metrics changes.
- Any change to current event ingress behavior beyond safe data persistence primitives.

## Implementation Sketch
1. **Backoff utilities**
   - Add a `retries/backoff.ts` helper with exponential backoff + jitter and time calculation helpers.
   - Provide tests verifying deterministic output when randomness is mocked.

2. **Schema updates**
   - Extend `workflow_trigger_deliveries` and `workflow_run_steps` with `retry_state`, `next_attempt_at`, `retry_attempts`, and `retry_metadata` columns but leave defaults so current behavior is unaffected.
   - Create an `event_ingress_retries` table that stores event ID, source, retry state, attempts, next attempt timestamp, last error, metadata, created/updated timestamps.

3. **Database helpers**
   - Implement typed accessors in `db/workflows.ts` (insert/update) and a dedicated module for `event_ingress_retries` (upsert, update, delete, fetch due).
   - Update mappers/types to expose new fields.

4. **Documentation**
   - Add migration notes to `docs/` describing new columns/table and intended future use.
   - Outline the follow-up tickets for wiring logic, UI, and monitoring.

## Deliverables
- `retries/backoff.ts` module with tests.
- Migration adding retry columns/table, plus updated TypeScript row/record definitions and helpers.
- Documentation covering schema changes and usage guidance.
