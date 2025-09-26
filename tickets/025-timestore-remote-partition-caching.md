# Ticket 025: Timestore Remote Partition Reads & Caching

## Problem Statement
The query executor currently `ATTACH`es manifest file paths directly, which works for local storage but fails when manifests point at `s3://` locations. Without initializing DuckDB's HTTPFS/S3 extensions or staging remote files locally, timestore cannot read the partitions written by the S3 storage target. This leaves production datasets unreadable and creates unnecessary load when repeatedly downloading the same remote partitions.

## Goals
- Enable transparent reading of remote partitions referenced by manifests, covering S3-compatible endpoints and future HTTPFS targets.
- Hydrate DuckDB with the necessary extensions and credentials derived from `ServiceConfig`, avoiding per-request reconfiguration.
- Add an optional local cache layer for remote partitions to reuse recently fetched files and reduce latency/bandwidth.
- Provide configuration toggles (TTL, cache directory, max size) and surface metrics/logs around cache hit rates and download costs.

## Non-Goals
- Supporting every cloud provider on day one; focus on S3-compatible storage with extension hooks for others.
- Building a distributed shared cache; start with node-local caching only.

## Implementation Sketch
1. Extend `ServiceConfig` to expose DuckDB extension flags, remote credentials, and cache settings; add environment variables for S3 key/secret/session token when needed.
2. Update the query executor to `INSTALL`/`LOAD` HTTPFS/S3 extensions, configure credentials, and detect `s3://` paths before attaching partitions.
3. Implement a cache helper that materializes remote `.duckdb` files into a managed directory, enforces TTL/size policies, and returns local paths for attachment.
4. Instrument cache operations with metrics (hit/miss/evictions) and structured logs for observability.
5. Add integration tests that mock S3 via MinIO or intercept fetches, ensuring `executeQueryPlan` succeeds with remote manifests and cache reuse.
6. Document configuration, operational considerations, and cleanup utilities in the timestore README.

## Deliverables
- Remote-aware query execution path with configurable DuckDB extension initialization.
- Node-local cache module with tests and metrics, wired into query execution.
- Updated service configuration + documentation covering new environment variables and cache semantics.
- Automated tests proving remote partition reads and cache reuse.
