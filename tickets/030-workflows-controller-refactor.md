# Ticket 030: Modularize Workflows Controller State

## Problem
`useWorkflowsController` currently weighs in at ~1,600 lines and manages fetching, WebSocket handling, analytics state, asset inventory, event triggers, and AI builder orchestration in a single hook. The size and breadth make it hard to reason about and nearly impossible to unit test.

## Proposal
- Split the hook into domain-specific providers/hooks (runs, analytics, assets, event triggers, builder state) that can be composed inside `WorkflowsPage`.
- Co-locate fetch helpers and WebSocket handlers with each provider to cut down on cross-cutting conditionals and memo bookkeeping.
- Introduce targeted unit tests for the extracted hooks focusing on state transitions (e.g., run updates, analytics range changes).
- Update `WorkflowsPage` to consume the new providers and re-export a minimal controller for downstream consumers.

## Deliverables
- New hooks/providers with coverage for core state transitions.
- Refactored `WorkflowsPage` leveraging the smaller hooks.
- Documentation update (code comments or short ADR) outlining the new module boundaries.

## Risks & Mitigations
- **Regression risk:** Ensure existing Vitest/React Testing Library specs cover the workflows UI; add smoke tests for the extracted providers.
- **Incremental rollout:** Land refactor in stages (e.g., runs → analytics → assets) to keep PRs reviewable.
