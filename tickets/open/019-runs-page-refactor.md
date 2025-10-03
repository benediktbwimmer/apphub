# Extract reusable components from runs page

## Context
- `apps/frontend/src/runs/RunsPage.tsx:1` contains ~2.3k lines blending styling tokens, filters, saved-search integration, and retry flows.
- Reusable patterns (status filters, table rendering, retry dialogs) are locked inside the monolith.
- Upcoming workflow diff/replay and analytics features will further complicate the page without a refactor.

## Impact
- Any change to runs UI risks side effects due to shared mutable state and duplicated class names.
- Developers cannot reuse filter or table components elsewhere (e.g. jobs view) without copy/paste.
- Testing is limited because the component is difficult to mount in isolation for unit tests.

## Proposed direction
1. Extract filter panels, saved search widgets, tables, and retry dialogs into dedicated components under `apps/frontend/src/runs/components/`.
2. Move data-fetching + pagination logic into hooks (`useRunsData`, `useRunFilters`) decoupled from presentation.
3. Normalize styling tokens through shared design-system utilities to avoid inline class duplication.
4. Add Vitest/react-testing-library coverage for critical components (filters, retry flows) to guard refactor.
5. Prepare the layout to host future diff/analytics panels without further bloating the root component.

## Acceptance criteria
- Runs page root component shrinks substantially and orchestrates extracted components/hooks.
- Shared components are reusable in other surfaces (jobs/workflows) with consistent styling.
- Test coverage increases, ensuring filters and retries behave correctly after extraction.
