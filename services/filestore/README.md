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

## Endpoints

- `GET /healthz` / `GET /health` – Liveness probe.
- `GET /readyz` / `GET /ready` – Readiness probe that validates Postgres connectivity.
- `GET /metrics` – Prometheus metrics, guarded by `FILESTORE_METRICS_ENABLED`.

Migrations run automatically during startup; the service terminates if schema creation or migration fails.
