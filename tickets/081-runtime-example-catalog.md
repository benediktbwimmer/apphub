# Ticket 081: Runtime Example Catalog from Descriptors

## Problem Statement
Core packages (`@apphub/examples-registry`, frontend importer, catalog tests) bake example metadata by importing files under `examples/` at build time. This contradicts the decoupling goal: adding or editing an example requires code changes and repo rebuilds. With the new module descriptor (`config.json`), we can derive the catalog dynamically instead of shipping a static registry bundle.

## Goals
- Replace the static `@apphub/examples-registry` tables with runtime discovery that reads example descriptors (local checkout, remote git) and exposes the data through the catalog API.
- Update the frontend importer and shared helpers to consume the runtime catalog API instead of static TypeScript exports, maintaining feature parity (filtering, grouping, metadata display).
- Ensure integration tests can still load curated examples by seeding descriptors, without importing `examples/` source code at compile time.

## Non-Goals
- Removing the `examples/` directory itself; the focus is on how metadata is surfaced to clients.
- Rewriting bundling logic (handled in Ticket 082) beyond sourcing metadata from the new discovery layer.

## Implementation Sketch
1. Build a catalog-side discovery module that enumerates descriptors located under `examples/` (or configured paths) and can ingest descriptors from remote sources on demand. Cache results to avoid scanning on every request.
2. Add API endpoints (e.g., `/examples/catalog`) returning grouped scenarios, jobs, workflows derived from descriptors. Include placeholder summaries and download links so the importer has the context it previously read from `@apphub/examples-registry`.
3. Migrate the frontend importer to fetch from the new API, adapting local types to the descriptor-derived schema and removing direct imports of `@apphub/examples-registry`.
4. Update shared helpers/tests to stub the API or provide descriptor fixtures. Delete or archive the static registry package once consumers migrate.
5. Provide migration documentation so downstream tooling (CLI/scripts) can query the API or point to descriptors without linking against TypeScript bundles.

## Deliverables
- Catalog discovery module and API endpoints serving descriptor-based example metadata.
- Frontend importer and shared utilities consuming the new API with equivalent UX to the current static registry.
- Updated integration tests and fixtures relying on descriptors rather than static imports.
- Deprecation notice or removal plan for `@apphub/examples-registry` once clients migrate.
