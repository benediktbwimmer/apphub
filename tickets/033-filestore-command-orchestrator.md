# Ticket 033: Implement Filestore Command Orchestrator & Journal

## Problem Statement
After scaffolding the service, we still lack the transactional layer that validates requests, runs filesystem mutations, records journal entries, and updates node state atomically. Without it, REST endpoints and workers cannot guarantee consistency between Postgres and physical storage.

## Goals
- Build a command orchestrator module responsible for:
  - Validating incoming commands (create, write, move, copy, delete, touch, ensure dir) against the Postgres model and backend configuration.
  - Opening a Postgres transaction, invoking the appropriate executor (local/S3), persisting node changes, and appending a `journal_entry` with correlation + idempotency metadata.
  - Publishing in-memory notifications so rollup/cache updates can react after commit.
- Support optimistic concurrency via node `version` checks, returning structured conflict errors for callers.
- Provide idempotency helpers keyed by `idempotency-key` header (stored in journal) to prevent duplicate work on retries.
- Register BullMQ tasks for long-running operations (e.g., recursive copy) that reuse the orchestrator logic.

## Non-Goals
- Concrete filesystem/S3 executors (handled in later tickets).
- REST route wiring (exposed in Ticket 034).
- Directory rollup maintenance (Ticket 036) or event publishing (Ticket 037).

## Implementation Sketch
1. Define TypeScript command types + validators (`CreateFileCommand`, `MoveNodeCommand`, etc.).
2. Implement orchestrator function (`runCommand`) that resolves target executor, wraps execution in a transaction, captures before/after snapshots, and writes journal entries.
3. Emit internal events (`command.completed`) using Node `EventEmitter` so downstream subscribers can schedule rollup recalculations or Redis notifications.
4. Add unit tests with mocked executors verifying journal persistence, idempotency replay, conflict detection, and error handling.

## Acceptance Criteria
- Commands update Postgres records and journal entries atomically; failures roll back both.
- Duplicate `idempotency-key` requests return the original result without re-executing the filesystem mutation.
- BullMQ jobs for recursive operations delegate to the orchestrator and support inline mode when `REDIS_URL=inline`.
- Tests cover success, validation error, executor failure, and optimistic concurrency conflict cases using the shared Postgres test harness (no Kafka dependencies introduced).
