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
| `TIMESTORE_STORAGE_DRIVER` | `local`, `s3`, `gcs`, or `azure_blob`, toggles storage adapter. | `local` |
| `TIMESTORE_STORAGE_ROOT` | Local filesystem root for DuckDB partitions. | `<repo>/services/data/timestore` |
| `TIMESTORE_S3_BUCKET` | Bucket for remote partition storage when `storageDriver` is `s3`. | `timestore-data` |
| `TIMESTORE_S3_ENDPOINT` | Optional S3-compatible endpoint (e.g., MinIO). | _(unset)_ |
| `TIMESTORE_S3_REGION` | Region used for S3 operations. | _(unset)_ |
| `TIMESTORE_S3_ACCESS_KEY_ID` | Access key for DuckDB remote reads and writers. | _(unset)_ |
| `TIMESTORE_S3_SECRET_ACCESS_KEY` | Secret key paired with the access key. | _(unset)_ |
| `TIMESTORE_S3_SESSION_TOKEN` | Session token for temporary credentials. | _(unset)_ |
| `TIMESTORE_S3_FORCE_PATH_STYLE` | Force path-style S3 URLs (`true`/`false`). | `false` |
| `TIMESTORE_GCS_BUCKET` | Bucket used for Google Cloud Storage targets. | _(unset)_ |
| `TIMESTORE_GCS_PROJECT_ID` | Optional GCP project identifier for the bucket. | _(unset)_ |
| `TIMESTORE_GCS_KEY_FILENAME` | Path to a service account JSON file for writers. | _(unset)_ |
| `TIMESTORE_GCS_CLIENT_EMAIL` | Service account client email used for writers. | _(unset)_ |
| `TIMESTORE_GCS_PRIVATE_KEY` | Service account private key (`\n` escaped) used for writers. | _(unset)_ |
| `TIMESTORE_GCS_HMAC_KEY_ID` | HMAC access key id used to authorise DuckDB `gs://` reads. | _(unset)_ |
| `TIMESTORE_GCS_HMAC_SECRET` | HMAC secret paired with the access key id. | _(unset)_ |
| `TIMESTORE_AZURE_CONTAINER` | Azure Blob container for timestore datasets. | _(unset)_ |
| `TIMESTORE_AZURE_CONNECTION_STRING` | Connection string used for writer and query access. | _(unset)_ |
| `TIMESTORE_AZURE_ACCOUNT_NAME` | Optional account name override when using emulator endpoints. | _(unset)_ |
| `TIMESTORE_AZURE_ACCOUNT_KEY` | Optional shared key (used when deriving signed URLs or fallbacks). | _(unset)_ |
| `TIMESTORE_AZURE_SAS_TOKEN` | Optional SAS token appended to custom endpoints. | _(unset)_ |
| `TIMESTORE_AZURE_ENDPOINT` | Optional custom blob endpoint (e.g., Azurite). | _(unset)_ |
| `TIMESTORE_QUERY_CACHE_ENABLED` | Enable DuckDB local cache for remote partitions. | `true` |
| `TIMESTORE_QUERY_CACHE_DIR` | Filesystem directory for cached remote partitions. | `<repo>/services/data/timestore/cache` |
| `TIMESTORE_QUERY_CACHE_MAX_BYTES` | Upper bound for cached partition bytes. | `5368709120` |
| `TIMESTORE_MANIFEST_CACHE_ENABLED` | Toggle Redis-backed manifest cache used by query planning. | `true` |
| `TIMESTORE_MANIFEST_CACHE_REDIS_URL` | Override Redis connection for manifest cache (falls back to `REDIS_URL`). | `redis://127.0.0.1:6379` |
| `TIMESTORE_MANIFEST_CACHE_KEY_PREFIX` | Redis key prefix for manifest cache entries. | `timestore:manifest` |
| `TIMESTORE_MANIFEST_CACHE_TTL_SECONDS` | TTL applied to manifest cache entries and indexes. | `300` |
| `TIMESTORE_LOG_LEVEL` | Pino log level for Fastify. | `info` |
| `TIMESTORE_INGEST_QUEUE_NAME` | BullMQ queue name for ingestion jobs. | `timestore_ingest_queue` |
| `TIMESTORE_INGEST_CONCURRENCY` | Worker concurrency when processing ingestion jobs. | `2` |
| `TIMESTORE_REQUIRE_SCOPE` | Optional scope required via `x-iam-scopes` header for query access. | _(unset)_ |
| `TIMESTORE_ADMIN_SCOPE` | Scope required for administrative dataset routes; falls back to `TIMESTORE_REQUIRE_SCOPE` if unset. | _(unset)_ |
| `TIMESTORE_REQUIRE_WRITE_SCOPE` | Scope required to create or ingest into datasets when dataset metadata does not specify write scopes. | _(unset)_ |
| `TIMESTORE_FILESTORE_SYNC_ENABLED` | Toggle filestore event consumer. Set to `false` to disable. | `true` |
| `TIMESTORE_FILESTORE_DATASET_SLUG` | Dataset slug used for filestore activity ingestion. | `filestore_activity` |
| `TIMESTORE_FILESTORE_DATASET_NAME` | Friendly dataset name for UI/query responses. | `Filestore Activity` |
| `TIMESTORE_FILESTORE_TABLE_NAME` | DuckDB table name that stores filestore activity rows. | `filestore_activity` |
| `TIMESTORE_FILESTORE_RETRY_MS` | Backoff between Redis subscribe retries when consuming events. | `3000` |
| `FILESTORE_REDIS_URL` | Redis connection shared with the filestore service (`inline` for tests). | `redis://127.0.0.1:6379` |
| `FILESTORE_EVENTS_CHANNEL` | Pub/sub channel that carries `filestore.*` events. | `apphub:filestore` |

When the service boots it ensures the configured Postgres schema exists, runs timestore-specific migrations, and reuses the catalog connection pool helpers so migrations and manifests share the managed database.

### Filestore Integration

With filestore sync enabled the server starts a background consumer that subscribes to `FILESTORE_EVENTS_CHANNEL`. Events are appended to the dataset identified by `TIMESTORE_FILESTORE_DATASET_SLUG` (default `filestore_activity`) using the same ingestion pipeline as the public API. Each record captures file size deltas, reconciliation results, and command completions, enabling dashboards that chart storage churn. During development you can leave `FILESTORE_REDIS_URL=inline` to avoid running Redis—events are delivered in-process when both services run inside the same Node.js VM.

## HTTP Ingestion API
- `POST /datasets/:datasetSlug/ingest` accepts a JSON payload containing schema metadata, a partition key, records (JSON objects), and optional `idempotency-key` header. Jobs enqueue over Redis/BullMQ unless `REDIS_URL=inline` (tests/dev) in which case ingestion runs inline.
- Successful ingestions create a new dataset (if needed), versioned schema definition, manifest, and DuckDB partition file on the configured storage target.
- The API responds synchronously when running inline, otherwise returns a `202 Accepted` with the enqueued job id.

## Query API
- `POST /datasets/:datasetSlug/query` returns time-series data by scanning published partitions via DuckDB. Provide a required `timeRange` plus optional `columns`, `downsample`, and `limit` settings.
- Downsampling is expressed via `downsample.intervalUnit`/`intervalSize` and aggregation list (e.g., `{ fn: "avg", column: "temperature_c", alias: "avg_temp" }`). Supported aggregations include `avg`, `min`, `max`, `sum`, `median`, `count`, `count_distinct`, and `percentile` (with `percentile` requiring a `percentile` value between 0 and 1).
- Remote partitions referenced via `s3://`, `gs://`, or `azure://` manifests are streamed through DuckDB's HTTPFS/Azure extensions; enable caching via `TIMESTORE_QUERY_CACHE_*` to reduce repeated downloads.
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

## Cache Maintenance
- `npm run prime-cache --workspace @apphub/timestore` primes the manifest cache for all active datasets using current Redis configuration.
- The script exits immediately when `TIMESTORE_MANIFEST_CACHE_ENABLED=false`, making it safe for environments that rely on inline caches.

## Testing
- Run `npm run lint --workspace @apphub/timestore` to type-check the service.
- Execute `npm run test --workspace @apphub/timestore` to validate the metadata repositories against an embedded PostgreSQL instance.
