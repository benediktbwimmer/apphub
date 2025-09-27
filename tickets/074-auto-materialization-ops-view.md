# Ticket 074: Surface Auto-Materialization Operations View

## Problem Statement
Operators currently monitor event-driven triggers via the Workflows UI, but auto-materialization activity remains opaque. There is no consolidated view of recent auto-runs, cooldown status, or asset freshness. Troubleshooting asset-driven automation requires log spelunking and database queries.

## Goals
- Extend the workflow detail experience to display auto-materialization history, in-flight runs, cooldown timers, and asset freshness signals.
- Reuse data from the materializer state (post-ticket 071) and existing asset inventory endpoints where possible.
- Provide quick filters (e.g., by asset, status) and surface backoff reasons inline.

## Non-Goals
- Redesigning the overall workflows page layout beyond adding the new panel.
- Building entirely new APIs if existing data can be exposed with minor extensions.

## Implementation Sketch
1. Add backend endpoints or extend existing ones to expose auto-run history, cooldown metadata, and the latest asset freshness per workflow.
2. Create a frontend panel within `WorkflowsPage` that mirrors the trigger health UI, showing timelines, counts, and freshness indicators.
3. Include controls to refresh data and deep-link to asset histories or workflow runs.
4. Write UI tests verifying rendering states (loading, empty, populated) and ensure accessibility considerations (keyboard navigation, ARIA labels).
5. Update documentation to guide operators on interpreting the new panel.

## Acceptance Criteria
- Operators can view recent auto-materialization runs, failure cooldowns, and freshness indicators directly in the UI.
- The panel updates via live refresh or manual reload and handles empty/error states gracefully.
- Tests cover rendering, data loading, and basic interactions.
- Documentation references the new view with screenshots or walkthroughs.
