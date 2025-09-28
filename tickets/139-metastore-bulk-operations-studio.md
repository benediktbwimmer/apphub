# Ticket 139 – Metastore Bulk Operations Studio

## Summary
Redesign the explorer’s bulk operations dialog into a richer authoring experience that supports CSV/JSONL imports, inline validation, and per-operation previews before submission.

## Motivation
Operators must currently craft JSON by hand, which is error-prone and inaccessible to less technical users. A guided workflow with file import, schema-aware validation, and clear results will broaden adoption and cut down on support requests.

## Scope
- Replace the textarea-only dialog with a multi-step modal: data input (paste or upload CSV/JSONL), validation results, and final confirmation.
- Implement client-side parsing that maps tabular data to upsert/delete operations, surfacing row-level errors using existing zod schemas.
- Provide templates/snippets and documentation links for common batch tasks; allow exporting validated payloads for CLI use.
- Enhance the results view to group successes vs. failures, support sorting, and enable retrying failed operations with edits.
- Update unit/integration tests to cover parsing, validation, and result handling.

## Acceptance Criteria
- Users can import CSV/JSONL, see validation feedback with row numbers, and submit only when the payload passes schema checks.
- Results display per-operation outcomes with clear error messaging and optional download of failure reports.
- Original textarea fallback remains available for power users (toggle or “raw JSON” tab).
- Tests cover parsing edge cases, validation, and UI transitions.

## Dependencies / Notes
- Coordinate with design for the multi-step modal layout.
- Ensure large uploads remain responsive (stream parsing, chunked validation where feasible).
