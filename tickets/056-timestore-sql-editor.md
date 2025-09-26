# Ticket 056: Deliver Timestore SQL Editor Experience

## Problem Statement
The Timestore operations console provides lifecycle controls and a guided query panel, but operators now need a full SQL experience to explore datasets using the new SQL endpoints. Without a first-class editor, power users are forced to rely on external clients, losing context, schema hints, audit trails, and any persistent record of executed queries inside AppHub. We need to embed a modern SQL editor that supports dark mode, intelligent autocomplete (keywords + live schema), in-browser query history, and result visualizations directly in the Timestore UI.

## Goals
- Introduce a dedicated SQL editor surface in `/services/timestore`, accessible alongside the existing dataset explorer/operations console.
- Implement a code editor with dark/light theming that understands SQL syntax, offers linting hints, and highlights errors returned by the API.
- Provide autocomplete suggestions sourced from both static SQL keywords and the current Timestore schema (datasets, columns, partition keys) via the SQL metadata endpoints.
- Support multiple result renderers: tabular grid, raw JSON, and optional charting for numeric/time-series queries.
- Allow saving, renaming, and re-running recent SQL statements within the session via an in-browser history panel that survives reloads (within retention limits).
- Integrate with existing toast/logging infrastructure to capture execution telemetry and errors.

## Non-Goals
- Building a collaborative editor with shared sessions (single-user focus is fine).
- Persisting saved queries to the backend (session storage only for now).
- Replacing the guided query console entirely—the lightweight panel should remain for simple workflows.
- Implementing complex visualization builders beyond basic line/bar charts.

## Implementation Sketch
1. Create a `SqlEditorPane` component under `apps/frontend/src/timestore/sql/` that wraps a Monaco (or CodeMirror) instance with dual theme support. Wire up SQL language mode and diagnostics powered by the new endpoints.
2. Fetch schema metadata (`/admin/sql/schema` or equivalent) via `usePollingResource` and feed it to an autocomplete provider that merges keywords + dataset columns.
3. Add a new route within the services layout (e.g., `/services/timestore/sql`) and navigation tab entry, ensuring focus/ARIA parity with existing tabs.
4. Implement request executor utilities that post SQL statements to the new endpoint, stream results when available, and surface errors inline with caret/line decorations.
5. Build a results viewer supporting tabular grid (virtualized), JSON viewer, and simple chart cards (using existing chart primitives if available). Selection should auto-pivot based on column types.
6. Track recent queries in local/session storage, exposing a searchable, collapsible history list with quick actions (re-run, load into editor, copy, delete/pin).
7. Extend analytics/telemetry hooks to log execution time, rows returned, and any failure reasons.
8. Add unit/component tests covering schema autocomplete, session history persistence, and error decoration logic. Update docs to describe the new SQL editor entry point and environment variables.

## Acceptance Criteria
- Visiting `/services/timestore/sql` opens the SQL editor with dark/light theme support tied to the global theme toggle.
- Autocomplete suggestions include SQL keywords (SELECT, WHERE, JOIN, etc.) and up-to-date dataset/column names fetched from Timestore.
- Executing a query runs against the new SQL endpoint, displaying results in the tabular viewer and allowing toggles to JSON/chart modes.
- Syntax/execute errors are surfaced inline in the editor and via toasts, with clear messaging and cursor positioning when possible.
- Recent queries persist in-browser (session/local storage), support search/pin/clear operations, can be re-run with one click, and are easy to export or purge.
- Tests and lint pass after introducing the new editor, and documentation references how to access and configure the SQL editor UI.
