# Filestore Service

The filestore service centralises knowledge about files and directories stored on local volumes and S3 buckets. It exposes transactional APIs for filesystem mutations, maintains canonical metadata in PostgreSQL, and relays change events over Redis so Metastore and Timestore stay consistent without relying on ad-hoc shell scripts or Kafka.

## Objectives
- Provide a single API for reading, writing, moving, copying, and deleting filesystem objects while recording every mutation in a durable journal.
- Keep directory rollups (size, item counts) accurate by updating aggregates inline and reconciling large trees asynchronously via BullMQ workers.
- Detect and heal drift introduced by out-of-band changes using chokidar-based watchers for local mounts and list-based audits for S3 prefixes.
- Publish rich change events through Redis pub/sub and WebSocket bridges so downstream services (Metastore, Timestore, frontend) react in near real time.
- Share the existing platform infrastructure: Fastify conventions, the shared Postgres cluster, BullMQ queues, Redis caches, and the operator auth model.

## Responsibilities
- Own canonical metadata for tracked files and directories, including hashes, checksums, timestamps, backend bindings, and lifecycle state.
- Enforce the rule that clients never mutate tracked trees directly—operations must go through Filestore so the journal, snapshots, and rollups stay accurate.
- Coordinate filesystem executors (local disk, S3) that perform the physical IO work and report back success/failure details to the orchestrator.
- Surface APIs that let callers browse nodes, inspect change history, query directory contents, and request bulk operations.
- Feed Metastore with node identifiers so business metadata (tags, ownership) can attach cleanly, and pipe command history into Timestore for analytics.

## Component Architecture

```mermaid
graph TD
  Client((Client))
  API["Fastify API"]
  Orchestrator["Command Orchestrator"]
  LocalExec["Local Executor"]
  S3Exec["S3 Executor"]
  PG[("Postgres (filestore schema)")]
  RollupWorker["BullMQ Rollup Worker"]
  ReconWorker["BullMQ Reconcile Worker"]
  Events["Redis Pub/Sub + WebSocket"]

  Client -->|REST / SDK| API
  API --> Orchestrator
  Orchestrator -->|Transactions| PG
  Orchestrator -->|fs ops| LocalExec
  Orchestrator -->|object ops| S3Exec
  Orchestrator -->|enqueue| RollupWorker
  Orchestrator -->|emit| Events
  LocalExec -->|metadata| Orchestrator
  S3Exec -->|metadata| Orchestrator
  RollupWorker --> PG
  RollupWorker --> Events
  ReconWorker --> PG
  ReconWorker --> Events
  ReconWorker --> LocalExec
  ReconWorker --> S3Exec
  Events --> Metastore
  Events --> Timestore
```

### API Gateway
- Fastify service under `services/filestore` following core/metastore conventions.
- Implements REST endpoints for node inspection, directory listing, snapshots, and mutation commands.
- Supports streaming file uploads (`POST /v1/files`) for creating and overwriting tracked files with idempotent semantics and checksum validation.
- Provides browse-friendly read APIs (`GET /v1/nodes`, `GET /v1/nodes/:id`, `GET /v1/nodes/:id/children`, `GET /v1/nodes/by-path`) with filters for backend mount, path prefix, depth, node state, and drift-only queries.
- Exposes mount discovery at `GET /v1/backend-mounts`, returning configured mount metadata for operators and the frontend explorer.
- Streams change notifications via Server-Sent Events at `/v1/events/stream` for local development or environments without Redis.
- Handles auth, validation (zod schemas), idempotency headers, and streaming uploads/downloads.

### Command Orchestrator
- Core module that validates commands, loads node context, and wraps executor calls in a Postgres transaction.
- Persists mutations into `nodes`, `snapshots`, and `journal_entries`, increments optimistic version numbers, and records idempotency keys.
- Handles directory creation/deletion, metadata edits, node moves/copies, and file uploads/writes (`uploadFile`, `writeFile`) while verifying path invariants and rolling up size/count deltas inline.
- Schedules follow-up work (rollup recomputation, checksum verification) on BullMQ queues and publishes Redis events after commit.

### Executors
- **LocalExecutor**: Performs safe file and directory operations on mounted paths. Uses staging directories + `fs.rename` for atomic writes, preserves POSIX metadata, and emits drift signals when watchers detect external changes.
- **S3Executor**: Wraps `@aws-sdk/client-s3` to list/stat/put/move/delete objects, leveraging multipart uploads for large files and verifying ETag/hash before commit. Retries with exponential backoff to account for eventual consistency.

### Persistence Layer
- Dedicated `filestore` schema in the shared Postgres cluster housing core tables:
  - `backend_mounts`: configured roots (local path, S3 bucket/prefix, credentials hints, access policies).
  - `nodes`: canonical record per file/directory with parent pointer, backend ID, relative path, type, size, checksum/hash, state (`ACTIVE`, `INCONSISTENT`, `MISSING`, `DELETED`), `consistency_state`, audit timestamps (`consistency_checked_at`, `last_reconciled_at`, `last_drift_detected_at`), optimistic version, and metadata.
  - `snapshots`: immutable snapshots keyed by node + version for auditing and temporal queries.
  - `journal_entries`: append-only log of commands, executor results, idempotency keys, error context, and correlation IDs.
  - `rollups`: aggregated directory metrics (`size_bytes`, `file_count`, `dir_count`, `last_calculated_at`, `consistency_state`).
  - Supporting indexes (btree on paths/backends, GIN on tags/metadata columns as needed) keep lookups efficient.

### Workers & Watchers
- **Rollup workers** recalculate directory aggregates using BullMQ queues (`filestore_rollup_queue`). Small trees update inline; large trees queue background jobs and publish completion events.
- **Reconciliation workers** consume drift jobs (`filestore_reconcile_queue`) emitted by watchers or scheduled audits. Each job re-stats the physical backend (local or S3), updates `nodes.consistency_state` / `consistency_checked_at`, refreshes rollups, and publishes `filestore.node.reconciled` or `filestore.node.missing` events. Inline Redis mode (enabled only when `APPHUB_ALLOW_INLINE_MODE=true`) processes jobs synchronously during tests; the standalone worker (`npm run reconcile --workspace @apphub/filestore`) runs the BullMQ consumer and periodic audit sweep in development.
- **Watchers**: per-mount adapters (chokidar for local, S3 notification/listing) detect out-of-band changes, tag nodes as `INCONSISTENT`, and enqueue reconciliation work.

### Event Pipeline
- Redis pub/sub channel (default `apphub:filestore`) still powers in-process listeners and broadcasts events like `filestore.node.created`, `filestore.node.uploaded`, `filestore.node.moved`, `filestore.node.copied`, `filestore.node.updated`, `filestore.node.deleted`, `filestore.command.completed`, and `filestore.drift.detected`, while the orchestrator forwards every successful command as `filestore.command.completed` on the shared event bus.
- Core’s existing WebSocket relay can be extended to proxy these events to the frontend without introducing Kafka.
- Consumers (Metastore, Timestore, CLI) subscribe via the shared event bus and can fall back to inline dispatch when `FILESTORE_EVENTS_MODE=inline` or `REDIS_URL=inline` with `APPHUB_ALLOW_INLINE_MODE=true`.
- Commands receive payloads containing the journal ID, backend mount, node metadata, and idempotency key when present—ideal for syncing mirrors or triggering downstream workflows.

## Operator Explorer

- The web console at `/services/filestore` (apps/frontend) now renders a Filestore explorer backed by the new browse endpoints and SSE stream. It requires a token with `filestore:read` scope (and `filestore:write` for reconciliation controls).
- Configure `VITE_FILESTORE_BASE_URL` when running the Vite dev server so the explorer points at the correct Filestore instance.
- The UI debounces event-driven refreshes and uses typed helpers in `apps/frontend/src/filestore/api.ts` for pagination, children queries, metadata edits, move operations, and reconciliation commands.

## Command Flow

```mermaid
sequenceDiagram
  participant C as Client
  participant API as Filestore API
  participant ORC as Orchestrator
  participant EXE as Executor
  participant PG as Postgres
  participant EQ as Redis Events
  C->>API: POST /v1/commands/move
  API->>ORC: runCommand(request)
  ORC->>PG: BEGIN
  ORC->>EXE: move(source,dest)
  EXE-->>ORC: ok, metadata
  ORC->>PG: update nodes + rollups draft
  ORC->>PG: insert journal_entry
  ORC->>PG: COMMIT
  ORC->>EQ: publish filestore.node.updated
  ORC-->>API: command result (node, journalId)
  API-->>C: 200 OK
```

## Node State Lifecycle

```mermaid
stateDiagram-v2
  [*] --> ACTIVE
  ACTIVE --> INCONSISTENT: drift_detected
  INCONSISTENT --> ACTIVE: reconciliation_success
  INCONSISTENT --> MISSING: path_not_found
  MISSING --> ACTIVE: restore_or_recreate
  ACTIVE --> DELETED: command_delete
  INCONSISTENT --> DELETED: command_delete
  MISSING --> DELETED: purge_confirmed
  DELETED --> [*]
```

## Integrations
- **Metastore** subscribes to node events and stores tags, owners, and business metadata keyed by `node_id`. Mutations propagate using Redis pub/sub so clients always see aligned metadata. Configure the consumer with `METASTORE_FILESTORE_SYNC_ENABLED`, `METASTORE_FILESTORE_NAMESPACE`, `FILESTORE_REDIS_URL`, and `FILESTORE_EVENTS_CHANNEL` (set `FILESTORE_REDIS_URL=inline` with `APPHUB_ALLOW_INLINE_MODE=true` for tests).
- **Timestore** ingests command journal entries into a `filestore_activity` dataset, enabling time-based analysis (growth, churn, reconciliation lag). Events include deltas to support rollup queries without scanning the entire journal. Tune the sink using `TIMESTORE_FILESTORE_*` variables (`TIMESTORE_FILESTORE_DATASET_SLUG`, `TIMESTORE_FILESTORE_TABLE_NAME`, `TIMESTORE_FILESTORE_RETRY_MS`) and the same Redis channel configuration.
- **Core / Frontend** consume WebSocket events to refresh dashboards and surface storage metrics alongside app/build metadata.

## SDK & CLI Tooling
- **TypeScript SDK** (`@apphub/filestore-client`) wraps the REST API with typed helpers for idempotent command execution, node lookups, reconciliation enqueueing, and Server-Sent Events streaming. Configure it with `baseUrl`, optional bearer `token`, and it will automatically set `Idempotency-Key` headers and translate HTTP failures into `FilestoreClientError` instances.
- **CLI** (`@apphub/filestore-cli`) provides operator-friendly commands backed by the SDK: create directories, delete nodes, enqueue reconciliation jobs, and tail live events using the new `/v1/events/stream` endpoint. Point it at a local inline setup by exporting `APPHUB_ALLOW_INLINE_MODE=true` alongside `FILESTORE_BASE_URL`, `FILESTORE_TOKEN`, and `FILESTORE_REDIS_URL=inline`, then run `npx filestore nodes:stat <backend> <path>` to inspect metadata without touching the filesystem directly.
- The CLI uses the same SSE stream as the SDK, so it works in both Redis and inline event modes. Use `filestore events:tail` to monitor activity during migrations or reconciliation runs.

## Frontend Explorer UX
- The React explorer now requests `GET /v1/backend-mounts` on load, populating the mount selector with live metadata (key, backend kind, health state) instead of assuming mount ID `1`.
- Operator selections persist per browser via `localStorage` so returning users resume from the last mount they inspected; switching mounts emits analytics events under `filestore.mount.changed`.
- Empty and error states guide operators toward CLI/docs when no mounts are configured and surface toast notifications if the discovery endpoint fails.

## Security & Auth
- Reuse existing bearer token model with scopes like `filestore:read`, `filestore:write`, `filestore:admin` plus optional namespace/path allow lists.
- Sensitive operations (move, delete, S3 credential updates) require elevated scopes. Tokens can be rotated via shared operator tooling.
- Journal entries capture acting principal, idempotency key, request ID, and executed backend for auditing.

## Observability
- Prometheus metrics exported via `/metrics`: command latency histograms, executor success/failure counters, bytes processed, rollup queue depth, reconciliation backlog, watcher drift events.
- Structured logs include journal IDs for traceability. Optional OpenTelemetry spans integrate with the platform tracing configuration.
- Health endpoints (`/health`, `/ready`) verify Postgres connectivity, Redis availability (except inline mode), and recent migration state.

## Local Development
```bash
npm install
npm run dev --workspace @apphub/filestore
npm run reconcile --workspace @apphub/filestore
```

- Inline Redis mode (`REDIS_URL=inline` with `APPHUB_ALLOW_INLINE_MODE=true`) is now reserved for tests and single-process demos; production and shared environments must point to a Redis instance.
- Postgres connection points to the shared development database; migrations run automatically on boot.
- Mount configuration pulled from `FILESTORE_BACKENDS_PATH` (JSON or YAML) describing local directories and mock S3 buckets (e.g., MinIO).
- Watchers and reconciliation workers can be launched via `npm run dev:filestore:watchers` and either `npm run dev:filestore:workers` or `npm run reconcile --workspace @apphub/filestore` to simulate drift handling end-to-end.
- Reconciliation metrics (`filestore_reconciliation_jobs_total`, `filestore_reconciliation_job_duration_seconds`, `filestore_reconciliation_queue_depth`) surface backlog, outcome, and duration insights.

## Rollout Phases
1. **Observe-only**: register mounts, run watchers, and log drift without blocking manual changes. Validate metadata accuracy and event payloads.
2. **Enforced mutations**: route core/build pipelines through the Filestore SDK so mutations go through the API. Enable rollup updates and reconciliation alarms.
3. **Metadata convergence**: hook Metastore/Timestore consumers to the event feed so tags and timelines align with journal output.
4. **Operationalisation**: finalise SLOs (availability, command success, reconciliation lag), configure alerts, and document runbooks.

Refer to the detailed [Filestore Cutover Runbook](runbooks/filestore-cutover.md) for environment-specific checklists, SLO guidance, and rollback procedures.

## Open Questions & Risks
- **Path policy enforcement**: Do we need hierarchical ACLs per namespace, or is backend-level scoping sufficient? (Owner: Platform Auth)
- **Large directory operations**: For trees with millions of nodes, do we batch commands or invent streaming protocols? Evaluate BullMQ job splitting strategy.
- **S3 consistency windows**: How do we expose eventual consistency delays to callers? Consider returning `pendingVerification=true` when manifest confirmation is queued.
- **Disaster recovery**: Should journal entries stream to object storage for replay if Postgres experiences data loss? Investigate logical replication or WAL archiving alignment.
- **CLI ergonomics**: Determine how much functionality belongs in the initial CLI vs. future enhancements (e.g., diffing, dry-run mode).

Document owners: Platform infrastructure team. Reviews required: reliability, security, ingestion owners.
