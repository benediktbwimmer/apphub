# Filestore Service

Fastify-based service that manages canonical metadata for files and directories tracked across local disks and S3 buckets. The service runs migrations against the shared Postgres instance on startup, exposes health/readiness probes, and publishes Prometheus metrics.

## Development

```bash
npm install
npm run dev --workspace @apphub/filestore
# Start the reconciliation worker (inline Redis executes jobs immediately)
npm run reconcile --workspace @apphub/filestore
# Optional: use the CLI to exercise the API locally
npx filestore directories:create 1 datasets/example
npx filestore events:tail --event filestore.node.created
```

Environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `FILESTORE_HOST` | `127.0.0.1` | Bind address for the HTTP server. |
| `FILESTORE_PORT` | `4200` | Listen port for the HTTP server. |
| `FILESTORE_LOG_LEVEL` | `info` | Pino/fastify log level. |
| `FILESTORE_DATABASE_URL` | `postgres://apphub:apphub@127.0.0.1:5432/apphub` | Postgres connection string. |
| `FILESTORE_PG_SCHEMA` | `filestore` | Schema used for filestore tables. |
| `FILESTORE_METRICS_ENABLED` | `true` | Enables Prometheus metrics at `/metrics`. |
| `FILESTORE_REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection string (`inline` enables in-memory mode for tests). |
| `FILESTORE_REDIS_KEY_PREFIX` | `filestore` | Key prefix used for rollup cache and queue names. |
| `FILESTORE_ROLLUP_QUEUE_NAME` | `filestore_rollup_queue` | BullMQ queue name for rollup recalculation jobs. |
| `FILESTORE_ROLLUP_CACHE_TTL_SECONDS` | `300` | TTL for cached rollup summaries in Redis. |
| `FILESTORE_ROLLUP_CACHE_MAX_ENTRIES` | `1024` | Max in-process cache entries when Redis is enabled. |
| `FILESTORE_RECONCILE_QUEUE_NAME` | `filestore_reconcile_queue` | BullMQ queue name for reconciliation jobs. |
| `FILESTORE_RECONCILE_QUEUE_CONCURRENCY` | `1` | Worker concurrency for reconciliation jobs. |
| `FILESTORE_RECONCILE_AUDIT_INTERVAL_MS` | `300000` | Interval for background audits that re-enqueue inconsistent nodes (set `0` to disable). |
| `FILESTORE_RECONCILE_AUDIT_BATCH_SIZE` | `100` | Maximum nodes processed per audit sweep. |
| `FILESTORE_EVENTS_MODE` | inferred | `inline` to disable Redis pub/sub for tests, `redis` to require Redis. |
| `FILESTORE_EVENTS_CHANNEL` | `${FILESTORE_REDIS_KEY_PREFIX}:filestore` | Redis pub/sub channel for filestore events. |
| `FILESTORE_EVENTS_MODE` | `inline` when `REDIS_URL=inline` else `redis` | Controls event delivery strategy for SDK/CLI consumers. |

## Events

Filestore publishes lifecycle notifications to Redis (or in-process when `FILESTORE_EVENTS_MODE=inline`).
Events follow the `filestore.*` naming scheme—for example:

```json
{
  "type": "filestore.node.created",
  "data": {
    "backendMountId": 1,
    "nodeId": 42,
    "path": "datasets/observatory",
    "state": "active",
    "version": 1,
    "journalId": 1337
  }
}
```

Write operations also emit specialised events—`filestore.node.uploaded`, `filestore.node.moved`, and `filestore.node.copied`—alongside the existing `filestore.node.*` life-cycle notifications so consumers can distinguish between file uploads, moves, and copies in the activity stream.

Downstream services can subscribe by listening to the configured Redis channel (default `apphub:filestore`).

For local development without Redis, use the SSE endpoint exposed at `/v1/events/stream` or the `filestore events:tail` CLI command—both reuse the in-process event bus so you can observe activity when running inline mode.

## Endpoints

- `GET /healthz` / `GET /health` – Liveness probe.
- `GET /readyz` / `GET /ready` – Readiness probe that validates Postgres connectivity.
- `GET /metrics` – Prometheus metrics, guarded by `FILESTORE_METRICS_ENABLED`.
- `GET /v1/nodes` – Paginated node listing with filters for backend mount (`backendMountId`), path prefix (`path`), depth (`depth`), node states (`states`), drift-only (`driftOnly`), and free-text search (`search`).
- `GET /v1/nodes/:id` – Fetch a specific node (including rollup summary) by numeric identifier.
- `GET /v1/nodes/:id/children` – Return immediate children for a node with optional state/search filters.
- `GET /v1/nodes/by-path` – Resolve a node by backend mount and relative path.
- `POST /v1/directories` – Create directories (idempotent when `Idempotency-Key` provided).
- `POST /v1/files` – Upload or overwrite files via multipart form data, with checksum validation and idempotency headers.
- `DELETE /v1/nodes` – Soft-delete nodes by path, optionally recursively.
- `PATCH /v1/nodes/:id/metadata` – Merge and remove metadata fields for a node using `set`/`unset` semantics.
- `POST /v1/nodes/move` – Move nodes (and their descendants) to a new path within the same backend mount.
- `POST /v1/nodes/copy` – Copy nodes (and their descendants) to a new path within the same backend mount.
- `POST /v1/reconciliation` – Enqueue reconciliation jobs for drift or manual inspections.
- `GET /v1/events/stream` – Server-Sent Events stream for local observers when Redis is disabled.

Migrations run automatically during startup; the service terminates if schema creation or migration fails.
