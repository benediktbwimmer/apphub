# Ticket 134 – Metastore Search Projections & Lean Summaries

## Summary
Refine the metastore search pipeline to honor field projections at the SQL level, delivering slimmer responses by default while still enabling clients to opt into full metadata when needed.

## Motivation
`SELECT *` queries coupled with JSON serialization send large payloads even when the UI only needs a few columns. Supporting true column/metadata projections will reduce response times, shrink bandwidth, and make room for richer UI features like live polling without overwhelming the browser.

## Scope
- Extend `buildSearchQuery` to accept projection metadata and generate tailored SELECT lists (e.g., `namespace`, `record_key`, `updated_at`, `tags`) instead of `*`.
- Add a new `summary=true` convenience flag mapping to a default projection set; keep existing behavior when no projection is provided for backward compatibility.
- Update serializers to respect projection omissions (skip metadata unless explicitly requested) and ensure audit/event emission still receives full records.
- Introduce response size metrics (histograms) to track before/after improvements.
- Cover projection permutations with unit tests and expand integration tests to assert metadata omission.

## Acceptance Criteria
- API responses omit metadata and large fields when projection/summary mode is used, verified by tests.
- Default search results return a lean summary but allow callers to request full metadata explicitly.
- Event publishing and audit logging continue to operate on complete records internally.
- Metrics show reduced payload size compared to baseline runs.

## Dependencies / Notes
- Coordinate with frontend (Ticket 133) to ensure requested projections align with UI needs.
- Validate that projection lists cannot strip required columns for pagination or optimistic locking.
