# Ticket 135 – Metastore Audit Diff & Restore Endpoint

## Summary
Augment the metastore audit subsystem with version diffing and restore capabilities so operators can compare historical mutations and recover prior states without manual SQL.

## Motivation
Audit entries already capture previous and current metadata blobs, but there is no API to surface structured diffs or to restore a specific version. Operators must eyeball JSON payloads, making root-cause analysis and rollback tedious. A focused diff endpoint with optional restore semantics will streamline compliance reviews and incident response.

## Scope
- Add `GET /records/:namespace/:key/audit/:id/diff` (or equivalent query params) returning a structured diff (added/changed/removed paths, tag changes, owner/schemaHash deltas).
- Introduce `POST /records/:namespace/:key/restore` accepting an `auditId` or `version`, wrapping existing update logic to replay metadata/tags/owner/schemaHash from that entry with optimistic locking.
- Ensure the diff computation reuses shared helper functions (e.g., deep comparison utilities) and handles large JSON bodies efficiently.
- Update auth policies so only `metastore:read` can view diffs while `metastore:write` (plus namespace access) is required to restore.
- Extend OpenAPI docs and integration tests for diffs and restores, including edge cases like restoring a soft-deleted record.

## Acceptance Criteria
- Diff responses clearly delineate additions, removals, and modifications for metadata and tags.
- Restore API replays the selected version, bumps the record version, logs an audit entry (`action: restore`), and emits an `updated` event.
- Invalid or unauthorized restore attempts return appropriate 4xx errors.
- Tests verify diff accuracy and successful restore flows (including optimistic locking failures).

## Dependencies / Notes
- Coordinate with Ticket 137 to ensure the UI has the structured data it needs for diff visualization.
- Consider reusing diff logic for future export/reporting features.
