# Timestore Roadmap

The current revamp aligns runtime storage and querying around Parquet partitions. The following items capture follow-up enhancements that will continue improving performance, debuggability, and long-term operability.

## Planned Improvements

- **Hot-partition cache manager** – Introduce a dedicated service that prefetches frequently queried Parquet windows into local SSD, tracks hit rates, and evicts partitions via LRU/age policies. Expose admin APIs to inspect cache state and trigger warm-ups for upcoming runs.
- **Adaptive execution planner** – Teach the query planner to record partition-level stats (size, latency history) and choose among streaming, cached, or pre-warmed execution modes based on the request SLA. Long-term this also unlocks running aggregations with Polars/Arrow for heavy workloads.
- **Metadata enrichment** – Persist rich schema and column statistics inside manifests so the planner no longer needs to `DESCRIBE` Parquet files at query time. This reduces cold-plan latency and gives operators a single source of truth for schema evolution audits.
- **Runtime observability** – Extend metrics/logging to break down S3 bytes read, cache hit/miss ratios, and per-query partition costs. Couple with alerting when the system falls back to slow streaming paths or repeatedly scans the same cold windows.
- **Background maintenance** – Add jobs that compact aged partitions, vacuum unused Parquet artifacts, and reconcile exports on a schedule. The goal is to keep storage tidy without impacting foreground query throughput.
- **Client ecosystem validation** – Document and test cross-engine consumption paths (DuckDB CLI, Spark, external BI) to ensure the new Parquet layout remains portable as more teams plug into timestore data.

These items are intentionally incremental; each can ship independently as we learn more about workload patterns now that the Parquet-first architecture is in place.
