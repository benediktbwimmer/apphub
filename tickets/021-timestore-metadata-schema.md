# Ticket 021: Timestore Metadata Catalog Schema & Migrations

## Problem Statement
Timestore requires authoritative metadata to track datasets, partition manifests, storage locations, and retention policies. We currently lack a schema, migrations, or access layer for these records. Without a Postgres-backed catalog (shared with the existing catalog instance), ingestion and query components cannot coordinate on dataset definitions, versioned manifests, or storage lifecycle.

## Goals
- Design relational tables for datasets, partitions, manifests, storage targets, and retention policies under a dedicated Postgres schema within the catalog database.
- Implement migrations using the existing migration tooling so timestore tables are versioned and deployable.
- Create TypeScript data access layer (repos or query builders) for core metadata operations with unit tests.
- Document schema diagrams and entity lifecycles in `docs/architecture.md` appendix for timestore.
- Ensure migration execution integrates with catalog’s migration pipeline (shared Postgres) without conflicting transactions.

## Non-Goals
- Storing raw time series data; DuckDB files remain on local/remote storage.
- Building complex query planners; focus is metadata persistence.

## Implementation Sketch
1. Workshop ERD covering datasets, schema versions, partition files, snapshots, and storage endpoints, emphasizing referential integrity and manifest versioning.
2. Author migrations to create tables, indexes, and enums within a `timestore` schema in the existing Postgres instance; update migration runner to target the new schema.
3. Implement repository layer (using Knex/Drizzle/etc.) for create/read/update operations, including transactional manifest publishing.
4. Add unit tests mocking Postgres to validate happy paths and failure handling (duplicate partitions, retention updates).
5. Update documentation describing schemas, migration commands, and how timestore shares the catalog database.

## Deliverables
- Migration files and schema definitions applied via CI to the shared catalog Postgres instance.
- Type-safe metadata access layer with tests demonstrating manifest publishing and lookup.
- Architectural documentation of metadata entities and their relationships.
- Verified integration of timestore migrations into existing deploy/migration workflows.
