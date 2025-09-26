# Filestore Service

Fastify-based service that manages canonical metadata for files and directories tracked across local disks and S3 buckets. The service runs migrations against the shared Postgres instance on startup, exposes health/readiness probes, and publishes Prometheus metrics.

## Development

```bash
npm install
npm run dev --workspace @apphub/filestore
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
| `FILESTORE_EVENTS_MODE` | inferred | `inline` to disable Redis pub/sub for tests, `redis` to require Redis. |
| `FILESTORE_EVENTS_CHANNEL` | `${FILESTORE_REDIS_KEY_PREFIX}:filestore` | Redis pub/sub channel for filestore events. |

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

Downstream services can subscribe by listening to the configured Redis channel (default `apphub:filestore`).

## Endpoints

- `GET /healthz` / `GET /health` – Liveness probe.
- `GET /readyz` / `GET /ready` – Readiness probe that validates Postgres connectivity.
- `GET /metrics` – Prometheus metrics, guarded by `FILESTORE_METRICS_ENABLED`.

Migrations run automatically during startup; the service terminates if schema creation or migration fails.
