# Ticket 058: Filestore Explorer & Monitoring

## Problem Statement
Filestore’s backend tracks nodes, rollups, reconciliation jobs, and emits SSE events for mutations, but the frontend has no surface to browse directories or inspect drift. Operators currently rely on CLI/SQL to understand storage state. We need a read-focused explorer that consumes Filestore APIs, surfaces rollup metrics, and streams live activity so operators can triage issues quickly.

## Goals
- Extend/verify service endpoints for browsing:
  - Implement `GET /v1/nodes` (pagination, backend/path filters, optional depth limit).
  - Implement `GET /v1/nodes/:id/children` for hierarchical navigation.
  - Optionally expose `GET /v1/nodes/:id/rollup` or embed rollup data in the list response.
- Build a Filestore explorer UI under `/services/filestore` with:
  - Node list/tree panel (search, filter by backend/state/drift, keyboard friendly).
  - Detail panel showing metadata, rollup stats, reconciliation status, and recent commands.
- Hook the SSE stream (`/v1/events/stream`) into an activity feed that reflects node created/updated/deleted + drift events.
- Provide manual reconciliation controls wired to `POST /v1/reconciliation`, respecting scope checks and idempotency guidance.
- Reuse shared polling/toast utilities, support dark/light mode, and persist layout state (selected node, filters).
- Add Vitest/component tests for schema parsing, pagination, SSE update application, and reconciliation interactions.

## Non-Goals
- Write operations (upload/move/copy/delete) — covered in Ticket 059.
- Artifact/bundle management or retention tooling (future work).
- Automated drift remediation UI (manual enqueue is sufficient for now).

## Implementation Sketch
1. Add/verify backend list endpoints with zod validation + unit tests; expose typed clients in `filestore/api.ts`.
2. Implement React components (`FilestoreExplorerPage`, `NodeListPanel`, `NodeDetailPanel`, `ActivityFeed`) and wire them into the Filestore layout routes.
3. Use `usePollingResource` for metrics/rollups and `EventSource` helpers for SSE subscriptions, merging events into detail state.
4. Display zero states and scope warnings; show inline reconciliation forms with optimistic updates.
5. Write tests for data normalization, SSE consumption, and reconciliation UX; ensure lint/tests continue to pass.

## Acceptance Criteria
- Visiting `/services/filestore` renders the explorer with working list/detail navigation and live activity feed updates via SSE.
- Operators with `filestore:write` can enqueue reconciliation jobs from the detail panel; users lacking scope see actionable guidance.
- Node filters/search apply successfully to retrieved pages; rollup/metrics display without blocking the rest of the UI when unavailable.
- Documentation mentions how to point the explorer at a local Filestore instance; lint/tests succeed.
