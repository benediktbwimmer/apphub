# Ticket 071: Harden Asset Materializer for Distributed Runs

## Problem Statement
`AssetMaterializer` keeps workflow/asset graphs, in-flight run tracking, and failure backoff solely in process memory. Running more than one materializer instance risks duplicate auto-runs, skewed cooldowns, and lost state after restarts. To support horizontal scaling and resilience, the worker must coordinate via shared storage/locking.

## Goals
- Persist workflow asset graphs, latest asset snapshots, in-flight run markers, and failure backoff metadata to a shared store (PostgreSQL and/or Redis).
- Introduce distributed coordination (e.g., advisory locks, Redis locks, or row-level ownership) so multiple workers partition work safely.
- Ensure restarts resume pending auto-runs and respect existing cooldowns.
- Document deployment guidance for scaling the materializer.

## Non-Goals
- Rewriting asset auto-materialization policies or trigger logic.
- Implementing dynamic sharding across heterogeneous queues.
- Building new UI dashboards (covered separately).

## Implementation Sketch
1. Add persistence layers for asset graph metadata and latest asset production records; refresh on boot from the database instead of only via events.
2. Replace in-memory sets/maps (e.g., `inFlight`, `failureState`, `latestAssets`) with durable state guarded by locks or transactional updates.
3. Introduce locking when considering or enqueueing auto-runs so only one worker claims a workflow partition at a time.
4. Update enqueue/cleanup flows to release locks and update shared state on success/failure.
5. Extend tests to simulate dual workers and confirm no duplicate runs or lost cooldowns occur after process crashes.

## Acceptance Criteria
- Two materializer instances can run simultaneously without issuing duplicate auto-runs.
- Restarting a worker preserves knowledge of recent failures and prevents immediate retries until the backoff elapses.
- State inspection (logs/tests) shows persisted workflow graphs and asset snapshots synced across workers.
- Test suite covers multi-worker scenarios and crash recovery.
