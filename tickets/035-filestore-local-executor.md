# Ticket 035: Ship Local Filesystem Executor & Watcher

## Problem Statement
Filestore commands currently have no implementation for local disk backends. We must translate orchestrator requests into deterministic `fs` operations, enforce invariants (no stray manual writes), and detect drift when directories are modified out of band.

## Goals
- Implement a `LocalExecutor` that supports create/write/move/copy/delete/list operations using Node's `fs/promises`, ensuring atomic moves and safely handling large files via streaming.
- Add optional staging temp directories for safe writes (write temp, fsync, rename) to protect against partial failures.
- Integrate POSIX permission preservation (where supported) and capture resulting metadata (mode, owner, mtime) back into Postgres nodes.
- Introduce a chokidar-based watcher per configured mount that emits drift events into a BullMQ queue when external changes occur, tagging nodes as `INCONSISTENT` until reconciled.
- Provide metrics/logging for executor latency, bytes moved, and watcher events.

## Non-Goals
- S3/object storage operations (Ticket 036).
- Automatic reconciliation (Ticket 038 will resolve drift events).
- Client SDK wrappers (Ticket 039).

## Implementation Sketch
1. Create `executors/localExecutor.ts` implementing the required interface for orchestrator usage.
2. Leverage `fs.rm` / `fs.cp` with feature detection for Node version, falling back to stream copy for older runtimes.
3. Build a mount manager that spawns chokidar watchers when `FILESTORE_ENABLE_WATCHERS` is true, debounces events, and pushes them into Redis-backed queues for follow-up.
4. Write unit/integration tests using `tmp` directories to validate operations, permission handling, and watcher drift detection.

## Acceptance Criteria
- Local mutations update disk and Postgres consistently; failures roll back journal entries.
- Watchers detect manual file additions/removals and emit drift jobs within seconds (configurable debounce) without overwhelming Redis.
- Metrics for executor actions appear on the `/metrics` endpoint (histograms for latency, counters for operations, bytes processed).
- Documentation in `docs/filestore.md` describes how to configure local mounts and drift detection.
