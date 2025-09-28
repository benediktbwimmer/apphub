# 123 - Timestore Manifest Caching Layer

## Summary
Introduce a shared manifest cache to offload Postgres from hot query paths. Cache manifest partition lists and shard metadata in Redis (or similar), with invalidation hooks on ingestion and lifecycle operations.

## Why
- High-frequency queries currently fetch manifest partitions from Postgres on every request.
- As manifests grow, repeated queries can add noticeable latency.
- A shared cache enables horizontally scaled query nodes without pounding the database.

## Scope & Constraints
- Cache entries keyed by dataset slug + shard + manifest version.
- Invalidate/refresh cache after ingestion, compaction, retention, and schema migrations.
- Provide cache-priming tool for cold start scenarios.
- Ensure consistency: queries must never serve stale manifest state after lifecycle operations.

## Deliverables
- Redis-backed cache module with typed payloads and TTL strategy.
- Hooks in ingestion and lifecycle jobs to update/invalidate cache.
- Query planner changes to read from cache, fallback to Postgres on miss.
- Observability: cache hit/miss metrics, eviction counters.

## Success Criteria
- Cache hit rate >90% for steady-state queries in staging load tests.
- Postgres load during query storms drops demonstrably.
- No stale manifests observed in correctness tests (cache invalidation works reliably).

