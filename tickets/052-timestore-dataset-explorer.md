# Ticket 052: Ship Timestore Dataset Explorer (Read-Only)

## Problem Statement
Operators need visibility into Timestore datasets before we expose lifecycle controls. The service already exposes `/admin/datasets` and `/admin/datasets/:id` endpoints, but the UI lacks a dedicated surface to browse datasets, inspect metadata, and understand storage targets.

## Goals
- Build a `TimestoreDatasetsPage` that consumes the new services layout and renders a searchable, paginated list of datasets.
- Provide a master/detail view where selecting a dataset fetches `/admin/datasets/:datasetId` and `/admin/datasets/:datasetId/manifest` to show schema, storage target, partitions overview, and IAM info.
- Display health/availability badges using `/admin/lifecycle/status` summaries (or placeholder if scopes missing).
- Ensure all fetches pass through `usePollingResource` with scope-aware error states and retry affordances.
- Add minimal doc updates describing how to point the frontend at a local Timestore instance.

## Non-Goals
- Implement lifecycle operations, retention editing, or the query console (handled in Ticket 053).
- Render raw partition tables beyond the aggregate summary.
- Support dataset mutations.

## Implementation Sketch
1. Create `apps/frontend/src/timestore/types.ts` describing dataset, manifest, lifecycle status, and related payloads with Zod validators.
2. Implement list + detail components (e.g., `DatasetListPanel`, `DatasetDetailPanel`) using the shared layout and responsive design that matches existing admin panels.
3. Use `usePollingResource` to poll the dataset list every 30s and lifecycle status every minute; allow manual refresh via button.
4. Render zero states for "no datasets", "missing scope", and "service unavailable", wiring them into the error boundary from Ticket 050.
5. Add Vitest/component tests covering payload parsing, selection behavior, and polling cleanup.
6. Update `docs/timestore-observability.md` or create a doc snippet referencing the new UI entry point for dataset visibility.

## Acceptance Criteria
- `/services/timestore` lists datasets, supports search/filter, and updates data without page reloads.
- Selecting a dataset shows detail cards with manifest metadata, storage target badge, IAM scopes, and timestamps.
- Missing scopes or network failures yield actionable UI prompts without crashing the route.
- Tests validate zod parsing and selection state, and lint/tests continue to pass.
