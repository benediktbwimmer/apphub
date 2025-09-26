# 019 – Implement metastore service

## Context

- Product teams need a flexible way to persist arbitrary metadata for assets, jobs, and future features without adding bespoke tables per use case.
- Today the catalog service only stores strongly typed records, forcing downstream teams to duplicate storage or push metadata into JSON columns without shared APIs.
- A dedicated metastore service will expose a consistent REST API for CRUD and search, while reusing the existing Postgres instance that already backs the catalog service.

## Goals

1. Stand up a new `services/metastore` Fastify service that handles metadata persistence and search.
2. Define a Postgres schema (same instance as catalog; new schema or table namespace) with JSONB storage plus auditing columns (`created_at`, `updated_at`, `version`, `deleted_at`, `created_by`, `updated_by`).
3. Provide rich query/filter semantics across metadata keys, timestamps, and tags without introducing Elasticsearch or other external indices.
4. Ensure the service integrates with platform auth (service tokens + RBAC namespaces) and emits structured logs/metrics.
5. Deliver end-to-end automation (migrations, seeding, tests, docs) so other teams can adopt the metastore immediately.

## Deliverables

- Application skeleton under `services/metastore` with project scaffolding (npm scripts, tsconfig, Fastify bootstrap, OpenAPI docs).
- Database migration(s) that create `metastore_records` (primary key, unique key string, JSONB `metadata`, optional `tags`, `owner`, auditing columns) within the existing Postgres instance. Document connection reuse with catalog.
- Repository layer supporting optimistic locking on `version` and soft-deletes via `deleted_at`.
- REST endpoints:
  - `POST /records` to create a record (idempotent on key) with validation.
  - `PUT /records/:key` to upsert metadata, update auditing fields, and return the updated record.
  - `GET /records/:key` to fetch a single record (respect soft deletes).
  - `DELETE /records/:key` to soft-delete.
  - `POST /records/search` accepting pagination, field filters (`eq`, `neq`, `lt/gt`, `between`, `contains`, `has_key`, `array_contains`), boolean expression support, projection fields, and sort options.
  - `POST /records/bulk` for batch create/update/delete operations with transactional safety.
- GIN indexes on `metadata`, `tags`, and `updated_at` to support search without Elasticsearch.
- Integration of platform auth (namespace scoping, role checks) and request logging/metrics (Prometheus counters and latency histograms).
- Unit + integration tests covering migrations, CRUD, search filtering edge cases, optimistic locking failures, and auth errors. Include seed fixtures for local dev.
- Documentation updates (`docs/architecture.md`, new `docs/metastore.md`) describing the service responsibilities, API contract, and guidance for using the shared Postgres instance.

## Acceptance Criteria

- A developer can run `npm run dev` (root) and see the metastore service register alongside catalog with working migrations against the shared Postgres instance.
- Creating, updating, deleting, and searching metadata via HTTP passes automated integration tests and manual smoke tests (documented curl examples).
- Search requests support compound filters (e.g., key prefix + metadata field comparison + tag membership) and return paginated results within <200ms for 10k-record dataset locally.
- Authenticated requests scoped to an unauthorized namespace are denied with 403, and audit columns reflect the acting principal on successful writes.
- Documentation clearly explains how to enable/disable the metastore locally, including environment variables and required migrations.
