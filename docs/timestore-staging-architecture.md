# Timestore Staging Architecture Redesign

**Status:** Proposed  
**Owner:** timestore team  
**Tracking Issues:** [#209](https://github.com/apphub/apphub/issues/209), [#210](https://github.com/apphub/apphub/issues/210)  

## Background

Timestore keeps an on-disk DuckDB database under `scratch/timestore/staging/<dataset>` that acts as the write-optimised spool for ingestion. Each `stagePartition` call writes rows and appends a JSON schema snapshot to the `__ingestion_batches` table. Query planning then opens the same DuckDB file to infer the latest column definitions so the API can:

- Expose column metadata in `/datasets/:slug/query`.
- Map column types when the SQL runtime builds logical views.

This design allowed us to bootstrap quickly, but we now hit several problems in the demo stack and production-like tests:

- **Lock contention:** DuckDB takes an exclusive file lock per connection. While the ingest worker is writing batches, the query path repeatedly retries `ATTACH` and blocks for up to ~5 s (see logs from 2025‑10‑07 17:29Z). Even after adding an in-memory cache (issue #209) the first miss still contends on the file.
- **Latency variance:** Queries that only need schema hints still do file I/O and run DuckDB SQL against `__ingestion_batches`, so p99 latency is in seconds instead of the <100 ms target.
- **Operational friction:** Every process that wants to read staging schema must have filesystem access to the DuckDB file. Horizontal scaling or moving the ingest worker to a different node would require shared storage semantics.
- **Limited observability:** Locks are visible only via log warnings; we cannot easily measure schema-read retries or cache usage in Prometheus, nor can we spot stale schema propagation delays.

These issues block our ability to ship responsive query APIs and to scale ingest/query workloads independently.

## Goals

- **Sub‑100 ms query planning** in the steady state, even when ingestion is busy.
- **No shared file locking between read and write paths** (queries should not depend on the DuckDB file being readable).
- **Schema freshness within <1 s** of batches arriving (observatory dashboards and CLI tools rely on new columns promptly).
- **Deployment flexibility:** the ingest worker and query service may run on different containers/hosts without shared POSIX semantics.
- **Predictable observability:** metrics that expose cache hits/misses and propagation delays.

Non-goals:

- Replacing the main manifest storage (Parquet in object storage) or the hot streaming buffer.
- Changing how staged rows are flushed to durable storage.

## Requirements & Constraints

1. **Source of truth:** Staging DuckDB remains the authoritative write target until a flush copies batches to Parquet. Any redesign must keep writes idempotent and transactional.
2. **Backfills:** In-flight schema evolution (added columns, nullable flags) must continue to surface to the query path before flush.
3. **Cost:** Additional infrastructure should fit within current Postgres / Redis / object storage footprint; adding another heavy datastore is undesirable.
4. **Compatibility:** Existing APIs (`/datasets/:slug/query`, `/sql/*`) should not need client changes beyond optional parameters (e.g. specifying timestamp columns).

## Architectural Options

### Option A – DuckDB Read Replica

Maintain a second DuckDB database per dataset (“read replica”) that mirrors the schema/metadata tables via log shipping or periodic copy-on-write snapshots. Queries attach to the read-only replica while writes continue against the primary.

**Pros**
- Minimal changes in the query layer (same DuckDB SQL).
- Keeps schema inference logic identical.

**Cons**
- Requires implementing reliable WAL shipping or periodic snapshots; DuckDB does not natively support replication.
- Doubles storage footprint for all staging files.
- Snapshot lag introduces schema staleness unless we copy on every batch, which reintroduces lock/contention.
- Still ties us to shared storage semantics if ingest and query run on different hosts.

**Assessment:** High operational risk and unclear tooling support; does not fully solve the locking problem.

### Option B – Connection Serialisation via RPC

Move staging database access behind a dedicated “staging broker” process that serialises all DuckDB connections. Writers and readers RPC to that broker, which performs operations under a single process-level lock.

**Pros**
- Avoids filesystem locking issues by funnelling access through one process.
- Can cache data in-memory within the broker.

**Cons**
- Becomes a central bottleneck and single point of failure.
- Still executes DuckDB queries for schema inference, so latency remains tied to DuckDB performance.
- Adds network hops for both ingestion and query paths.
- Harder to scale horizontally; requires sticky sharding per dataset.

**Assessment:** Reduces file-lock contention but increases architectural complexity and does not hit the <100 ms latency goal.

### Option C – Persist Staging Schema Outside DuckDB (Recommended)

Treat DuckDB purely as a write spool. When ingestion stages a batch, derive the schema metadata and publish it to an external store (Postgres) in a consolidated form. Query planning reads from this “schema registry” instead of hitting DuckDB. The ingestion worker updates the schema registry transactionally alongside staging writes so schema changes propagate immediately. The registry keeps per-dataset field definitions, nullability, descriptions, and version counters.

**Pros**
- Removes DuckDB from the query path entirely; no file locks.
- Query schema lookup collapses to a single Postgres query + in-memory cache (fast).
- Easy to capture metrics (Postgres writes + in-process caches).
- Works even if ingest and query run on different hosts.
- Gives us a durable audit trail of schema evolution (useful for tooling).

**Cons**
- Requires new Postgres tables and transactional coordination with staging writes.
- Need to ensure schema registry stays in sync and handles rollbacks/corrupt batches.
- Slight increase in write amplification—each batch updates Postgres plus DuckDB.

**Assessment:** Meets all goals with modest complexity. Leverages existing infra (Postgres, Redis cache). This is the optimal path.

## Recommended Design (Option C)

### High-level Flow

1. **Ingestion**
   - When `stagePartition` runs, it already has the batch schema array. We normalise these `FieldDefinition`s and write them to DuckDB (as today).
   - After the DuckDB transaction commits, we upsert the field definitions into a new Postgres table `timestore_staging_schemas`.
   - Upsert merges new fields, tracks nullability, and increments a `schema_version`.
   - If the batch was a dedupe (already staged), we skip the upsert.

2. **Query Planning**
   - `readStagingSchemaFields` first checks the in-memory cache (retained from issue #209) and falls back to Postgres, not DuckDB.
   - The Postgres row stores fields as JSONB; we map them to `StagingSchemaField[]`.
   - Cache entries include `schema_version` to support conditional refresh.

3. **Invalidation**
   - When ingestion writes a new batch, it publishes an event or simply bumps a per-dataset Redis key so query instances drop their cache entry immediately.
   - Flushing a dataset (moving batches to Parquet) can either keep the schema (most fields remain valid) or record that staging is empty. No DuckDB access required.

4. **Observability**
   - We expose new metrics: Postgres write latencies, cache hits, schema lag (time since last update).
   - Logs no longer show DuckDB attach retries during queries.

### Data Model Additions

`timestore_staging_schemas` (Postgres):

| Column             | Type        | Notes                                                     |
|--------------------|-------------|-----------------------------------------------------------|
| dataset_id         | UUID        | PK / FK to datasets                                       |
| schema_version     | BIGINT      | Monotonically increasing per dataset                      |
| fields             | JSONB       | Array of `{name,type,nullable,description}`               |
| updated_at         | TIMESTAMPTZ | Wall time of last update                                  |
| checksum           | TEXT        | Hash of the canonical schema array (for quick diff)       |
| source_batch_id    | TEXT        | Optional staging batch that triggered the latest update   |

Indexes on `(dataset_id)` and `(checksum)` allow idempotent writes.

### Write Path Changes

- After successful staging insert, compute a schema checksum (sorted fields, trimmed names) and call `upsertStagingSchema(dataset, checksum, fields, batchId)`.
- Use `INSERT ... ON CONFLICT` with checksum guard: only bump version if schema changed.
- Wrap DuckDB + Postgres updates in a best-effort sequence: if the Postgres write fails, we enqueue a retry job (BullMQ) using persistently stored batch metadata. This ensures schema registry cannot drift long-term.

### Read Path Changes

- Replace DuckDB access in `readStagingSchemaFields` with:
  ```ts
  const registry = await getSchemaRegistry(dataset.id);
  ```
- If registry entry missing, fall back to pending batches via `spoolManager.listPendingBatches` (same as today) and write that result back to Postgres asynchronously to bootstrap.
- Remove the DuckDB `PRAGMA table_info` logic and associated lock/retry loops.

### Caching Strategy

- Keep the existing in-memory map (`stagingSchemaCache.ts`) but augment entries with `schemaVersion` and `updatedAt`.
- Add an optional Redis-backed cache for multi-instance deployments (TTL ~60 s) keyed by dataset ID + version.
- Ingestion publishes `staging-schema-updated` notifications (via Redis pub/sub or internal queue) containing dataset ID & version; query instances listen and invalidate promptly.

### Migration / Rollout Plan

1. **Schema registry table** – apply migrations to create `timestore_staging_schemas`.
2. **Dual-write phase** – update ingestion to populate Postgres while keeping the DuckDB path for read fallback. Collect metrics to ensure registry is populated.
3. **Query switch** – flip `readStagingSchemaFields` to prefer Postgres; keep DuckDB fallback behind an environment flag during soak.
4. **Cleanup** – once confident, remove DuckDB read code and tighten tests around the new cache.
5. **Follow-up** – explore exposing schema registry through admin API (`/admin/datasets/:id/staging-schema`) for diagnostics.

### Operational Considerations

- **Backpressure:** Postgres writes are lightweight (one row per dataset, updated on schema change). Monitor for frequent migrations when streaming connectors add columns.
- **Disaster Recovery:** Registry content can be rebuilt by scanning staging batches if necessary; provide a CLI tool that replays schemas into Postgres.
- **Security:** Registry table inherits existing timestore DB permissions; no new secrets.

## Future Extensions

- Persist per-field statistics (min/max) to guide query planners without hitting DuckDB.
- Record schema evolution events for auditing (potential integration with observability dashboards).
- Evaluate moving staging batch metadata out of DuckDB entirely once this pattern proves reliable.

## Open Questions

- Should we also persist *row counts* per staging batch in Postgres to eliminate other DuckDB reads?
- Do we want a stronger consistency check between registry checksum and manifest schema version to detect flush mismatches?
- How aggressively should we prune registry entries for archived datasets?

## Next Steps

1. Implementation issue: “Persist staging schema to Postgres registry” (covering ingestion changes and retries).
2. Implementation issue: “Replace DuckDB schema reads with registry lookup” (query runtime changes + cache updates).
3. Tooling issue: “Add staging schema admin endpoint & metrics” (expose for operators).
4. Monitoring: define SLOs for schema propagation (<500 ms P95 between staging write and registry update).

Delivering this plan removes DuckDB from the query critical path, eliminating the 5 s attach stalls and meeting the sub‑100 ms target while keeping the existing ingestion flow intact.
