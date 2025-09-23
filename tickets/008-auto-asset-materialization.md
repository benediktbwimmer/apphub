# Ticket 008: Event-Driven Auto Materialization for Workflow Assets

## Problem Statement
Our current workflow asset lineage captures producers, consumers, and freshness metadata, but keeping assets up to date still relies on manual triggers or periodic polling. We want an event-driven reconciliation flow similar to Dagster's auto-materialization so assets refresh immediately when upstream data changes or when freshness windows expire.

## Goals
- Emit structured `asset.produced` (and optional `asset.expired`) events from the catalog whenever a workflow produces or invalidates an asset.
- Maintain an in-memory asset dependency graph that maps assets to producing workflows and downstream dependents.
- Introduce an "asset materializer" worker that reacts to events and enqueues workflow runs automatically based on declared policies (freshness TTL/cadence, on-upstream-update).
- Provide visibility and auditability for auto-triggered runs (special trigger type, logs).

## Non-Goals / Out of Scope
- No UI work in this ticket (API/worker changes only).
- No new persistence layer for policies beyond existing workflow definitions.
- No change to workflow step semantics (jobs still return `result.assets`).

## Implementation Sketch
1. **Event Emission**
   - Extend `runWorkflowOrchestration` (or the persistence layer) to publish `asset.produced` events via the existing AppHub event bus/Redis stream with payload: `{ assetId, workflowSlug, runId, producedAt, freshness }`.
   - When freshness includes TTL/cadence, schedule delayed `asset.expired` events (BullMQ delayed job keyed by asset).

2. **Asset Graph Builder**
   - Walk workflow definitions on startup and after any change to build a map: `assetId -> { producers, consumers, policies }`.
   - Cache in memory inside the new worker; rebuild when receiving a `workflow.updated` event or on periodic refresh as fallback.

3. **Asset Materializer Worker**
   - Subscribe to `asset.produced` and `asset.expired` queues.
   - On `asset.produced`: mark asset fresh, compare timestamps for downstream assets; enqueue producer workflows for any stale dependents (respecting dedupe/in-flight tracking and max concurrency).
   - On `asset.expired`: enqueue the asset's producer workflow if no fresher run exists.
   - Set `trigger.type = 'auto-materialize'` when calling `enqueueWorkflowRun` so auditing is clear.

4. **Policies & Configuration**
   - Reuse existing `freshness` block for TTL/cadence. Allow optional `autoMaterialize` flags in workflow definitions (e.g., `onUpstreamUpdate: true`, `priority`).
   - Document new policy fields in `docs/assets-overview.md` and update schema validation if needed.

5. **Guardrails**
   - Maintain an in-flight set per workflow to avoid duplicate runs.
   - Implement exponential backoff / failure budget for assets that continually fail to materialize.
   - Add structured logs + metrics counters for auto-triggered runs.

## Deliverables
- Event emission code for asset production/expiry.
- Asset materializer worker (TypeScript) registered in services/catalog launch scripts.
- Updated workflow definition schema (if new policy fields) and documentation.
- Tests covering event -> run enqueue flow and dedupe logic (unit or integration as feasible).

## Acceptance Criteria
- Producing a workflow asset automatically emits an event and updates lineage as today.
- When an upstream asset updates, dependent assets with `onUpstreamUpdate` enabled trigger their producer workflows automatically.
- Expired assets (past TTL) are auto-rehydrated without manual intervention.
- API (or logs) shows auto-triggered workflow runs with `trigger.type = 'auto-materialize'`.
- Documentation explains how to opt-in and how the event-driven loop works.

## Open Questions
- Do we need configurable backoff/quiet hours per asset/workflow?
- Should we expose policy status (e.g., "last auto-materialize run", "next refresh time") via a new API endpoint?

## Dependencies
- Existing workflow asset snapshot tables and event bus.
- BullMQ/Redis already used for workflow queuing.

## Estimated Effort
- ~3-5 developer days including tests and documentation.
