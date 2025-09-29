# Ticket 500: Break Up Workflow Orchestrator Into Focused Modules

## Problem
`services/catalog/src/workflowOrchestrator.ts` has grown beyond 3,500 lines, mixing configuration parsing, queue coordination, secret resolution, step state transitions, and asset persistence. The monolith is hard to debug, exceeds reviewers' cognitive load, and resists unit testing—our only safety net today is the expensive integration scenario in `services/catalog/tests/workflowRetries.test.ts`.

## Proposal
- Extract configuration/resolver helpers (retry maths, concurrency targets) into a dedicated module that can be unit tested in isolation.
- Carve the step state machine into composable executors (service steps, job steps, fan-out) that expose clear inputs/outputs.
- Move asset side-effects and secret handling into focused utilities and inject them via the orchestrator entry point.
- Introduce lightweight unit tests around the new modules while keeping the existing integration spec as a regression guard.
- Document the new orchestration boundary in `docs/` so future features land in the right module.

## Deliverables
- Refactored orchestrator composed from smaller modules with dedicated test coverage.
- Updated queue worker/import sites to consume the new exports without behavioural changes.
- ADR or design note summarising module responsibilities and extension points.

## Risks & Mitigations
- **Regression risk:** Stage refactor by moving pure helpers first, then side-effectful executors, running the workflow retry tests plus lint/build on every step.
- **Coordination risk:** Pair with ops on deployment windows; ship behind feature flags if new modules touch retry scheduling.
