# Ticket 039: Build Filestore Reconciliation Worker

## Problem Statement
Watchers will flag drift when files change outside the API, but we currently have no worker to reconcile those discrepancies. Without automated reconciliation, Postgres and Redis caches will remain stale, undermining trust in Filestore data.

## Goals
- Create a BullMQ-backed reconciliation worker that consumes drift jobs produced by watchers or scheduled audits.
- Implement strategies per backend:
  - Local mounts: re-stat paths, detect deletes/additions, compute hashes when requested, and update `nodes` + `snapshots` accordingly.
  - S3 mounts: perform prefix listings with pagination + ETag comparison, handle eventual consistency, and mark nodes back to `ACTIVE` once reconciled.
- Emit follow-up events (`filestore.node.reconciled`, `filestore.node.missing`) and update rollups after reconciliation.
- Surface reconciliation status in Postgres (`nodes.consistency_state`, audit timestamps) for API consumers.

## Non-Goals
- Human-facing dashboards (will be covered in docs/CLI work).
- Complex policy engines for drift resolution—focus on replace vs. delete semantics for now.

## Implementation Sketch
1. Define a `reconciliation_queue` using existing Redis connection options and ensure inline mode works for tests.
2. Implement worker handlers that batch work, respect concurrency limits, and call the orchestrator update helpers to persist state.
3. Add scheduling hooks: periodic audits (cron job) plus reactive enqueues when watchers fire.
4. Write tests simulating drift scenarios for both local + S3 backends, verifying node status transitions and event publication.

## Acceptance Criteria
- Reconciliation jobs process successfully in local dev (`npm run filestore:reconcile` or similar) and in CI using inline Redis mode.
- Nodes transition between `ACTIVE`, `INCONSISTENT`, `MISSING` states accurately, with timestamps recorded.
- Rollups and caches refresh post-reconciliation, and Redis events notify subscribers of changes.
- Metrics track reconciliation backlog, success/failure counts, and duration.
