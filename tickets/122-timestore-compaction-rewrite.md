# 122 - Timestore Compaction Pipeline Hardening

## Summary
Rework compaction to operate on shard-based manifests, add resumable checkpoints, and reduce redundant read/write cycles. Introduce chunked compaction and S3 multipart uploads so large datasets can compact reliably.

## Why
- Current compaction reads entire groups into memory and writes a single replacement file; failures require restarting from scratch.
- Large groups can overwhelm memory or S3 bandwidth.
- No checkpointing means long-running jobs risk lock contention and wasted work.

## Scope & Constraints
- Integrate with manifest sharding (Ticket 120) and schema evolution (Ticket 121).
- Support chunked compaction: process N partitions at a time with checkpoints stored in Postgres.
- Ensure compaction holds locks only while swapping partitions, not during long I/O.
- Provide metrics and audit logs for progress and resumptions.

## Deliverables
- New compaction job workflow: stream rows, write intermediate parquet/duckdb segments, resume via checkpoints.
- Manifest update logic using shard-level replace APIs with minimal locking window.
- Metrics: bytes processed, time per chunk, retry counts.
- Operational runbook for compaction tuning (chunk size, concurrency).

## Success Criteria
- Compaction can resume after interruption without reprocessing completed chunks.
- Lock contention during compaction stays below ingest SLA thresholds.
- Large datasets (>100 GB) compact successfully in staging tests.

