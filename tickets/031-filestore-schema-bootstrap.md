# Ticket 031: Bootstrap Filestore Schema & Migrations

## Problem Statement
Filestore needs durable, queryable state before the service can orchestrate filesystem commands. No tables exist today for tracking files, directories, journal history, or backend mounts inside the shared Postgres instance that already powers catalog/metastore/timestore.

## Goals
- Add migrations (TypeScript runner aligned with metastore/timestore patterns) that create the foundational tables under a dedicated `filestore` schema in Postgres.
- Model core entities:
  - `nodes` (directories + files) with parent pointers, backend ID, size, hash, state, timestamps, optimistic version, and soft-delete markers.
  - `snapshots` capturing historical versions for audit + rollback.
  - `journal_entries` logging every command with payload, executor, status, correlation IDs, and error info.
  - `rollups` storing aggregated size/count metadata per directory.
  - `backend_mounts` describing local roots, S3 buckets/prefixes, and access policies.
- Seed required indexes (btree + GIN/BRIN where appropriate) to support lookups by path, backend, checksum, and rollup queries.
- Reuse the existing Postgres connection tooling (shared pool config) without introducing new dependencies.

## Non-Goals
- Implementing application logic, REST routes, or workers.
- Filling data migration/backfill tasks; only schema + helper SQL utilities belong here.
- Modeling Metastore metadata overlays (handled later).

## Implementation Sketch
1. Create a migration module in `services/filestore/src/db/migrations.ts` analogous to metastore/timestore.
2. Define DDL for the schema + tables, ensuring foreign keys + cascading rules, and add triggers for `updated_at`/`version` increments.
3. Provide helper SQL views or functions for resolving canonical paths (e.g., `view_filestore_active_nodes`).
4. Wire migrations into the service package scripts (`npm run db:migrate:filestore`) and document required env vars.

## Acceptance Criteria
- Running the migration against the shared Postgres instance succeeds from a clean state and when tables already exist (idempotent DDL guards).
- Schema documented in the RFC is reflected exactly; any deviations are noted.
- Tests smoke the migration module (e.g., start a client, run migrations, inspect table presence) as done in other services.
- No changes to Redis/Kafka (confirming Redis-only eventing remains unchanged).
