# Ticket 054: Deliver Metastore Record Explorer

## Problem Statement
Metastore exposes rich metadata and search APIs, yet the frontend has no interface to browse records, filter namespaces, or inspect document payloads. Operators rely on curl/Postman, slowing debug workflows and risking mistakes when dealing with optimistic locking.

## Goals
- Build a `MetastoreExplorerPage` with search filters (namespace dropdown, tag filters, text query) powered by `POST /records/search`.
- Render results in a virtualized table showing namespace, key, owner, tags, version, updated timestamp, and soft-delete status.
- Provide a side panel/detail view that fetches `GET /records/:namespace/:key` and presents JSON metadata, tags, owner, and schema hash using syntax highlighting and key/value summaries.
- Integrate `GET /records/:namespace/:key/audit` into an audit modal/timeline to review change history with pagination.
- Persist recent search presets in local storage for quick recall.

## Non-Goals
- Implement record mutations (covered in Ticket 055).
- Introduce a schema designer or validation UI.
- Provide graph visualizations of record relationships.

## Implementation Sketch
1. Add `apps/frontend/src/metastore/types.ts` with Zod parsers for record, search results, and audit payloads.
2. Create search form components (`NamespaceSelect`, `TagFilterChips`, etc.) and wire them into the services layout via `/services/metastore` route.
3. Use `usePollingResource` for search polling (optional refresh) and fetch audits on demand with infinite scroll/back pagination.
4. Implement a detail drawer/side panel that updates when a table row is selected, ensuring keyboard accessibility and screen-reader labels.
5. Store recent search presets in local storage, provide quick-select pills, and allow clearing them.
6. Add tests covering payload parsing, namespace filter behavior, and audit pagination fallbacks.

## Acceptance Criteria
- `/services/metastore` lists records with search controls, handles empty states, and respects namespace scoping.
- Selecting a record loads detail JSON and audit history without full-page reloads.
- Soft-deleted records are visually flagged, and include-deleted toggle works.
- Tests validate search parsing and audit pagination; lint/tests pass.
