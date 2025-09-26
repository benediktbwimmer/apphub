# Ticket 037: Maintain Directory Rollups & Caching

## Problem Statement
Filestore nodes record individual file metadata, but we lack aggregated directory stats (total size, item counts) and fast lookups for frequent reads. Without rollups and caching, the service will re-scan potentially large directory trees for every request.

## Goals
- Implement incremental rollup maintenance that updates parent directories during command execution (post-transaction) and schedules deeper recalculation jobs via BullMQ for expensive trees.
- Store rollup data in the `rollups` table introduced earlier, including `size_bytes`, `file_count`, `dir_count`, `last_calculated_at`, and `consistency_state`.
- Provide a Redis-backed cache for hot directory summaries, invalidated via pub/sub messages emitted after rollup updates.
- Expose rollup data through the API responses (Ticket 034) without triggering full scans.
- Add metrics for rollup freshness, queue depth, and cache hit ratios.

## Non-Goals
- Reconciling out-of-band drift (Ticket 038 handles re-sync).
- Metastore metadata overlays.

## Implementation Sketch
1. Extend the orchestrator to emit rollup update tasks into a BullMQ queue (`filestore_rollup_queue`) after successful mutations.
2. Implement workers that recalc rollups bottom-up, using Postgres window queries to aggregate children efficiently.
3. Add a Redis cache module keyed by `backend/parent_node_id`, with TTL and manual invalidation hooks triggered by pub/sub.
4. Update API serializers to include cached rollup stats and fall back to DB queries when missing.
5. Write tests ensuring rollups remain accurate after create/move/delete sequences and that cache invalidation occurs.

## Acceptance Criteria
- Directory stats remain accurate after consecutive mutations; drift is limited to pending rollup jobs tracked via metrics.
- Redis cache participates in inline mode when `REDIS_URL=inline` (using an in-memory map) to keep tests deterministic.
- Rollup worker queue integrates with existing Redis infrastructure—no Kafka or new brokers introduced.
- `/metrics` exposes counters/gauges for rollup latency, queue depth, and cache hits/misses.
