# Ticket 040: Integrate Filestore with Metastore & Timestore

## Problem Statement
Filestore change data must flow into Metastore (for tags/annotations) and Timestore (for historical analysis). Without integrations, tags drift from canonical file state and temporal insights remain disconnected.

## Goals
- Build a Redis-based event consumer (can live inside metastore/timestore packages or as a shared worker) that subscribes to filestore event channel(s) from Ticket 038.
- For Metastore:
  - Auto-create/update lightweight metadata records keyed by `filestore_node_id` so tags, owners, and business metadata stay aligned.
  - Provide hooks for namespace enforcement and ensure deletions/refreshes are reflected.
- For Timestore:
  - Append command timelines, size deltas, and reconciliation outcomes into DuckDB-backed datasets, reusing existing ingestion pipeline.
  - Expose query endpoints (or extend existing ones) so operators can chart storage growth or detect churn.
- Document how to deploy these consumers (can be background workers started via `npm run dev`).

## Non-Goals
- Building complex UI dashboards; focus on data plumbing.
- Introducing Kafka or other brokers—continue leveraging Redis pub/sub.

## Implementation Sketch
1. Extend metastore to include a consumer module that listens to `filestore.node.*` events, mutating metadata records transactionally; add config flags to opt in/out.
2. Extend timestore ingestion worker to ingest filestore events into a dedicated dataset (e.g., `filestore_activity`), mapping event payloads to schema columns.
3. Provide tests covering event flow in inline mode and with Redis to ensure consumers handle reconnects gracefully.
4. Update documentation describing how tags + timelines sync and how to query the new timestore dataset.

## Acceptance Criteria
- Metastore records stay synchronized with filestore nodes (creates, updates, deletes) during local dev runs.
- Timestore exposes new dataset(s) or metrics showing storage growth/history, populated by replaying filestore events.
- Consumers handle Redis outages by falling back to inline buffering or resuming from the last journal ID.
- Documentation explains configuration knobs and demonstrates sample queries (SQL for timestore, REST for metastore).
