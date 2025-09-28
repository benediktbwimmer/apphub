# Timestore Manifest Sharding

Timestore now shards dataset manifests by partition start date to reduce row-level lock contention during ingestion. Each published manifest owns a `manifest_shard` key (currently `YYYY-MM-DD`), and partitions inherit the same shard. Ingest jobs pick the shard from the partition's start timestamp and either append to the current shard manifest or lazily publish a fresh manifest when a new day is encountered.

## Daily shards

- Shards are derived with `deriveManifestShardKey` in `services/timestore/src/service/manifestShard.ts`.
- The helper normalises timestamps to UTC day boundaries (`YYYY-MM-DD`). Adjusting shard duration means centralising the change to that helper and updating any range utilities that rely on it.
- Published manifests remain transactional per shard, and lifecycle jobs iterate shards in order so retention/compaction/export decisions stay isolated to the day they affect.

## Schema and lookup helpers

- `dataset_manifests.manifest_shard` and `dataset_partitions.manifest_shard` track ownership.
- A new materialised view `dataset_manifest_current` exposes the current manifest id per shard.
- Metadata helpers such as `listPublishedManifests`, `listPublishedManifestsForRange`, and `listPublishedManifestsWithPartitions` centralise shard-aware lookups.

## Backfilling existing datasets

The migration populates `manifest_shard = 'root'` for legacy manifests. Operators can backfill historic datasets by:

1. Selecting each legacy manifest via `SELECT id FROM dataset_manifest_current WHERE manifest_shard = 'root'`.
2. Re-publishing day-specific manifests using the ingestion or lifecycle tooling (e.g. export partitions, republish with corrected shard keys).
3. Verifying partition rows adopt the expected shard (`SELECT DISTINCT manifest_shard FROM dataset_partitions WHERE dataset_id = ?`).

Until a dataset is rebased, lifecycle jobs still operate on the `'root'` shard; ingestion of new data immediately writes to the correct day shard.

## Operational checks

- The admin API now returns all active shard manifests (`GET /admin/datasets/:id/manifest`) and supports `/manifest?shard=YYYY-MM-DD` for direct lookup.
- The SQL runtime merges partitions across shards when populating DuckDB caches, so analytics queries stay unchanged.
- Monitor `timestore_sql_context_build_seconds` (or the corresponding log) during shard growth; sharded manifests increase partition counts but avoid per-ingest lock contention.

Update runbooks to include verifying shard health with:

```sql
SELECT manifest_shard, COUNT(*) partitions
FROM dataset_partitions
WHERE dataset_id = $1
GROUP BY manifest_shard
ORDER BY manifest_shard;
```
