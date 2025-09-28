# Ticket 171: Event Bus Workflow Context Injection

## Problem Statement
Once jobs expose workflow context, the event bus must automatically attach that data to every published envelope. Manually wiring metadata in individual publishers is error-prone and unlikely to cover all services. We need a central hook in `@apphub/event-bus` so the metadata rides along without API churn.

## Goals
- Teach `createEventPublisher` to detect workflow context (AsyncLocalStorage or `APPHUB_WORKFLOW_EVENT_CONTEXT`) and enrich envelopes with a reserved `metadata.__apphubWorkflow` block.
- Keep existing publisher signatures and validation behavior intact.
- Provide opt-out safeguards for oversized metadata or non-JSON-safe values.

## Non-Goals
- Persist sampled edges or alter catalog ingestion (later tickets).
- Introduce new environment configuration knobs beyond limits needed for safety.
- Modify legacy publishers that already set `metadata.__apphubWorkflow` manually; they should simply pass through.

## Implementation Sketch
1. Add a `resolveWorkflowContext()` helper inside `packages/event-bus` that first checks ALS via the helper from Ticket 170, then falls back to `APPHUB_WORKFLOW_EVENT_CONTEXT`.
2. During `normalizeEventEnvelope`, merge the workflow context into `metadata.__apphubWorkflow` when present, trimming unexpected fields and enforcing a maximum serialized size.
3. Update the type definitions and runtime validation to allow the reserved metadata field while rejecting mutated shapes.
4. Cover inline and queue-backed modes with unit tests; ensure no-op behavior when context is absent and that closures survive publisher reuse.

## Deliverables
- Updated `packages/event-bus` source and typings with context injection logic plus tests.
- Safety guardrails (size cap, schema validation) documented in `docs/events.md` and release notes for dependent teams.
- Verification notes confirming sample publishers automatically emit the metadata when run inside instrumented workflows.
