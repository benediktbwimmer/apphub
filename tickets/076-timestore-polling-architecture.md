# Ticket 076: Timestore Frontend Polling Architecture Refresh

## Problem Statement
`TimestoreDatasetsPage` starts separate polling loops for datasets, lifecycle status, manifest, retention, and metrics. These intervals are uncoordinated, creating redundant API calls, extra renders, and higher load on the timestore service—especially when multiple tabs are open.

## Goals
- Consolidate polling for dataset detail data into a shared scheduler or cache so dependent components can subscribe without issuing duplicate requests.
- Provide a mechanism to pause or slow polling when the browser tab is hidden, minimizing unnecessary backend traffic.
- Ensure refetch triggers (manual refresh, mutations) still work seamlessly with the new architecture.

## Non-Goals
- Migrating the entire app to a new data fetching library; focus on the timestore section.
- Implementing server-sent events/websockets at this stage—stick with improved polling and caching.

## Implementation Sketch
1. Introduce a shared data layer (e.g., React Query or a custom polling context) for dataset detail resources, consolidating API calls and sharing results among `RetentionPanel`, `LifecycleControls`, `MetricsSummary`, etc.
2. Implement visibility-aware polling that suspends or throttles refresh intervals when the tab is hidden, resuming on focus.
3. Update existing hooks/components to consume the shared cache rather than instantiating independent `usePollingResource` instances.
4. Instrument fetch counts in development to validate the reduction in duplicate calls.
5. Add tests to ensure the consolidated polling still updates components after mutations and respects manual refresh actions.

## Deliverables
- A unified polling and caching strategy for timestore dataset detail data with visibility-aware throttling.
- Updated components using the shared data layer, eliminating redundant network requests.
- Tests and metrics demonstrating reduced API call volume and consistent UI updates.
