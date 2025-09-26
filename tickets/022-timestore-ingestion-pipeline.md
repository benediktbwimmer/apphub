# Ticket 022: Timestore Ingestion Pipeline & DuckDB Partition Writers

## Problem Statement
To populate timestore with time series data we need an ingestion pipeline that accepts batch writes, validates payloads, and persists them into DuckDB partition files. No ingestion API, worker, or DuckDB integration currently exists, preventing datasets from being populated or partition manifests from being updated.

## Goals
- Define ingestion APIs (HTTP/gRPC) and worker queue contracts for appending Arrow/JSON batches into timestore datasets.
- Implement DuckDB-based writers that create/update partition files grouped by dataset + semantic key + time window.
- Ensure manifest updates are transactionally recorded in the shared Postgres metadata catalog designed in Ticket 021.
- Support both local filesystem staging and remote object storage writes through a pluggable storage abstraction.
- Provide schema validation (Arrow schemas + timestamp ordering) and append-only guarantees with idempotency keys.

## Non-Goals
- Performing heavy compaction or aggregation (handled in Ticket 024).
- Implementing full client SDKs beyond minimal ingestion helper.

## Implementation Sketch
1. Finalize ingestion API contract (payload shape, Arrow support, partition routing inputs) and publish in service OpenAPI docs.
2. Build ingestion worker harness that consumes append requests, stages data in temporary DuckDB files, and promotes them to final partitions on success.
3. Integrate with storage driver interface to place partition files on local disk or object storage, capturing URIs for manifest writes.
4. Update metadata layer to record new partitions atomically with ingestion (leveraging shared Postgres transactions).
5. Add tests covering append workflows, idempotent retries, and validation failures; include fixtures for both local and remote storage paths.

## Deliverables
- Ingestion API endpoints and worker queue processors producing DuckDB partition files.
- Storage abstraction supporting local + remote targets validated via unit/integration tests.
- Manifest updates persisted in shared Postgres with transactional guarantees.
- Documentation describing ingestion flow, payload schemas, and operational expectations.
