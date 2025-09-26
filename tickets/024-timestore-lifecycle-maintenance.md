# Ticket 024: Timestore Lifecycle Maintenance, Compaction, & Parquet Export

## Problem Statement
After ingestion and querying are in place, timestore needs automation to manage data freshness, storage costs, and interoperability. Currently we have no processes for compaction, retention pruning, or Parquet export, leaving partition stores fragmented and metadata stale. Without lifecycle automation the service risks performance degradation and uncontrolled storage growth.

## Goals
- Implement scheduled background jobs for compacting small partitions, enforcing retention policies, and producing Parquet snapshots for cold datasets.
- Update manifests atomically to reflect compaction results, deleted partitions, and exported Parquet assets using the shared Postgres schema.
- Provide configurable retention rules per dataset (time-based, size-based) with safe deletion workflows and audit logging.
- Expose administrative endpoints/CLI to trigger maintenance runs, inspect status, and reschedule failed jobs.
- Integrate metrics/tracing to observe job health, storage usage, and Parquet export latency.

## Non-Goals
- Designing a generic workflow orchestrator; reuse existing queue/cron primitives.
- Building external catalog sync for Parquet consumers (document manual steps instead).

## Implementation Sketch
1. Extend worker harness with scheduled queues for compaction, retention pruning, and Parquet export tasks.
2. Implement DuckDB merge logic to combine adjacent partitions and recompute statistics before writing new files.
3. Add lifecycle controllers that evaluate dataset retention settings, mark expired partitions, and remove files safely from storage targets.
4. Generate Parquet exports via DuckDB, upload to remote storage, and update manifest records with new artifact references.
5. Instrument jobs with Prometheus metrics and structured logs; surface status via admin routes or CLI commands.
6. Write integration tests simulating compaction, retention deletes, and export flows to ensure manifest consistency.

## Deliverables
- Background job suite performing compaction, retention, and Parquet exports with manifest updates in shared Postgres.
- Administrative interfaces/documentation for operating maintenance tasks.
- Metrics and logs providing visibility into lifecycle job health.
- Tested retention + export workflows covering both local and remote storage targets.
