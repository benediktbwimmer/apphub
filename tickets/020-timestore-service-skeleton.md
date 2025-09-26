# Ticket 020: Bootstrap Timestore Service & Shared Postgres Wiring

## Problem Statement
We need to stand up the foundational "timestore" service so teams can begin building against a DuckDB-backed time series store. The monorepo currently has no service entry point, configuration, or deployment hooks for timestore. Without a scaffolded service that reuses the existing catalog Postgres instance for metadata, we cannot iterate on APIs, migrations, or background workers in a consistent way.

## Goals
- Create a `services/timestore` workspace with Fastify API boilerplate, worker harness, and shared utilities patterned after `services/catalog`.
- Load configuration (ports, storage roots, S3 endpoints) via environment variables, defaulting to local disk while supporting remote object storage stubs.
- Reuse the catalog service's managed Postgres instance for metadata: share connection pool utilities, ensure separate schema namespace, and document credentials expectations.
- Register timestore with repo tooling (`package.json`, `npm run dev`, Docker compose) so the service can run alongside catalog in local development.
- Add basic readiness/health endpoints and logging infrastructure to unblock downstream feature work.

## Non-Goals
- Implementing full ingestion or query logic; placeholders are acceptable as long as wiring exists.
- Provisioning a dedicated Postgres cluster—this ticket must leverage the existing catalog instance.
- Designing the complete metadata schema (covered in Ticket 021).

## Implementation Sketch
1. Scaffold a new `services/timestore` package with tsconfig, eslint, and build scripts mirroring catalog conventions.
2. Introduce a Fastify server entry with placeholder routes (`/health`, `/ready`) and shared middleware (OpenTelemetry hooks, error formatter).
3. Extend shared Postgres client utilities to accept a schema name so timestore can connect to the catalog-managed instance without conflicting tables.
4. Update root workspaces, Docker, and dev scripts to include timestore (start command, environment variables, README additions).
5. Add basic documentation outlining how to run timestore locally and how it reuses the catalog Postgres connection.

## Deliverables
- New `services/timestore` workspace compiling in CI with lint/build scripts.
- Configurable Fastify server + worker harness that connects to the existing Postgres instance using a timestore-specific schema.
- Dev tooling updates (`npm run dev`, Docker compose, docs) that start timestore alongside catalog.
- Health/readiness routes and logging hooks confirmed through unit smoke tests.
