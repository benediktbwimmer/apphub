# Ticket 059: Filestore Write Mode (Upload / Move / Copy / Delete)

## Problem Statement
Filestore currently exposes read and reconciliation flows only. Operators still need shell or CLI access to upload files, move or copy nodes, edit metadata, and perform recursive deletes. To complete the services hub integration, we must add write-mode APIs and a UI that let authorized users manage storage safely with idempotency, progress feedback, and event telemetry.

## Goals
### Backend
- Extend the command orchestrator with new command types: `uploadFile`, `writeFile`, `copyNode`, `moveNode`, and enhanced delete handling (recursive + soft delete awareness).
- Add REST endpoints:
  - `POST /v1/files` for streaming uploads (multipart/form-data, optional checksum headers, idempotency support).
  - `POST /v1/nodes/move` and `/v1/nodes/copy` for path/backend relocations.
  - `PATCH /v1/nodes/:id/metadata` to merge/unset metadata fields.
- Emit richer events (`filestore.node.uploaded`, `filestore.node.moved`, `filestore.node.copied`) and include size/hash/duration in `filestore.command.completed` payloads.
- Update executors (local + S3) to perform the new operations, verify hashes, and roll back on failure.
- Cover the new commands with unit/integration tests and maintain idempotency guarantees.

### Frontend
- Introduce a Filestore "Write" tab/page with panels for Upload, Move/Copy, Delete, and Metadata Edit.
- Build an upload dialog supporting drag/drop, progress tracking, and resumable-friendly messaging; call the new upload endpoint with idempotency keys.
- Provide move/copy forms with backend selectors, path pickers, and conflict resolution guidance.
- Offer recursive delete confirmation with scope-aware warnings and optimistic UI updates.
- Add metadata editor for tags/custom fields with inline validation and toast feedback.
- Display an operation history feed sourced from SSE events, highlighting affected nodes.
- Reuse shared polling/toast utilities, update explorer detail panes after each mutation, and guard all actions by scope (`filestore:write`, `filestore:admin`).
- Add Vitest/component tests for API wrappers, optimistic updates, and error handling paths.

## Non-Goals
- Batch artifact workflows or retention policies (handled separately).
- Deep diff/version visualizations (basic metadata refresh is acceptable).
- CLI/SDK enhancements beyond exposing the new endpoints.

## Implementation Sketch
1. Implement backend command schemas, endpoints, and executor logic; extend SSE publisher/tests.
2. Add typed client functions in `apps/frontend/src/filestore/api.ts` for the new routes.
3. Build React components for the write tab, wiring uploads and mutations to the API helpers and operation history feed.
4. Ensure optimistic updates refresh explorer state and handle idempotency keys gracefully.
5. Update docs with new endpoints/scopes; run lint/tests.

## Acceptance Criteria
- Authorized users can upload files, move/copy nodes, edit metadata, and delete nodes entirely from the UI; operations respect idempotency and surface progress/errors.
- Backend records commands, emits the new events, and passes all updated tests.
- Explorer detail panes reflect write operations immediately without full reloads.
- Operation history feed shows journal IDs, durations, and results for recent mutations.
- Lint/tests succeed across repo; documentation mentions the new write endpoints and required scopes.
