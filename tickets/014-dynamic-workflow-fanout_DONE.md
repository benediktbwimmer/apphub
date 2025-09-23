# Ticket 014: Dynamic Workflow Fan-Out Execution

## Summary
Add a first-class workflow capability that allows a step to emit a collection of child tasks at runtime so the orchestrator can launch N downstream job steps (fan-out) and aggregate their results before an optional fan-in step continues execution.

## Problem Statement
Current workflows require every step to be declared statically. When a job (Step A) returns a list of work items, operators must hard-code a fixed number of dependent steps or run additional automation outside the orchestrator. This prevents AppHub workflows from modeling real-world “map/reduce” pipelines, hampers reuse of generic jobs, and pushes teams toward brittle manual scripts.

## Goals & Scope
- Introduce a fan-out step type (e.g. `map`) that references a template step definition and a collection expression sourced from workflow context or job output.
- Extend the orchestrator to expand fan-out steps at runtime, enqueue child steps with synthetic identifiers, and track their completion before unlocking downstream dependencies.
- Persist generated step executions in `workflow_run_steps`, capturing parent step ID, index, and per-item parameters.
- Support aggregation semantics so a subsequent step (fan-in) receives a structured summary of the child results via the shared context.
- Surface dynamic branches through workflow run APIs and events so the frontend can render progress accurately.
- Add guardrails (max items, retry/backoff behavior) and configuration for operators to tune fan-out limits.

## Non-Goals
- Building user-facing authoring UX for fan-out definitions (tracked separately once API support exists).
- Supporting long-lived streaming jobs; focus on batch fan-out where each child run completes within standard job semantics.
- Introducing new external storage for intermediate artifacts beyond existing Postgres/Redis usage.

## Acceptance Criteria
- New workflow definitions can declare a fan-out step whose execution launches one job step per item returned by the parent data source, without predefining each child in the static DAG.
- Orchestrator waits for all generated child steps to resolve (success or configured failure policy) before scheduling dependent steps; run metrics and status reflect aggregated progress.
- Run records (`workflow_runs`, `workflow_run_steps`) store and expose parent/child relationships plus per-item metadata via REST/WebSocket responses.
- Shared context exposes aggregated child outputs under a deterministic key so follow-on steps can consume them without race conditions.
- Configurable limits (environment variables or definition metadata) prevent unbounded fan-out; violations fail the run gracefully with actionable error messaging.

## Implementation Notes
- Schema & storage: add `parent_step_id`, `fanout_index`, and `template_step_id` columns to `workflow_run_steps`; update row mappers and migrations accordingly.
- Definition model: extend `WorkflowStepDefinition` with a `fanOut` type that describes the collection expression (JSONPath-like or templated script) and the child template (job/service parameters, retry policy).
- Orchestrator updates:
  - Detect fan-out nodes when building the DAG, reserve a placeholder step, and drop generated child steps into the ready queue at runtime.
  - Track outstanding child executions via reference counting; reuse existing concurrency controls to cap simultaneous children.
  - Patch shared context using append-safe helpers (e.g., push onto arrays keyed by `storeResultAs`) to avoid clobbering sibling data.
- API & events: version `workflow.run.*` payloads to include dynamic step metadata (parent IDs, indices) and update REST serializers used by the frontend.
- UI & operator tooling: provide minimal fallback behavior (e.g., list dynamic children) so existing views do not crash; detailed visualization can follow-up later.
- Observability: extend metrics (success/failure counts, duration) to include fan-out children and record the max concurrency achieved.

## Dependencies
- Workflow DAG execution foundation from Ticket 012.
- Job runtime sandbox and bundle tooling (Tickets 006–008) to ensure child steps can execute in isolation.
- Frontend workflow views (Ticket 011) for displaying new run metadata.

## Testing Notes
- Unit tests for DAG expansion, context merging, and guardrail enforcement.
- Integration tests covering a simple A→fan-out(B)→C pipeline verifying correct number of child runs, aggregation results, and failure handling.
- E2E scenario in `services/catalog/tests` that mocks a job returning N items and asserts the orchestrator schedules N+2 steps and records outputs properly.
- Load test or soak test to validate concurrency limit handling and ensure Redis/Postgres load stays within acceptable bounds.

## Open Questions
- What expression language should define the fan-out collection (pure JSON templating vs. JMESPath-like syntax)?
- How should partial failures be treated: fail-fast, retry only the failed children, or allow configurable quorum success?
- Should child steps inherit or override timeouts/retry policies from the template step by default?
