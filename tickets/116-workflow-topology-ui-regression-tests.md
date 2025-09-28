# Ticket 116: Workflow Topology UI Regression Tests

## Problem Statement
The workflow topology canvas continues to regress in dark mode legibility and long-lived sessions because we lack automated UI coverage. Manual smoke tests miss contrast issues (e.g., invisible edges) and ReactFlow virtualization bugs that surface after idle time. Without targeted browser tests, we risk shipping future regressions unnoticed.

## Goals
- Stand up Playwright-based UI tests that exercise the topology explorer under both light and dark themes.
- Validate graph rendering including node count, at least one visible edge, and tooltips/labels after rendering completes.
- Simulate prolonged sessions to detect virtualization bugs (nodes disappearing after inactivity) and ensure fit/zoom controls keep nodes visible.
- Integrate tests into the frontend CI pipeline as required checks.

## Non-Goals
- Replacing existing unit tests for graph normalization or API contracts.
- Building a full accessibility audit suite (tracked separately under Ticket 097).
- Covering backend graph API performance; these tests focus on the frontend surface.

## Implementation Sketch
1. Add Playwright to `apps/frontend` devDependencies and configure a topology test project with shared auth helpers.
2. Seed deterministic graph fixtures via MSW or mock API responses to guarantee stable topology layouts.
3. Write scenarios that:
   - Load the topology view in light mode and confirm nodes, edges, and labels are visible.
   - Toggle dark mode (or spoof `prefers-color-scheme`) and re-run visibility assertions, including contrast checks on edge strokes.
   - Leave the page idle (using `page.waitForTimeout`) and trigger `fitView`, then ensure node count remains unchanged and edges are still present.
4. Run the suite in CI headless mode and document the workflow in `docs/workflow-topology/testing.md`.

## Deliverables
- Playwright test suite under `apps/frontend/tests/topology/` with deterministic fixtures.
- CI job invoking `npm run test:ui --workspace @apphub/frontend` and failing on regressions.
- Documentation covering setup, running locally, and updating fixtures.
