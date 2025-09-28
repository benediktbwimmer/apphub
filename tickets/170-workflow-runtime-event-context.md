# Ticket 170: Workflow Runtime Event Context Propagation

## Problem Statement
Workflow jobs emit platform events today with no awareness of the workflow run that launched them. Without contextual metadata, the topology view cannot connect job steps to downstream event sources. We need a lightweight way to capture run context inside every job execution path so subsequent publishing layers can attach it to emitted events.

## Goals
- Capture `{ workflowDefinitionId, workflowRunId, workflowRunStepId, jobRunId, jobSlug }` for every step launch regardless of runtime (inline handler, bundle sandbox, docker runner).
- Expose the context via AsyncLocalStorage for in-process handlers and serialize it for sandbox/child processes with an `APPHUB_WORKFLOW_EVENT_CONTEXT` payload.
- Ensure job retries, fan-out steps, and concurrent executions keep context isolation.

## Non-Goals
- Modify event publishing APIs directly.
- Persist or analyze event edges; later tickets own ingestion and topology updates.
- Implement telemetry or database schema changes.

## Implementation Sketch
1. Add a `workflowEventContext` helper in the catalog orchestrator that seeds AsyncLocalStorage before invoking `executeJobRun` and makes context getters available.
2. Extend runtime adapters (inline handler, sandbox runner, docker runner) to carry the context—propagate through child IPC/environment and install a tiny bootstrap in `childRunner.ts` to expose it back to Node handlers.
3. Update job runtime utilities to offer `getWorkflowEventContext()` so downstream code can access it without reaching into ALS internals.
4. Add unit coverage for concurrent job launches and sandbox propagation; document the contract under `docs/events.md`.

## Deliverables
- Context propagation utilities checked into `services/catalog/src/workflowOrchestrator.ts` and job runtime modules with tests.
- Docs note describing the new `APPHUB_WORKFLOW_EVENT_CONTEXT` contract and AsyncLocalStorage helper.
- Validation notes confirming fan-out and retry scenarios maintain distinct context payloads.
