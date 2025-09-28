# Ticket 130 – Metastore Namespace Discovery API

## Summary
Expose a dedicated namespace discovery surface in the metastore service so operators and downstream clients can enumerate available namespaces, understand activity, and feed richer UX affordances like autocomplete and stale namespace warnings.

## Motivation
The explorer UI currently asks users to hand-type namespaces because the backend only exposes per-record routes. Lack of discoverability leads to typos, duplicated namespaces, and hidden data. Providing a first-class discovery endpoint with lightweight usage stats enables typeahead, governance checks, and health monitoring without scanning the entire records table on the client.

## Scope
- Add `GET /namespaces` to `services/metastore`, returning paginated namespace summaries (`name`, total records, soft-deleted count, last updated timestamp, optional owner counts).
- Support filtering by prefix and pagination parameters, honoring namespace-based auth scopes the same way record routes do.
- Extend metrics plugin to export namespace-level gauges (e.g., `metastore_namespace_records`, `metastore_namespace_deleted_records`).
- Update Postgres queries to aggregate with appropriate indexes; cache hot results for a short TTL (e.g., 30s) to protect the database during frequent polling.
- Cover new routes with OpenAPI definitions, JSON schema validation, and integration tests.

## Acceptance Criteria
- Calling `GET /namespaces` with a valid token returns only namespaces the caller can access along with counts and last-updated metadata.
- Namespace metrics appear in `/metrics` and reflect soft-deleted records separately.
- Pagination, prefix filtering, and caching behave as documented; requests outside authorization scope return 403.
- Integration tests assert auth enforcement and aggregation correctness; OpenAPI docs list the new endpoint.

## Dependencies / Notes
- Reuse existing connection helpers in `recordsRepository` for aggregation; ensure rows are read from the correct schema.
- Coordinate with operations on metric naming to avoid collisions with catalog metrics.
