# Timestore Service

The timestore service exposes a Fastify API that fronts a DuckDB-backed time series warehouse. It owns dataset metadata, manifest bookkeeping, and background workers that maintain partitioned DuckDB files across local and remote storage targets.

## Local Development
- Ensure a PostgreSQL instance is running. The service defaults to the catalog database at `postgres://apphub:apphub@127.0.0.1:5432/apphub`.
- From the monorepo root, run `npm install` once to link dependencies, then start the server with `npm run dev:timestore`.
- Optional: launch the lifecycle worker placeholder with `npm run dev:timestore:lifecycle` in a separate terminal.
- Launch the ingestion worker with `npm run dev:timestore:ingest` to process queued ingestion batches (BullMQ + Redis).

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
| `TIMESTORE_S3_ENDPOINT` | Optional S3-compatible endpoint (e.g., MinIO). | _(unset)_ |
| `TIMESTORE_S3_REGION` | Region used for S3 operations. | _(unset)_ |
| `TIMESTORE_S3_ACCESS_KEY_ID` | Access key for DuckDB remote reads and writers. | _(unset)_ |
| `TIMESTORE_S3_SECRET_ACCESS_KEY` | Secret key paired with the access key. | _(unset)_ |
| `TIMESTORE_S3_SESSION_TOKEN` | Session token for temporary credentials. | _(unset)_ |
| `TIMESTORE_S3_FORCE_PATH_STYLE` | Force path-style S3 URLs (`true`/`false`). | `false` |
| `TIMESTORE_QUERY_CACHE_ENABLED` | Enable DuckDB local cache for remote partitions. | `true` |
| `TIMESTORE_QUERY_CACHE_DIR` | Filesystem directory for cached remote partitions. | `<repo>/services/data/timestore/cache` |
| `TIMESTORE_QUERY_CACHE_MAX_BYTES` | Upper bound for cached partition bytes. | `5368709120` |
| `TIMESTORE_LOG_LEVEL` | Pino log level for Fastify. | `info` |
| `TIMESTORE_INGEST_QUEUE_NAME` | BullMQ queue name for ingestion jobs. | `timestore_ingest_queue` |
| `TIMESTORE_INGEST_CONCURRENCY` | Worker concurrency when processing ingestion jobs. | `2` |
| `TIMESTORE_REQUIRE_SCOPE` | Optional scope required via `x-iam-scopes` header for query access. | _(unset)_ |
| `TIMESTORE_ADMIN_SCOPE` | Scope required for administrative dataset routes; falls back to `TIMESTORE_REQUIRE_SCOPE` if unset. | _(unset)_ |
| `TIMESTORE_REQUIRE_WRITE_SCOPE` | Scope required to create or ingest into datasets when dataset metadata does not specify write scopes. | _(unset)_ |

When the service boots it ensures the configured Postgres schema exists, runs timestore-specific migrations, and reuses the catalog connection pool helpers so migrations and manifests share the managed database.

## HTTP Ingestion API
- `POST /datasets/:datasetSlug/ingest` accepts a JSON payload containing schema metadata, a partition key, records (JSON objects), and optional `idempotency-key` header. Jobs enqueue over Redis/BullMQ unless `REDIS_URL=inline` (tests/dev) in which case ingestion runs inline.
- Successful ingestions create a new dataset (if needed), versioned schema definition, manifest, and DuckDB partition file on the configured storage target.
- The API responds synchronously when running inline, otherwise returns a `202 Accepted` with the enqueued job id.

## Query API
- `POST /datasets/:datasetSlug/query` returns time-series data by scanning published partitions via DuckDB. Provide a required `timeRange` plus optional `columns`, `downsample`, and `limit` settings.
- Downsampling is expressed via `downsample.intervalUnit`/`intervalSize` and aggregation list (e.g., `{ fn: "avg", column: "temperature_c", alias: "avg_temp" }`). Supported aggregations include `avg`, `min`, `max`, `sum`, `median`, `count`, `count_distinct`, and `percentile` (with `percentile` requiring a `percentile` value between 0 and 1).
- Remote partitions referenced via `s3://` manifests are streamed through DuckDB's HTTPFS extension; enable caching via `TIMESTORE_QUERY_CACHE_*` to reduce repeated downloads.
- In tests or inline mode the query executes synchronously; in production the route reads from local paths or remote object storage locations identified in the manifest.
- Dataset-specific IAM rules can be stored under `datasets.metadata.iam` (e.g., `{ readScopes: ['observatory:read'], writeScopes: ['observatory:write'] }`). These override the global `TIMESTORE_REQUIRE_SCOPE`/`TIMESTORE_REQUIRE_WRITE_SCOPE` values.

## Administrative API
- `GET /admin/datasets` lists datasets with optional status filters, search, and cursor-based pagination.
- `GET /admin/datasets/:datasetId` returns dataset metadata; the path accepts either dataset id or slug.
- `GET /admin/datasets/:datasetId/manifest` returns the latest published manifest and partitions.
- `GET /admin/datasets/:datasetId/retention` shows the stored and effective retention policy; `PUT` updates the policy and records an audit event.
- `GET /admin/storage-targets` lists storage targets with optional kind filtering; `PUT /admin/datasets/:datasetId/storage-target` updates the default storage target for a dataset.
- Administrative routes require the scope defined by `TIMESTORE_ADMIN_SCOPE` (or `TIMESTORE_REQUIRE_SCOPE` when unset) via the `x-iam-scopes` header.
- Ingestion requests honour dataset write scopes and optionally accept `x-iam-user`/`x-user-id` headers for audit logging; when provided, the actor id is attached to audit logs.

## Testing
- Run `npm run lint --workspace @apphub/timestore` to type-check the service.
- Execute `npm run test --workspace @apphub/timestore` to validate the metadata repositories against an embedded PostgreSQL instance.
