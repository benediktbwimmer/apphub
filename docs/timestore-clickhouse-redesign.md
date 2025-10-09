# Timestore ClickHouse Redesign

## Goals
- Replace DuckDB-based staging with a horizontally scalable OLAP engine that guarantees read-after-write.
- Keep AppHub ingestion semantics (hot buffer, idempotency, manifests, backfills) while drastically improving stability.
- Optimize storage cost by keeping hot data on SSD and offloading cold partitions to S3 transparently.
- Minimize time-to-value by wrapping ClickHouse instead of rebuilding core OLAP features ourselves.

## Non-Goals
- Replacing the PostgreSQL catalog or queue infrastructure.
- Building a general-purpose lakehouse query engine over arbitrary Parquet.
- Supporting multi-region replication in the first iteration.
- Re-implementing dataset lifecycle maintenance (compaction, exports) outside ClickHouse-managed TTL.

## High-Level Architecture
1. **Hot buffer** (existing Redis-based component) continues to collect streaming rows, dedupe idempotency keys, and assemble micro-batches per dataset/table/window.
2. **Ingestion orchestrator** transforms staged batches into ClickHouse inserts, manages schema evolution, and wraps transactional semantics (flush → manifest publish → snapshot watermark).
3. **ClickHouse cluster** (three-node minimum for HA) stores MergeTree tables per dataset group. Tables use a tiered storage policy: NVMe for hot parts, S3-backed disk for cold parts. ClickHouse Keeper maintains metadata consensus.
4. **Replica freshness manager** promotes a new watermark immediately after every flush. Read APIs consult the watermark and merge in-flight hot-buffer rows to deliver strict read-after-write.
5. **Query facade** exposes the existing timestore API while routing SQL to ClickHouse, augmenting results with hot-buffer tails, and annotating responses with replica freshness metadata.
6. **Manifest service** (unchanged Postgres layer) records partition manifests and schema versions and tracks exports to Parquet/object storage.

```
┌──────────┐     ┌──────────────┐     ┌──────────────────┐
│ Producers│ --> │ Hot Buffer   │ --> │ Ingestion Orchestr│
└──────────┘     └──────────────┘     └─────────┬────────┘
                                                │ batched INSERT
                                      ┌─────────▼────────┐
                                      │  ClickHouse      │
                                      │  MergeTree tables│
                                      └──┬───────────────┘
                   metadata (PQ)        │
            ┌───────────────────────────▼─────────────────┐
            │ Manifest Catalog (Postgres)                  │
            └────────────────┬─────────────────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │ Query Facade      │
                   │ (merge hot tail + │
                   │ ClickHouse rows)  │
                   └─────────┬─────────┘
                             │
                        API Consumers
```

## Ingestion Workflow
1. **Stage rows in hot buffer** — identical to current flow. Batches target `(datasetSlug, tableName, partitionKey)` tuples.
2. **Batch assembly** — orchestrator drains the buffer when either row count or max-age thresholds fire. It normalizes schema fields, infers nullable columns, and timestamps the batch.
3. **Schema evolution** — before insert, orchestrator compares batch fields against ClickHouse table schema:
   - Additive changes issue `ALTER TABLE ... ADD COLUMN` (nullable with default).
   - Breaking changes are rejected with actionable diagnostics; future automation can queue backfills or transformations.
4. **ClickHouse insert** — orchestrator formats a single `INSERT INTO db.dataset_table VALUES` statement (native columnar format via HTTP or TCP protocol). Batch size defaults to 10–50k rows to maximize compression and throughput.
5. **Manifest update** — once ClickHouse acknowledges the insert, orchestrator writes manifest metadata to Postgres: new partition IDs, storage target info, and schema version references.
6. **Snapshot watermark** — orchestrator records the latest `replica_watermark` (monotonic timestamp or ClickHouse insertion `max(event_time)`). Promotion runs synchronously: the ingestion worker waits until the watermark has propagated to a ClickHouse materialized view (see Freshness below).
7. **Export scheduling** — flush jobs now read directly from ClickHouse (or trigger ClickHouse materialized views) to produce Parquet files, then publish partition events as today.

### Parallelism
- We shard datasets across ClickHouse tables/databases, so multiple ingestion workers can insert concurrently without blocking.
- Writer-level deduplication still happens in the hot buffer (idempotency keys).
- ClickHouse supports concurrent inserts per table; we gate concurrency via per-dataset semaphores to avoid excessive merges.

## Read Path
1. Client issues a query via timestore API (SQL or filtered row source).
2. Query facade fetches the current `replica_watermark` for the dataset (cached in Redis/Postgres).
3. Facade issues the SQL to ClickHouse. Results include the watermark used for snapshot consistency.
4. Facade looks up hot-buffer rows newer than that watermark and merges them into the result set (stable sort by timestamp + partition key).
5. Response includes headers/metadata:
   - `x-timestore-replica-age-ms`
   - `x-timestore-freshness-mode` (`replica-only` or `replica+hot-buffer`)
   - Optional `latest_ingest_watermark` for clients that require strict confirmation.

### Require-Fresh Reads
- API requests can set `requireFresh=true` or pass `min_watermark`.
- If ClickHouse watermark lags, the facade waits for the ingestion worker to promote the next watermark (bounded wait, default 2s). If still stale, it falls back to serving entirely from the hot buffer or returns `409 Conflict` with retry hints.

## Storage Layout
- **Databases** — logically grouped by tenant or workload (e.g., `apphub_prod`, `apphub_demo`).
- **Tables** — `MergeTree` engine partitioned by `(dataset_slug, window)` and ordered by `(dataset_slug, table_name, partition_key, timestamp)`.
- **Storage policy** — `tiered_policy` uses:
  - `volume_hot`: local NVMe disk with cache size limits.
  - `volume_cold`: S3 disk for older parts.
- **TTL examples**
  ```sql
  ALTER TABLE timestore.records
  MODIFY TTL event_time + INTERVAL 7 DAY TO VOLUME 'cold',
          event_time + INTERVAL 90 DAY DELETE;
  ```
- **Caching** — enable ClickHouse S3 cache (`max_cache_size`, `cache_on_write_operations=1`) and configure background eviction.
- **Backups** — use `BACKUP TABLE ... TO S3` nightly plus incremental `RESTORE` tests.

## Freshness & Snapshot Management
- Each successful insert updates a heartbeat table (`timestore.ingest_watermarks`) storing `(dataset_slug, watermark_timestamp, clickhouse_revision)`; replicated across nodes.
- Ingestion waits for `system.inserts` to show the batch committed and for the watermark materialized view to reflect it.
- Query facade compares the requested range with this watermark:
  - If within: serve from ClickHouse + hot buffer tail.
  - If beyond: wait for next watermark or fall back to hot buffer only.
- Metrics: expose `timestore_replica_age_ms`, `timestore_hot_tail_rows`, and alert if age exceeds SLA.

## Schema & Manifest Handling
- ClickHouse columns map 1:1 with timestore field definitions. We store canonical schema JSON in Postgres as today and use it when emitting manifests.
- For additive evolution we run `ALTER TABLE` before the insert; ClickHouse is lock-free for column adds.
- Breaking evolution triggers a `SchemaEvolutionError` containing instructions (e.g., run backfill pipeline).

## Operational Plan
- **Cluster sizing** — start with 3 nodes (each 8 vCPU, 64 GB RAM, NVMe + S3 policy). Enable replication (`ReplicatedMergeTree`).
- **Keeper** — deploy embedded ClickHouse Keeper or dedicated Keeper nodes in Kubernetes/VMs.
- **Monitoring** — scrape ClickHouse metrics: `Fetches`, `MergedParts`, `BackgroundPoolTask`, S3 bandwidth. Integrate with existing Prometheus/Grafana dashboards.
- **Security** — configure SQL users per service, TLS to ClickHouse HTTP/TCP ports, network ACLs.
- **Retention** — TTL cleans older partitions; background tasks remove orphan manifests and S3 parts.
- **Disaster recovery** — run `BACKUP` to S3/MinIO, test `RESTORE` monthly. Keep Postgres manifests as source of truth for partition metadata.

## Migration Strategy
1. **Proof of Concept**
   - Deploy isolated ClickHouse cluster.
   - Mirror a limited dataset (dual-write from DuckDB + ClickHouse).
   - Validate ingestion throughput, read-after-write latency, and tiered storage behavior.
2. **Dual Running**
   - Hot buffer sends batches to both DuckDB and ClickHouse.
   - Query facade exposes a feature flag to route selected datasets to ClickHouse-only reads (with hot-buffer merge).
   - Compare metrics (latency, error rates).
3. **Cutover**
   - For each dataset: freeze new writes, backfill outstanding DuckDB data into ClickHouse via our manifest catalog, run validation queries, switch read flag, resume writes.
   - Decommission DuckDB staging files.
4. **Cleanup**
   - Remove DuckDB-specific recovery logic.
   - Update docs/runbooks.
   - Monitor for 1–2 weeks, then disable dual-write.

## Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| Insert bursts cause MergeTree merges to lag | Size batches, set `max_partitions_in_insert_block`, autoscale ingestion workers, monitor `BackgroundMergesAndMutationsPoolTask` |
| S3 latency spikes degrade cold queries | Tune S3 cache size, add CloudFront/MinIO edge, prewarm with scheduled scans |
| Schema drift across replicas | Run schema reconciler cron, enforce migrations via Git-based configs |
| Operational complexity | Partner with Infra team for Keeper/backup automation, provide runbooks |
| Cost overrun from replicated data | Use compression codecs (`ZSTD`), TTL + S3 policy, enforce per-tenant quotas |

## Open Questions
- Final sharding strategy: by tenant, by dataset slug hash, or hybrid?
- Minimum batch size per table to balance latency vs merge efficiency.
- Do we need ClickHouse materialized views for downstream analytics beyond timestore API?
- How to expose ad-hoc SQL access safely to power users (direct ClickHouse vs API-only)?

## Next Steps
1. Draft infra RFC for provisioning a production ClickHouse cluster (owner: Ops).
2. Implement ingestion POC that dual-writes to ClickHouse using our existing hot buffer interface.
3. Extend timestore query service to talk to ClickHouse and merge hot-buffer tails.
4. Build validation tooling that compares DuckDB vs ClickHouse results for a sample dataset.
5. Present results + finalize migration timeline (target: Q1 rollout for top-tier datasets).
