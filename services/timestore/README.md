# Timestore Service

The timestore service exposes a Fastify API that fronts a DuckDB-backed time series warehouse. It owns dataset metadata, manifest bookkeeping, and background workers that maintain partitioned DuckDB files across local and remote storage targets.

## Local Development
- Ensure a PostgreSQL instance is running. The service defaults to the core database at `postgres://apphub:apphub@127.0.0.1:5432/apphub`.
- From the monorepo root, run `npm install` once to link dependencies, then start the server with `npm run dev:timestore`.
- Optional: launch the lifecycle worker placeholder with `npm run dev:timestore:lifecycle` in a separate terminal.
- Launch the ingestion worker with `npm run dev:timestore:ingest` to process queued ingestion batches (BullMQ + Redis).
- Launch the partition build worker with `npm run dev:timestore:partition-build` so DuckDB file generation happens off the API node.

The service listens on `http://127.0.0.1:4100` by default and exposes `/health` and `/ready` endpoints for smoke tests.

## Schema Migration Tooling
Breaking schema changes (column renames, type rewrites, or removals) are executed via the offline migration CLI:

    npm run schema-migrate -- --manifest path/to/migration.yaml [--dry-run|--execute] [--archive-dir ./archives]

- **Manifest format** – Describe the dataset slug, governance metadata, target schema, and ordered operations. Supported operations include `rename` (optional inline transform), `transform` (arbitrary expression), and `drop` (with optional archival metadata).
- **Dry runs** – Set `execution.dryRun: true` in the manifest or pass `--dry-run` to validate expressions, checksums, and guardrails without mutating manifests or storage.
- **Execution** – Successful runs create a new schema version, rewrite each published manifest partition-by-partition, emit lifecycle audit events, refresh caches, and mark previous manifests as superseded for rollback.
- **Archival** – Drop operations can archive their values as NDJSON files under `execution.archiveDirectory` (overridable with `--archive-dir`). Files are named `dataset-<partitionId>-<column>.jsonl`.
- **Governance metadata** – `governance.ticketId` and `governance.approvedBy` are stamped into manifest metadata, partition metadata, and lifecycle logs for audit trails.

See `tickets/126-timestore-schema-tooling.md` for the full manifest schema, validation checklist, and rollout guidance.

## Configuration
Environment variables control networking, storage, and database access:

| Variable | Description | Default |
| --- | --- | --- |
| `TIMESTORE_HOST` | Bind address for the Fastify server. | `127.0.0.1` |
| `TIMESTORE_PORT` | Port for HTTP traffic. | `4100` |
| `TIMESTORE_DATABASE_URL` | Connection string; falls back to the core `DATABASE_URL`. | `postgres://apphub:apphub@127.0.0.1:5432/apphub` |
| `TIMESTORE_PG_SCHEMA` | Dedicated schema within the shared Postgres instance. | `timestore` |
| `TIMESTORE_STORAGE_DRIVER` | `local`, `s3`, `gcs`, or `azure_blob`, toggles storage adapter. | `local` |
| `TIMESTORE_STORAGE_ROOT` | Local filesystem root for DuckDB partitions. | `<repo>/services/data/timestore` |
| `TIMESTORE_STAGING_DIRECTORY` | Filesystem root for DuckDB staging spools. | `${APPHUB_SCRATCH_ROOT}/timestore/staging` (falls back to `<repo>/services/data/timestore/staging`) |
| `TIMESTORE_STAGING_MAX_DATASET_BYTES` | Soft byte ceiling per dataset spool before warnings emit. | `536870912` (512 MiB) |
| `TIMESTORE_STAGING_MAX_TOTAL_BYTES` | Aggregate staging footprint threshold; `0` disables warnings. | `0` |
| `TIMESTORE_STAGING_MAX_PENDING` | Max in-flight staging batches per dataset before applying back-pressure. | `64` |
| `TIMESTORE_STAGING_FLUSH_MAX_ROWS` | Row-based trigger disabled by default; set a positive value to enable. | `0` |
| `TIMESTORE_STAGING_FLUSH_MAX_BYTES` | Flush staged data once a dataset’s DuckDB spool reaches this many bytes; `0` disables the byte threshold. | `1073741824` (≈1 GiB) |
| `TIMESTORE_STAGING_FLUSH_MAX_AGE_MS` | Age-based trigger disabled by default; set a positive value to enable. | `0` |
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
| `TIMESTORE_CONNECTORS_ENABLED` | Toggle streaming/bulk ingestion connectors managed by the API node. | `false` |
| `TIMESTORE_STREAMING_CONNECTORS` | JSON array describing streaming connectors (file driver supported). | `[]` |
| `TIMESTORE_STREAMING_BATCHERS` | JSON array describing streaming micro-batcher definitions that consume Redpanda topics. | `[]` |
| `TIMESTORE_STREAMING_BUFFER_ENABLED` | Toggle the in-memory streaming hot buffer used for hybrid queries. | `false` |
| `TIMESTORE_STREAMING_BUFFER_RETENTION_SECONDS` | Seconds of streaming data retained in the hot buffer per dataset. | `120` |
| `TIMESTORE_STREAMING_BUFFER_MAX_ROWS_PER_DATASET` | Per-dataset row cap for buffered streaming events. | `10000` |
| `TIMESTORE_STREAMING_BUFFER_MAX_TOTAL_ROWS` | Optional global row cap across all datasets (unset to disable). | _(unset)_ |
| `TIMESTORE_STREAMING_BUFFER_REFRESH_MS` | Interval for refreshing sealed partition watermarks from metadata. | `5000` |
| `TIMESTORE_STREAMING_BUFFER_FALLBACK` | Behaviour when the hot buffer is unavailable (`parquet_only` or `error`). | `parquet_only` |
| `TIMESTORE_BULK_CONNECTORS` | JSON array describing bulk loaders (file driver supported). | `[]` |
| `TIMESTORE_CONNECTOR_BACKPRESSURE` | JSON object with queue depth thresholds controlling connector pause/resume. | `{}` |
| `TIMESTORE_PARTITION_BUILD_QUEUE_NAME` | BullMQ queue backing remote partition builds. | `timestore_partition_build_queue` |
| `TIMESTORE_PARTITION_BUILD_ATTEMPTS` | Retry attempts for partition build jobs. | `5` |
| `TIMESTORE_PARTITION_BUILD_BACKOFF_MS` | Exponential backoff delay between partition build retries. | `15000` |
| `TIMESTORE_PARTITION_BUILD_TIMEOUT_MS` | Max wait time for partition build completion before failing ingestion. | `300000` |
| `TIMESTORE_PARTITION_BUILD_CONCURRENCY` | Worker concurrency when executing partition build jobs. | `2` |
| `TIMESTORE_REQUIRE_SCOPE` | Optional scope required via `x-iam-scopes` header for query access. | _(unset)_ |
| `TIMESTORE_ADMIN_SCOPE` | Scope required for administrative dataset routes; falls back to `TIMESTORE_REQUIRE_SCOPE` if unset. | _(unset)_ |
| `TIMESTORE_REQUIRE_WRITE_SCOPE` | Scope required to create or ingest into datasets when dataset metadata does not specify write scopes. | _(unset)_ |
| `TIMESTORE_FILESTORE_SYNC_ENABLED` | Toggle filestore event consumer. Set to `false` to disable. | `true` |
| `TIMESTORE_FILESTORE_DATASET_SLUG` | Dataset slug used for filestore activity ingestion. | `filestore_activity` |
| `TIMESTORE_FILESTORE_DATASET_NAME` | Friendly dataset name for UI/query responses. | `Filestore Activity` |
| `TIMESTORE_FILESTORE_TABLE_NAME` | ClickHouse table name that stores filestore activity rows. | `filestore_activity` |
| `TIMESTORE_FILESTORE_RETRY_MS` | Backoff between Redis subscribe retries when consuming events. | `3000` |
| `FILESTORE_REDIS_URL` | Redis connection shared with the filestore service (`inline` for tests). | `redis://127.0.0.1:6379` |
| `FILESTORE_EVENTS_CHANNEL` | Pub/sub channel that carries `filestore.*` events. | `apphub:filestore` |

When the service boots it ensures the configured Postgres schema exists, runs timestore-specific migrations, and reuses the core connection pool helpers so migrations and manifests share the managed database.

### ClickHouse Storage
- Incoming ingestion batches now land directly in ClickHouse tables derived from each dataset slug. The timestore manifest continues to record partition metadata, but the authoritative data lives inside ClickHouse.
- Because ClickHouse handles durability and tiering internally, the old staging directory and flush thresholds are no longer used. Ingestion writes run idempotently by reusing the same ingestion signatures that back manifests.
- Storage targets represent logical ClickHouse backends. Retention and maintenance workflows operate on manifest metadata while ClickHouse manages physical storage.

### Streaming & Bulk Connectors
- Enable connector workers by setting `TIMESTORE_CONNECTORS_ENABLED=true`. When disabled, connector definitions are ignored even if configured.
- `TIMESTORE_STREAMING_CONNECTORS` expects a JSON array. The file driver consumes newline-delimited JSON envelopes that match the ingestion schema (`offset`, `idempotencyKey`, `ingestion`). Provide `checkpointPath` and optional `dlqPath` to persist offsets and capture failures.
- Streaming micro-batchers are configured through `TIMESTORE_STREAMING_BATCHERS`. Each descriptor maps a Kafka/Redpanda topic to a dataset slug, schema, and time window so high-frequency events are aggregated before entering the ingestion pipeline.
- The streaming hot buffer rides on the same topic definitions. When `TIMESTORE_STREAMING_BUFFER_ENABLED=1`, the service tails high-water offsets for each batcher, keeps recent events in memory, and merges them with ClickHouse query results at query time. The buffer automatically evicts rows once the micro-batcher advances the watermark (persisted in `streaming_watermarks`).
- `TIMESTORE_BULK_CONNECTORS` tail directories for staged files (currently JSON). Each descriptor can override `chunkSize`, set `deleteAfterLoad`, or leave ingested files renamed with a `.processed` suffix.
- Backpressure thresholds come from `TIMESTORE_CONNECTOR_BACKPRESSURE` (high/low watermarks + pause window); connectors pause polling when the ingestion queue depth crosses the configured limits.
- Connector progress is tracked in JSON checkpoints so a restart resumes from the previous offset without reprocessing data.

#### Streaming Hot Buffer
- Enable via `TIMESTORE_STREAMING_BUFFER_ENABLED=1` alongside the micro-batcher. Configure per-dataset retention and memory limits with the knobs above.
- Hybrid queries automatically call the buffer when the requested range overlaps the streaming window. The JSON response now includes a `streaming` block (`bufferState`, merged row count, watermark, `fresh` flag) so clients can surface freshness indicators.
- Operators can monitor buffer health through the new metrics: `timestore_streaming_records_total`, `timestore_streaming_flush_duration_seconds`, `timestore_streaming_flush_rows`, `timestore_streaming_backlog_seconds`, and `timestore_streaming_open_windows`. Querying the `streaming_watermarks` table reveals the most recent sealed partition per dataset.
- If the buffer becomes unavailable, set `TIMESTORE_STREAMING_BUFFER_FALLBACK=parquet_only` to continue serving sealed partitions (with a warning) or `error` to fail fast until the streaming tier recovers.

### Filestore Integration

With filestore sync enabled the server starts a background consumer that subscribes to `FILESTORE_EVENTS_CHANNEL`. Events are appended to the dataset identified by `TIMESTORE_FILESTORE_DATASET_SLUG` (default `filestore_activity`) using the same ingestion pipeline as the public API. Each record captures file size deltas, reconciliation results, and command completions, enabling dashboards that chart storage churn. During development you can leave `FILESTORE_REDIS_URL=inline` to avoid running Redis—events are delivered in-process when both services run inside the same Node.js VM.

## HTTP Ingestion API
- `POST /datasets/:datasetSlug/ingest` accepts a JSON payload containing schema metadata, a partition key, records (JSON objects), and optional `idempotency-key` header. Jobs enqueue over Redis/BullMQ unless `REDIS_URL=inline` (tests/dev) in which case ingestion runs inline.
- Successful ingestions create a new dataset (if needed), versioned schema definition, manifest metadata, and append rows into the ClickHouse table backing the dataset.
- The API responds synchronously when running inline, otherwise returns a `202 Accepted` with the enqueued job id.

## Query API
- `POST /datasets/:datasetSlug/query` returns time-series data by scanning ClickHouse partitions. Provide a required `timeRange` plus optional `columns`, `downsample`, and `limit` settings.
- Downsampling is expressed via `downsample.intervalUnit`/`intervalSize` and aggregation list (e.g., `{ fn: "avg", column: "temperature_c", alias: "avg_temp" }`). Supported aggregations include `avg`, `min`, `max`, `sum`, `median`, `count`, `count_distinct`, and `percentile` (with `percentile` requiring a `percentile` value between 0 and 1).
- Queries execute through the ClickHouse HTTP interface. Remote partition pointers remain in manifests for lineage, but data is served from ClickHouse storage.
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
