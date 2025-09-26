# Ticket 023: Timestore Query Gateway & Remote Storage Reads

## Problem Statement
Consumers need to query timestore datasets via SQL and API endpoints, but we lack a query planner, DuckDB read path, or remote storage integration. Without a gateway that can plan against manifests in Postgres and stream results efficiently, timestore remains write-only and unusable for analytics workloads.

## Goals
- Implement a query gateway (HTTP/SQL-over-HTTP/Arrow Flight) that accepts dataset/time range requests and orchestrates DuckDB reads.
- Plan queries by consulting the metadata catalog to resolve relevant partitions and storage locations.
- Add remote storage readers using DuckDB’s HTTPFS/S3 connectors with optional local caching to reduce repeated downloads.
- Support downsampling and aggregation primitives (e.g., windowed resample, percentile) surfaced via API parameters.
- Enforce dataset-level ACL checks leveraging shared IAM patterns before executing queries.

## Non-Goals
- Complex distributed execution scheduling (basic coordination is sufficient).
- Full-text search or non-time-series query features.

## Implementation Sketch
1. Define query API surface (SQL passthrough, templated range queries) and document accepted parameters + auth requirements.
2. Build planner that fetches manifests from Postgres, determines partition set, and constructs DuckDB queries referencing local/remote files.
3. Integrate DuckDB connectors for S3/GCS/Azure, with pluggable config sourced from timestore environment variables; implement cache warming hooks.
4. Implement downsampling helpers inside the planner to apply aggregations before returning results.
5. Add auth middleware using existing platform IAM to validate dataset access; include audit logging for query execution.
6. Write integration tests for representative query paths (local file, remote S3, cached reads) with mocked storage endpoints.

## Deliverables
- Query gateway service routes enabling SQL/time-range queries with DuckDB execution.
- Remote storage reader + caching layer proven through tests and documented configuration.
- Downsampling/aggregation options exposed via API with validation.
- Authenticated query flow auditable through logs and shared IAM integrations.
