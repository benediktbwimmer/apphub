# Ticket 136 – Metastore Explorer Audit Trail Upgrades

## Summary
Enhance the explorer audit panel with pagination, rich diffs, and one-click restores powered by the new backend capabilities so operators can understand and revert changes without leaving the UI.

## Motivation
The current audit UI shows a flat list of entries with timestamps but no insight into what changed or quick restore actions. Incident response requires copying JSON into external tools. Leveraging structured diffs and the restore endpoint will create a self-contained workflow for comparing versions and undoing mistakes.

## Scope
- Replace the existing basic audit list with a paginated table that fetches batches via query params (limit/offset).
- Add a “View diff” action that opens a side panel or modal with a rendered diff (metadata, tags, owner, schema hash) using color-coded change indicators.
- Include a “Restore this version” CTA gated by `metastore:write` scope; confirmation modal explains impact and surfaces optimistic locking errors inline.
- Surface actor details and correlation IDs (if available) to help trace provenance; provide filters (e.g., show only updates/deletes).
- Update tests to cover pagination, diff rendering, and restore flows, including failure scenarios.

## Acceptance Criteria
- Audit panel fetches additional pages on demand and accurately reflects total counts from the API.
- Diff viewer highlights changes clearly and handles large documents (collapsed sections with expanders).
- Restore flow updates the main record view, shows success toasts, and refreshes audit history.
- Vitest coverage includes diff parsing, conditional rendering based on scopes, and optimistic locking errors.

## Dependencies / Notes
- Depends on Ticket 135 for diff/restore endpoints.
- Coordinate with design for diff visualization patterns and accessibility.
