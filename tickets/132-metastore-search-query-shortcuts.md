# Ticket 132 – Metastore Search Query Shortcuts & Presets

## Summary
Extend the metastore search API with a lightweight query string grammar and preset definitions that compile into the existing DSL, enabling clients to offload filtering logic and eliminate costly client-side post-processing.

## Motivation
The explorer currently fetches up to 200 records and filters them in memory because building DSL payloads on keystroke is cumbersome. A concise `q` syntax plus reusable server-side presets will let the frontend issue accurate, paginated searches while keeping the full expressiveness of the DSL available for advanced scenarios.

## Scope
- Add optional `q` and `preset` parameters to `POST /records/search` alongside the existing `filter` payload; inputs compile into `FilterNode` trees before query execution.
  - `q` should support simple expressions like `key:foo owner=ops status:"in progress"` with AND defaults and quoted terms.
  - `preset` references server-defined filters (e.g., `soft-deleted`, `stale`, `recently-updated`). Store preset definitions in configuration with auth checks.
- Document precedence rules when both `filter`, `q`, and `preset` are supplied (e.g., compile all into a single AND group).
- Update validation schemas and OpenAPI docs for the new parameters.
- Add unit tests for parser edge cases and integration tests proving the compiled SQL matches expectations.

## Acceptance Criteria
- `q` strings map to deterministic filter trees, including numeric, boolean, and timestamp comparisons, and return paginated results without client-side filtering.
- Named presets execute server-maintained filters and respect namespace scoping.
- Existing DSL clients remain unaffected when omitting `q`/`preset`.
- Comprehensive tests cover parsing success/failure paths and ensure SQL parameterization.

## Dependencies / Notes
- Coordinate with product/design on initial preset definitions (e.g., soft-deleted, recently updated >30 days).
- Ensure parser rejects unsupported operators with detailed error messages to help UI validation.
