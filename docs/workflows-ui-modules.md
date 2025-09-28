# Workflows UI Modules

The workflows surface is now composed from a set of focused modules that mirror the page's core responsibilities. The refactor splits orchestration concerns into domain-specific providers so features can evolve independently while the page composes them.

## Hooks & Providers

- `WorkflowsProviders` (see `apps/frontend/src/workflows/hooks/useWorkflowsController.ts`) wraps the page with ordered providers for access, definitions, runs, analytics, assets, event triggers, and builder state.
- `useWorkflowDefinitions` handles catalog queries, filter/search state, service reachability, and runtime summaries used by the list panel.
- `useWorkflowRuns` owns workflow details, run history, step hydration, manual-run enqueueing, and live run updates via sockets.
- `useWorkflowAnalytics` manages stats/metrics snapshots, history buffers, and range/outcome selections while reacting to analytics socket events.
- `useWorkflowAssets` fetches inventory, asset details, partitions, and auto-materialization activity with per-workflow caches.
- `useWorkflowEventTriggers` coordinates trigger CRUD, delivery history, scheduler health, and event sample queries.
- `useWorkflowBuilder` centralizes builder/AI modal state, submission flows, and permission gating derived from `useWorkflowAccess`.
- `useWorkflowsController` is now a thin composition helper that stitches the above slices together and exposes shared actions (e.g., `handleRefresh`).

## Components

- `WorkflowsHeader` renders the primary action buttons (AI Builder, create workflow, refresh).
- `WorkflowDefinitionsPanel` owns the list of definitions plus empty/errored states.
- `WorkflowDetailsCard` shows metadata, triggers, and step breakdown for the selected workflow.
- `WorkflowRunHistory` handles the runs table, refresh action, and runtime status metadata.
- `WorkflowRunDetails` renders the selected run's metrics, output, and per-step history.
- `WorkflowTopologyPanel` embeds the new React Flow canvas with normalized topology data, surfacing counts, cache metadata, and selection-aware highlighting.

Existing shared components (`ManualRunPanel`, `WorkflowGraph`, `WorkflowFilters`, `StatusBadge`) continue to be reused by the page shell.

## Testing

- `apps/frontend/src/workflows/hooks/__tests__/useWorkflowsController.test.ts` now wraps hooks with `WorkflowsProviders` and exercises cross-slice flows.
- Additional specs cover `useWorkflowRuns` (socket run updates) and `useWorkflowAnalytics` (range transitions) to keep extracted hooks regression-safe.
- Page-level behaviour remains covered by `WorkflowsPage.test.tsx`.

When extending the workflows experience, prefer colocating UI concerns with these primitives rather than expanding the root page component. Hooks should expose explicit, typed return values to keep call-sites ergonomic.
