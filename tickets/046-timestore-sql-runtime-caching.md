# Ticket 046: Timestore SQL Runtime Context Caching

## Problem Statement
Every `/sql/read` request rebuilds the DuckDB runtime context by walking all datasets, loading manifests, resolving storage targets, and attaching partitions. This work happens even when consecutive queries hit the same datasets, causing unnecessary database chatter and longer p95 latencies for ad-hoc SQL.

## Goals
- Cache the computed SQL context and DuckDB attachments for a short time-to-live, reusing them across compatible read requests.
- Provide cache invalidation hooks when datasets change (new manifest, retention update, dataset CRUD) so results stay fresh.
- Instrument cache hit/miss metrics to track effectiveness and guard against stale context usage.

## Non-Goals
- Caching the actual query result sets; focus on metadata and attachments needed to execute queries efficiently.
- Introducing distributed caching—keep it in-process for now.

## Implementation Sketch
1. Wrap `loadSqlContext` and `createDuckDbConnection` with a caching layer keyed by dataset manifest versions; reuse contexts when the manifest set is unchanged.
2. Emit invalidation events when ingestion publishes a new manifest, retention removes partitions, or admin CRUD updates dataset metadata, flushing the relevant cache entries.
3. Track cache metrics (hit rate, rebuild duration) via Prometheus so we can evaluate the win and alert on regressions.
4. Ensure resource cleanup closes DuckDB connections when cache entries expire or are invalidated to avoid leaked file handles.
5. Add tests simulating repeated SQL reads to assert the cache short-circuits redundant rebuilds and respects invalidation triggers.

## Deliverables
- Cached SQL runtime context with scoped TTL and invalidation hooks covering ingestion, lifecycle, and admin updates.
- Prometheus metrics and logs exposing cache hit/miss counts and rebuild timings.
- Automated tests verifying the cache improves repeat query latency without serving stale schema attachments.
