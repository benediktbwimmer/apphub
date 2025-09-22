# Workflows UI Modules

The workflows surface is now composed from a set of focused modules that mirror the page's core responsibilities. The goal of this refactor is to provide lightweight entry points for new contributors while isolating data orchestration from presentational concerns.

## Hooks

- `useWorkflowsController` (in `apps/frontend/src/workflows/hooks/`) centralizes data fetching, WebSocket subscriptions, permission checks, and action handlers (manual runs, builder triggers, refresh).
- Consumers can optionally provide a `createWebSocket` factory (used in tests) while the hook manages reconnection, runtime summaries, and derived filter state.

## Components

- `WorkflowsHeader` renders the primary action buttons (AI Builder, create workflow, refresh).
- `WorkflowDefinitionsPanel` owns the list of definitions plus empty/errored states.
- `WorkflowDetailsCard` shows metadata, triggers, and step breakdown for the selected workflow.
- `WorkflowRunHistory` handles the runs table, refresh action, and runtime status metadata.
- `WorkflowRunDetails` renders the selected run's metrics, output, and per-step history.

Existing shared components (`ManualRunPanel`, `WorkflowGraph`, `WorkflowFilters`, `StatusBadge`) continue to be reused by the page shell.

## Testing

- `apps/frontend/src/workflows/hooks/__tests__/useWorkflowsController.test.ts` exercises loading flows, manual-run state handling, and WebSocket cleanup by providing deterministic mocks.
- Page-level behaviour remains covered by `WorkflowsPage.test.tsx`.

When extending the workflows experience, prefer colocating UI concerns with these primitives rather than expanding the root page component. Hooks should expose explicit, typed return values to keep call-sites ergonomic.
