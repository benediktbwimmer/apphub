# 162 - Timestore SQL Runtime Incremental Context Builder

## Summary
Rework the SQL console runtime cache so schema discovery, manifest hydration, and DuckDB context creation scale to millions of partitions without rebuilding entire contexts per request.

## Why
- The SQL runtime currently enumerates every dataset, manifest, and partition into a single DuckDB database on each cache miss, which will time out or exhaust memory as catalog size grows.
- Incremental refresh is required to keep the SQL editor usable while ingestion and lifecycle jobs continuously mutate manifests.
- Operators need consistent query planning latency and visibility into cache staleness or rebuild failures.

## Scope & Constraints
- Introduce incremental cache invalidation keyed by dataset/manifest changes (listen to ingestion/lifecycle events or DB triggers).
- Support partial context rebuilds (per dataset or shard) without dropping active SQL sessions.
- Track cache generation metadata (version numbers, build durations, failure reasons) and surface via admin endpoints/metrics.
- Preserve existing SQL API contracts (schema endpoint, read/exec routes) and dataset-level IAM enforcement.
- Provide a fallback path so environments can disable incremental mode if issues arise.

## Deliverables
- Design doc covering new cache topology, invalidation signals, and concurrency model for DuckDB connections.
- Updated `loadSqlContext` and connection leasing logic that consume manifest/dataset deltas instead of full scans.
- Event-driven or trigger-driven invalidation wiring (Redis pub/sub, Postgres NOTIFY, or queue events) with retries and metrics.
- Instrumentation: Prometheus counters/histograms for cache hits, rebuild scopes, and staleness age, plus admin route reporting current cache state.
- Regression tests simulating large catalogs, concurrent ingestion, and SQL queries to validate correctness and performance.

## Success Criteria
- Catalogs with 1M partitions and hundreds of datasets rebuild SQL context incrementally in <5s without dropping connections.
- Cache hit ratio exceeds 95% during steady-state ingestion; rebuild metrics expose outliers for operators.
- SQL editor users observe consistent query latency (<200ms planner overhead) even while ingestion adds new manifests.
- Rollback to full-scan mode is feature-flagged and documented for emergency use.

## Open Questions
- Which event source provides the most reliable manifest change feed (Postgres logical decoding vs. application events)?
- Can we safely reuse DuckDB connections across incremental updates without leaking file handles?
- How do we prune stale datasets/manifests from the cache when they are deleted or archived?
