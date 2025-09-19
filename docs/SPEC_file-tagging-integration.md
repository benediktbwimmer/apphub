# SPEC_file-tagging-integration

## Overview
We need to treat external microservices (Better File Explorer, AI Connector, and the new File Tagging Service) as dynamically loadable components of the AppHub platform. The catalog API must discover, register, and communicate with these services without hard-coded wiring so that new capabilities can be added or removed at runtime. This spec defines the changes required in the existing monorepo to support dynamic service registration, routing, and communication for all auxiliary services.

## Goals
- Add first-class knowledge of external services (type, base URL, health, capabilities) to the catalog service.
- Allow services to self-register or be registered declaratively via manifest files/environment, with live updates persisted in SQLite and shared over the Redis event bus.
- Provide runtime clients (API layer, background workers, frontend) a unified way to discover and call the file-explorer, AI Connector, and file-tagging service.
- Ship tooling to orchestrate service processes in development, ensuring `npm run dev` can start/stop the external services based on configuration.

## Non-Goals
- We will not containerize or deploy the external services in this iteration; dockerization lives with each service.
- We will not introduce service mesh-style proxying; services are called directly over HTTP using their documented OpenAPI contracts.
- We will not redesign existing ingestion/build pipelines beyond the service registration hooks described below.

## Personas & Use Cases
- **Catalog Worker**: Needs the file-tagging endpoint to request metadata enrichment after ingestion completes.
- **Frontend**: Needs to know whether auxiliary services are available to enable/disable UI features (file browsing, AI suggestions).
- **Operator**: Wants to add/remove services by editing a manifest file or calling an API, without changing source code.

## High-Level Design
1. **Service Registry**
   - Create a `services` table in the catalog SQLite database with columns: `id`, `slug`, `display_name`, `kind`, `base_url`, `status`, `capabilities`, `last_healthy_at`, `metadata`, `created_at`, `updated_at`.
   - Introduce `ServiceRecord` types and CRUD helpers in `services/catalog/src/db.ts` (mirroring repository helpers), including `listServices`, `getServiceBySlug`, `upsertService`, and `setServiceStatus`.
   - Emit Redis events (`service.updated`) via `emitApphubEvent` in `services/catalog/src/events.ts` so other processes can subscribe.

2. **Registration Paths**
   - **Declarative Manifest**: Add `services/service-manifest.json` which lists default service definitions. On catalog boot, parse the manifest and upsert entries.
   - **Runtime API**: Add `POST /services` and `PATCH /services/:slug` endpoints in `services/catalog/src/server.ts` with zod validation, guarded by shared secret (`SERVICE_REGISTRY_TOKEN`). This allows the file-tagging service to self-register when it boots in another repo.

3. **Health & Capability Checks**
   - Implement a polling job in the catalog service (new module `services/catalog/src/serviceRegistry.ts`) that checks each registered service's `/healthz` endpoint every 30 seconds (configurable). Update `status` to `healthy`, `degraded`, or `unreachable` with timestamps and error messages.
   - When a service exposes OpenAPI metadata (both external repos do), fetch and cache `openapi.yaml` upon successful health check; persist hash/version in `metadata` for change detection.

4. **Configuration Surface**
   - Allow overriding or adding services via environment variable `SERVICE_MANIFEST_PATH` (supports absolute path or comma-separated list). Merge additional entries on startup.
   - Support runtime overrides of service base URLs through `.env.local` to accommodate port differences in development.

5. **Catalog → Service Clients**
   - Create typed clients in `services/catalog/src/clients/`:
     - `fileExplorerClient.ts` (wraps `/api/tree`, `/api/tags`, `/api/file/stream`).
     - `aiConnectorClient.ts` (wraps `/chat/completions`, `/chat/completions/stream`).
     - `fileTaggingClient.ts` (for future command/control of tagging jobs once the service exists).
   - Clients look up the latest healthy `ServiceRecord` for the required `kind` and handle retries/backoff.

6. **Ingestion Workflow Hook**
   - Update `processRepository` in `services/catalog/src/ingestionWorker.ts:836` to emit a `repository.ready` event that the file-tagging service will consume. No direct call is added here; the new service listens via Redis.
   - Add a follow-up step in the ingestion worker to enqueue a tagging request by calling `fileTaggingClient.enqueueTagging(repository.id)` when the `file-tagging` service is healthy.

7. **Dev Orchestration**
   - Introduce a new root script `npm run dev:services` that reads the manifest and launches each service's dev command using `concurrently`. The script should:
     - Check if the service has a `devCommand` defined (e.g., `npm run dev` for Node services, `uvicorn app.main:app --reload` for Python).
     - Spawn the process with the correct working directory (e.g., `services/file-explorer`, `services/ai-connector`).
   - Update the root `npm run dev` to include `dev:services` alongside the existing catalog/frontend workers.

8. **Frontend Awareness**
   - Extend the catalog API with `GET /services` returning the registry so the frontend can display service availability.
   - Add WebSocket broadcasts (`service.updated`) to existing clients connected to `/ws`.

## API Contracts
- `GET /services`: `{ data: ServiceRecord[], meta: { healthyCount, unhealthyCount } }`.
- `POST /services` (requires bearer token): registers or updates a service.
- `PATCH /services/:slug`: partial update (base_url, capabilities, status override).

Detailed zod schemas will live in `services/catalog/src/server.ts`.

## Data Migration
- Add a new migration script under `services/catalog/src/dbMigrations/` to create the `services` table and seed entries for file-explorer (`kind: "file-system"`) and AI connector (`kind: "ai-connector"`).
- Migration runs at catalog startup using the existing `migrateIfNeeded` helper.

## Configuration Matrix
| Variable | Description | Default |
| --- | --- | --- |
| `SERVICE_MANIFEST_PATH` | Path(s) to JSON manifest describing services | `services/service-manifest.json` |
| `SERVICE_REGISTRY_TOKEN` | Shared secret required for POST/PATCH on `/services` | none (disabled when unset) |
| `SERVICE_HEALTH_INTERVAL_MS` | Polling interval for health checks | 30000 |

## Telemetry & Logging
- Log registration events (`service registered`, `service unhealthy`) with structured metadata (slug, previous status, error).
- Capture health check latency to help diagnose slow upstream services.

## Testing Strategy
- Unit tests for manifest parsing, DB helpers, and zod validation.
- Integration tests using a mocked service (Fastify + nock) to verify health transitions and tagging enqueue logic.
- Update `npm run test:e2e` to assert that when a mock file-tagging service is healthy, ingestion triggers an HTTP call to enqueue a tagging job.

## Rollout Plan
1. Land DB migration and registry API with feature flag disabled (no manifest).
2. Add manifest + dev orchestration; verify in local dev.
3. Enable ingestion hook for tagging once the file-tagging service is implemented and healthy.
4. Document setup in `docs/architecture.md` and README.

