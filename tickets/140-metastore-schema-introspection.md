# Ticket 140 – Metastore Schema Introspection Service

## Summary
Provide schema-aware metadata guidance by exposing schema registry lookups from the metastore API, keyed by the existing `schemaHash`, so clients can fetch field definitions, constraints, and validation hints.

## Motivation
The explorer currently treats metadata as arbitrary JSON, leaving users without guidance on required fields or expected structures. With many namespaces sharing schema hashes that already exist in other services, a simple introspection endpoint can deliver field metadata to drive smarter editors and validation.

## Scope
- Introduce `GET /schemas/:hash` that returns schema metadata (field paths, types, descriptions, validation rules). Source data from either a dedicated table or an adapter to the catalog/metastore registry (decide and document approach).
- Cache schema responses in-memory with TTL to avoid repeated lookups; provide a background refresh hook.
- Allow uploading/registering schemas via an admin route or CLI script to populate the store (minimal initial tooling).
- Update OpenAPI docs and add integration tests to ensure schema retrieval respects auth (e.g., `metastore:read` or stronger).
- Emit Prometheus counters for schema hits/misses to monitor adoption.

## Acceptance Criteria
- Clients can retrieve schema definitions by `schemaHash`, receiving structured type/description metadata suitable for driving form rendering.
- Missing schemas return 404 with guidance on registration; responses include caching headers.
- Unit/integration tests cover cache behavior, multiple schema versions, and auth enforcement.

## Dependencies / Notes
- Coordinate with the catalog team to determine schema source of truth and synchronization strategy.
- Ticket 141 will leverage this endpoint in the explorer.
