# Ticket 503: Decompose Jobs Page Into Testable Units

## Problem
`apps/frontend/src/jobs/JobsPage.tsx` centralizes fetching, editor state, AI dialogs, and diff rendering in a single 500+ line component. The dense state management causes re-render churn, complicates feature work, and makes targeted testing nearly impossible.

## Proposal
- Extract data fetching concerns into dedicated hooks (leveraging `useAuthorizedFetch` or React Query) for job lists, runtime status, and bundle snapshots.
- Split the UI into smaller components (stacked layout, editor/diff panels, AI controls) that receive explicit props.
- Replace the `useState` labyrinth with a reducer or state machine that captures panel states and side effects predictably.
- Add Vitest/RTL coverage for the new hooks/components, focusing on loading/error transitions and optimistic updates.

## Deliverables
- Refactored `JobsPage` composed of smaller components with clear responsibilities.
- New hooks with unit tests and storybook examples (if available) for regression protection.
- Performance check documenting render improvements or memoization strategy.

## Risks & Mitigations
- **UX regressions:** Run existing frontend test suites and capture before/after interaction recordings.
- **Incremental rollout:** Gate risky sub-features (AI edit, diff viewer) behind feature flags to ship changes gradually.
