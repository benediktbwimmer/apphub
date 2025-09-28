# 160 - Timestore Distributed Execution & Storage Scale-Out

## Summary
Design and ship a distributed execution architecture for Timestore so large datasets and concurrent users are no longer bound to single-node DuckDB runtimes or per-partition DuckDB files.

## Why
- Query and ingestion paths currently run inside a single Node.js process using in-memory DuckDB connections, which caps concurrency and hot dataset size.
- Large customers expect horizontal scale, high availability, and the ability to mix storage formats (Parquet, Iceberg, etc.) without rewriting the service.
- Lifecycle workflows (compaction, exports) will stall once partition counts exceed what a single worker can stream.

## Scope & Constraints
- Introduce an execution abstraction that can target distributed engines (e.g., DuckDB extensions, DataFusion, Trino) while keeping existing API contracts.
- Support pluggable storage layouts: continue to write DuckDB files for small datasets but add Parquet/Lance backends with object-store manifests.
- Provide a deployment topology (workers, coordinators) that can scale horizontally with predictable queue semantics.
- Maintain backwards compatibility for existing datasets and tooling; migrations must be incremental.
- Enforce observability parity (metrics/tracing) so SLO dashboards remain actionable after the architecture shift.

## Deliverables
- Architecture RFC covering coordinator/worker roles, storage format negotiation, and failure recovery.
- Prototype service configuration that selects execution backend per dataset or workspace.
- Updated ingestion/partition build pipeline capable of emitting Parquet alongside DuckDB for targeted datasets.
- Query planner/executor that delegates to distributed workers, including retry and cancellation semantics.
- Operational runbooks for scale-out (autoscaling hints, worker health checks).

## Success Criteria
- A representative 10x larger dataset (by partitions and columns) ingests and queries with <20% regression compared to baseline latency using horizontal scaling.
- Coordinated failover (single worker crash) does not drop queries or ingestion jobs; retries succeed automatically.
- Lifecycle jobs (compaction/export) can fan out across workers without manual intervention.
- Observability dashboards show per-backend metrics so operators can detect hot shards and job backlogs.

## Open Questions
- Which distributed engine best balances cost, operational load, and feature completeness?
- How do we migrate existing DuckDB partitions to new formats without blocking ingestion?
- Can we reuse BullMQ for coordinating distributed workers, or do we need a dedicated orchestrator?
