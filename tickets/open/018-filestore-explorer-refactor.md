# Decompose filestore explorer frontend

## Context
- `apps/frontend/src/filestore/FilestoreExplorerPage.tsx:1` is a 4k-line component mixing data fetching, state management, and UI rendering.
- Shared hooks/components cannot be reused elsewhere because logic is tightly coupled inside the page file.
- Feature work (e.g. search, diff, bulk actions) is painful due to the monolithic structure.

## Impact
- Code reviews and onboarding for filestore UI changes are slow and error-prone.
- Repeated patterns (toasts, fetchers, tree rendering) diverge from other frontend modules.
- Lack of modularity blocks extraction of shared primitives for future admin surfaces.

## Proposed direction
1. Extract data hooks (fetch mounts, stream updates, mutations) into `apps/frontend/src/filestore/hooks/`.
2. Break UI into smaller components (sidebar, tree, detail panel, action modals) with clear props/contracts.
3. Introduce state machines or reducers for complex selection/mutation flows to isolate logic from presentation.
4. Add unit/integration tests covering extracted hooks/components to ensure parity with current behaviour.
5. Document the new structure to guide contributors adding future filestore features.

## Acceptance criteria
- Filestore explorer page composes modular hooks/components under 400 lines, with logic isolated in dedicated files.
- Reusable primitives power both the explorer and any future filestore views.
- Test suite validates refactored pieces, and UX remains unchanged for existing flows.
