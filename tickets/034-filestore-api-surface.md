# Ticket 034: Expose Filestore REST API Surface

## Problem Statement
With the orchestrator in place, clients still lack HTTP endpoints to create, query, or mutate tracked files. We need a typed REST surface consistent with catalog/metastore conventions so services can migrate away from manual filesystem access.

## Goals
- Implement Fastify routes under `/v1` for core operations:
  - `POST /files` (create/upload placeholders, optionally streaming content when small).
  - `POST /directories` (create directories, set permissions where supported).
  - `POST /commands/move`, `/commands/copy`, `/commands/delete` (mutation commands using orchestrator + idempotency keys).
  - `GET /nodes/:id` and `GET /nodes/by-path` (resolve metadata, hashes, rollups snapshot).
  - `GET /directories/:id/children` with pagination and optional metadata hydration toggle.
  - `POST /snapshots/query` (list change history).
- Define JSON schemas (via zod) that map to orchestrator command types and register them in OpenAPI.
- Enforce auth/RBAC via existing identity middleware (namespace + path scoping) and log audit context.
- Plug in streaming uploads/downloads using Fastify's multipart plugin for local executor compatibility.

## Non-Goals
- Implementing CLI/SDK wrappers (Ticket 039).
- Directory rollup maintenance or caching (Ticket 036).
- Event fan-out to Metastore/Timestore (Ticket 037/040).

## Implementation Sketch
1. Create route modules (`routes/files.ts`, `routes/directories.ts`, `routes/commands.ts`) mirroring catalog structure.
2. Wire each route to orchestrator calls and marshall responses from Postgres models.
3. Update OpenAPI document and add tests using Fastify's inject helper to cover status codes, validation, auth failures, and idempotency reuse.
4. Ensure responses include journal IDs and versions so clients can observe follow-up events over Redis/WebSocket.

## Acceptance Criteria
- Routes pass lint/test suite and appear in the generated OpenAPI docs.
- Auth rejects unauthorized path/backend access while allowing namespace-scoped tokens to operate on permitted trees.
- Upload endpoint supports inline mode (small files) and schedules BullMQ jobs for larger writes when necessary.
- Endpoints return consistent errors (problem+json) matching platform conventions and include references to the journal entry for troubleshooting.
