# Timestore Service

The timestore service exposes a Fastify API that fronts a DuckDB-backed time series warehouse. It owns dataset metadata, manifest bookkeeping, and background workers that maintain partitioned DuckDB files across local and remote storage targets.

## Local Development
- Ensure a PostgreSQL instance is running. The service defaults to the catalog database at `postgres://apphub:apphub@127.0.0.1:5432/apphub`.
- From the monorepo root, run `npm install` once to link dependencies, then start the server with `npm run dev:timestore`.
- Optional: launch the lifecycle worker placeholder with `npm run dev:timestore:lifecycle` in a separate terminal.

The service listens on `http://127.0.0.1:4100` by default and exposes `/health` and `/ready` endpoints for smoke tests.

## Configuration
Environment variables control networking, storage, and database access:

| Variable | Description | Default |
| --- | --- | --- |
| `TIMESTORE_HOST` | Bind address for the Fastify server. | `127.0.0.1` |
| `TIMESTORE_PORT` | Port for HTTP traffic. | `4100` |
| `TIMESTORE_DATABASE_URL` | Connection string; falls back to the catalog `DATABASE_URL`. | `postgres://apphub:apphub@127.0.0.1:5432/apphub` |
| `TIMESTORE_PG_SCHEMA` | Dedicated schema within the shared Postgres instance. | `timestore` |
| `TIMESTORE_STORAGE_DRIVER` | `local` or `s3`, toggles storage adapter. | `local` |
| `TIMESTORE_STORAGE_ROOT` | Local filesystem root for DuckDB partitions. | `<repo>/services/data/timestore` |
| `TIMESTORE_S3_BUCKET` | Bucket for remote partition storage when `storageDriver` is `s3`. | `timestore-data` |
| `TIMESTORE_LOG_LEVEL` | Pino log level for Fastify. | `info` |

When the service boots it ensures the configured Postgres schema exists, runs timestore-specific migrations, and reuses the catalog connection pool helpers so migrations and manifests share the managed database.

## Testing
- Run `npm run lint --workspace @apphub/timestore` to type-check the service.
- Execute `npm run test --workspace @apphub/timestore` to validate the metadata repositories against an embedded PostgreSQL instance.
