# Ticket 017: Modularize Workflows UI Surface

## Summary
Break down the monolithic `WorkflowsPage` component into focused modules, hooks, and UI primitives so the workflows surface becomes easier to maintain, extend, and test.

## Problem Statement
The `apps/frontend/src/workflows/WorkflowsPage.tsx` file mixes list rendering, filtering controls, WebSocket synchronization, AI builder triggers, run submission flows, and modal orchestration across more than 1,200 lines. The breadth of responsibilities drives high cognitive load, makes bugs harder to isolate, and complicates onboarding for new contributors. Without clear boundaries, shared concerns (data fetching, toast management, selection state) are repeatedly reimplemented inline, limiting reuse across the frontend.

## Goals & Scope
- Extract reusable hooks for workflows data lifecycle management (e.g., summaries, run history, active run polling) that encapsulate fetch, WebSocket, and error handling concerns.
- Create presentational components for the primary UI regions—list, detail, editors, and run inspectors—so layout and styling logic is colocated with each surface rather than the root page.
- Isolate modal/dialog orchestration (launch run, edit workflow, AI builder entry) into dedicated controllers to reduce branching and effect nesting in `WorkflowsPage`.
- Introduce a shared utilities module for workflow-specific helpers (status labels, JSON formatting) and delete the duplicated inline helpers once consumers adopt the shared exports.
- Ensure new modules expose well-typed props and return values so downstream consumers benefit from type inference and editor tooling.

## Non-Goals
- Rewriting the workflows backend APIs or changing the data contracts delivered to the frontend.
- Adding new workflow features beyond the modularization required to achieve the refactor.
- Implementing routing changes—the router migration is tracked separately.

## Acceptance Criteria
- `WorkflowsPage.tsx` shrinks to a compositional shell that orchestrates extracted hooks/components in fewer than 300 lines.
- Hooks encapsulate data fetching, polling, and WebSocket resubscription logic with corresponding unit tests validating state transitions and cleanup.
- Presentational components render with the same visual output as today, and Storybook (if applicable) or visual regression checks confirm parity.
- Inline helper functions (formatters, status mappers) that become redundant after extraction are removed from `WorkflowsPage.tsx`.
- Developer documentation (README or `docs/`) outlines the new module structure and extension guidelines for workflows.

## Implementation Notes
- Start by mapping the major responsibilities inside `WorkflowsPage` and grouping them into logical domains (data fetching, list rendering, run management, AI builder entry) before creating dedicated files.
- Leverage existing shared hooks/utilities (toasts, API client wrappers) when building new hooks to avoid reinventing side-effect handling.
- Use Context or prop drilling judiciously; prefer colocated hooks/components to avoid re-renders while keeping dependencies explicit.
- Add targeted unit tests for extracted hooks using React Testing Library or Vitest to simulate WebSocket events and polling timers.
- Consider introducing a lightweight state machine or reducer for run submission flows if it reduces effect complexity compared to ad-hoc state variables.

## Dependencies
- Existing API client helpers and WebSocket utilities used by the current workflows implementation.
- Toast/notification and analytics hooks that report workflow events today.
- Documentation tooling for recording the new structure.

## Testing Notes
- Add unit tests for hooks covering loading, success, error, and cleanup cases (including WebSocket reconnects).
- Run existing end-to-end smoke tests that exercise workflow list interactions, run launches, and editor flows to ensure behavioral parity.
- Perform manual QA in supported browsers to confirm that modals, AI builder triggers, and run details behave identically after extraction.

## Deliverables
- Refactored workflows frontend module structure with extracted hooks, components, and utilities.
- Updated documentation describing module responsibilities and guidelines for future workflow UI changes.
- Test evidence demonstrating parity and coverage for the modularized workflows surface.
