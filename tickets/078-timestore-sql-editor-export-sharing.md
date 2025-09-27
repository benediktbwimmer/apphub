# Ticket 078: Timestore SQL Editor Export & Sharing Enhancements

## Problem Statement
The SQL editor can render table/JSON views but lacks built-in mechanisms to download results, pin saved queries, or share links with teammates. Users must copy/paste SQL or manually call the `/sql/read?format=csv` route, which is clunky and error-prone.

## Goals
- Add export actions for CSV (and optionally plain text) leveraging the existing `format` option on `/sql/read`.
- Introduce lightweight saved queries with labels and shareable URLs tied to query IDs/history entries.
- Improve keyboard/mouse affordances for copying results or opening them in a new window while preserving existing shortcuts (⌘/Ctrl + Enter).

## Non-Goals
- Building a collaborative editor or real-time shared cursors; keep sharing scoped to immutable saved queries or links.
- Providing full-blown result pagination—stick with the current max-row limit semantics.

## Implementation Sketch
1. Extend the history model to persist pinned queries with generated IDs that can be embedded in URLs (e.g., `/services/timestore/sql?queryId=...`).
2. Add export buttons that re-issue the last statement with `format=csv` or `format=table` and trigger downloads, handling auth headers behind the scenes.
3. Provide UI affordances for copying the current query or result set, including toast feedback on success/failure.
4. Ensure saved queries reconcile with local storage history and can be cleared or renamed; guard access behind `timestore:sql:read` scope.
5. Add tests covering download flows, shareable link hydration, and history interactions to prevent regressions.

## Deliverables
- SQL editor actions for exporting results and sharing saved queries via stable links or IDs.
- Updated history persistence supporting pinned queries with labels and URL hydration.
- Tests validating export, sharing, and copy interactions in the SQL editor UI.
