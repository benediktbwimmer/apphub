# Ticket 055: Enable Metastore Record Operations

## Problem Statement
After introducing the record explorer, operators still lack UI tooling to mutate metadata, manage tags, or perform bulk updates. Relying on manual HTTP calls risks version conflicts and accidental hard deletes. We need structured forms that enforce optimistic locking, surface scope requirements, and keep audit trails visible.

## Goals
- Provide edit capabilities in the Metastore detail panel for PATCH/PUT operations, including optimistic locking prompts when versions drift.
- Expose soft delete, restore, and purge actions (DELETE + purge endpoints) with clear warnings and audit confirmations.
- Implement a bulk operation wizard that validates CSV/JSON payloads client-side, previews pending actions, and submits to `POST /records/bulk` (with optional dry-run flag when backend supports it).
- Surface cross-links to related assets/datasets when metadata contains recognized keys (e.g., `datasetSlug`, `assetId`) by deep-linking into Timestore or Assets pages.
- Record toasts for success/failure using the shared helpers and update detail data immediately after mutation.

## Non-Goals
- Designing a schema editor or JSON diff merge tool beyond existing preview/diff.
- Adding server-side dry-run support if the API does not already provide it (document fallback).
- Implementing new backend endpoints.

## Implementation Sketch
1. Add form components for metadata/tag editing with JSON merge assistance and validation; integrate optimistic locking by reading `version` and requesting `expectedVersion`.
2. Wire soft delete/restoration buttons to `DELETE /records/:namespace/:key` and `PUT /records/:namespace/:key` flows, updating local state on success.
3. Build a modal-driven bulk ingestion experience that accepts file upload or inline editor, runs schema validation via Zod, and displays per-record preview; submit via authorized fetch and render per-operation results.
4. Parse detail metadata for known link fields, rendering contextual badges that navigate to `/services/timestore` or `/assets` with the relevant slug.
5. Expand tests to cover optimistic lock conflict handling, delete/restore flows, and bulk preview validation.
6. Update docs (`docs/metastore.md`) with notes on using the new UI tools and required scopes.

## Acceptance Criteria
- Operators with `metastore:write` can edit metadata/tags and see version conflict messaging when updates collide.
- Delete, restore, and purge actions respect scope checks (`metastore:delete`, `metastore:admin`) and surface confirmations + toast feedback.
- Bulk operations validate inputs before submission, show per-record outcomes, and support cancelling without side effects.
- Cross-links appear when metadata references known resources, improving navigation across services.
- Tests cover critical flows and documentation explains the available operations.
