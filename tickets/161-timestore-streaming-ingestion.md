# 161 - Timestore Streaming & Bulk Ingestion Pipeline

## Summary
Extend Timestore ingestion beyond HTTP JSON batches by adding streaming connectors, bulk loaders, and backpressure-aware flow control that can sustain continuous telemetry firehoses.

## Why
- Current ingestion only accepts bounded JSON payloads staged through the API or inline BullMQ jobs, which is untenable for log, metrics, or device streams.
- Operators need first-class integrations with Kafka/Kinesis/PubSub and scheduled bulk loads from object storage.
- Without flow control and chunked writes, the API node can exhaust memory or overwhelm lifecycle workers.

## Scope & Constraints
- Provide ingestion adapters for at least one streaming bus (Kafka/Kinesis) and one blob-drop bulk mechanism (S3/GCS prefix watcher).
- Implement backpressure signals to pause/resume connectors when queues or storage throughput fall behind.
- Support schema evolution and idempotency in streaming context (dedupe keys, checkpoint offsets, DLQ handling).
- Keep existing HTTP ingestion path working; make connectors opt-in per dataset/workspace.
- Ensure new workers integrate with existing metrics, tracing, and audit logs.

## Deliverables
- Connector framework (configuration, lifecycle, health endpoints) for external data sources feeding BullMQ jobs.
- Backpressure primitives (queue depth thresholds, partition build throttle, retry policies) surfaced in config and docs.
- Bulk loader that stages large Parquet/CSV files from object storage into partition build jobs with automatic chunking.
- Integration tests covering streaming ingestion, failure recovery, and schema evolution defaults.
- Operational guidance for connector deployment (credential management, topic/stream setup, monitoring).

## Success Criteria
- Sustained ingestion of 5k records/sec via a streaming connector without API node memory spikes or job retries.
- Bulk loading a 50GB Parquet drop completes without manual intervention and produces manifest shards suitable for querying.
- Connectors expose health/metrics endpoints consumed by existing dashboards, including lag, throughput, and DLQ counts.
- Schema evolution continues to emit events/backfill requests when new columns appear in streaming payloads.

## Open Questions
- Should we run connectors inside the monorepo workers or as separate managed services?
- What persistence guarantees do we need for offset checkpoints (Postgres vs. external store)?
- How do we authenticate and authorize external connectors per dataset in multi-tenant deployments?
