# 125 - Remote Build & Partition Write Offload

## Summary
Move partition file creation off the Timestore service node into dedicated ingestion workers (or serverless jobs) that write DuckDB files directly to object storage, keeping the service stateless.

## Why
- Current ingestion writes partition files locally; scaling requires beefy service nodes.
- Offloading writes allows us to autoscale workers independently and keep the service lightweight.

## Scope & Constraints
- Design a gRPC/HTTP job that takes dataset + rows, returns partition metadata.
- Workers should stream output directly to S3-compatible storage (using multipart uploads for large files).
- Service coordinates metadata only (receives partition result, calls append/replace APIs).
- Backpressure/queueing to prevent worker overload.

## Deliverables
- New ingestion worker service or job runner (could reuse BullMQ) that emits DuckDB partitions.
- Protocol for ingest -> worker -> ingest (success/failure callbacks).
- Updated ingestion processor to enqueue jobs instead of writing locally.
- Observability: job duration, retries, failure reasons.

## Success Criteria
- Service CPU/RAM usage drops since it no longer handles DuckDB writes.
- Workers scale horizontally; ingestion throughput increases linearly with workers.
- End-to-end ingestion remains idempotent (same safeguards on storage).

