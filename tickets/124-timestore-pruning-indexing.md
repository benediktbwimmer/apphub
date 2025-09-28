# 124 - Timestore Partition Pruning & Indexing

## Summary
Add richer statistics and optional bloom filters per partition so the query planner can prune irrelevant files without attaching them. Collect column-level min/max and optional histograms to accelerate filters beyond time range.

## Why
- Today we rely on partition keys + time range only. Queries with column predicates still read every partition in the window.
- Large datasets will suffer from excessive I/O without pruning.

## Scope & Constraints
- During ingestion and compaction, compute column stats (min/max, distinct counts) for configured columns.
- Optionally build DuckDB bloom filters for chosen columns and persist alongside partition metadata.
- Planner enhancement: skip partitions whose stats do not satisfy query predicates.
- Provide configuration for which columns to index.

## Deliverables
- Metadata schema updates to store column stats and optional bloom filters.
- Ingestion/compaction hooks to compute stats and persist them.
- Planner logic to evaluate stats against query filters.
- Metrics to track partitions skipped vs scanned.

## Success Criteria
- Representative queries show reduced partition scans in benchmarks.
- Planner always respects pruning without missing matching rows.

