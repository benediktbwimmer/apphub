# 120 - Timestore Manifest Sharding

## Summary
Introduce a manifest sharding strategy so ingest jobs can append partitions without contending on a single manifest row. Today every dataset keeps one active manifest; append operations take a row-level lock, so parallel writers serialize. We will shard manifests by time window (e.g., day) and introduce a view/lookup that surfaces the "current" manifests per shard.

## Why
- Reduce write contention when multiple workers ingest the same dataset.
- Unlock higher ingestion throughput without increasing lock wait times.
- Lay groundwork for tiered retention/compaction per window.

## Scope & Constraints
- Maintain the existing API: clients still query by dataset slug/time range.
- Metadata operations must remain transactional.
- Migration path for existing manifests (single shard) to multi-shard must be zero-downtime.
- Cover Postgres migrations, ingestion logic, compaction/retention updates, and planner changes.

## Deliverables
- Migration: add shard key columns (e.g., `manifest_shard`) and supporting indexes.
- Update ingestion to resolve shard (based on partition start time) and append within shard manifests, creating a new shard manifest lazily.
- Update planner to load manifests by shard over the requested time range.
- Update lifecycle jobs (compaction/retention/export) to operate per-shard.
- Regression tests for ingestion and query planner.
- Operational notes for shard sizing and backfill tool.

## Success Criteria
- Parallel ingest jobs targeting different time windows no longer block each other.
- Query plans reflect only the shards relevant to the requested time range.
- Lifecycle ops work transparently across shards.

