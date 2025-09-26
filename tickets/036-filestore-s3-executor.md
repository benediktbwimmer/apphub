# Ticket 036: Implement S3/Object Storage Executor

## Problem Statement
Many repositories and bundles persist artifacts in S3. Without an S3-aware executor, Filestore cannot track or mutate remote objects, leaving a large portion of the filesystem estate unmanaged.

## Goals
- Build an `S3Executor` leveraging the existing `@aws-sdk/client-s3` dependency shared in the monorepo to support list/stat/put/copy/move/delete operations and multipart uploads for large files.
- Support bucket + prefix mounts defined in Postgres (`backend_mounts`), including path translation and optional KMS or canned ACL settings.
- Handle retry/backoff for eventual consistency, validating object existence post-operation before committing the transaction.
- Capture object metadata (ETag/hash, size, storage class, last modified) and write it into the `nodes` table + `snapshots`.
- Emit change notifications to Redis to keep caches and watchers in sync.

## Non-Goals
- GCS/Azure adapters (future extensions).
- Automatic reconciliation of drift (Ticket 038).
- CLI/SDK features (Ticket 039).

## Implementation Sketch
1. Implement `executors/s3Executor.ts` with streaming uploads/downloads, using multipart for files above configurable thresholds.
2. Add helper for atomic move/copy (copy then delete + verification) with idempotency safeguards.
3. Write integration tests using MinIO in CI (Docker service) or localstack to validate operations, guarded behind optional env flag for local runs.
4. Document required AWS env vars in the service README and `docs/filestore.md`.

## Acceptance Criteria
- Filestore can create/update/delete objects in S3-backed mounts while updating Postgres nodes and journal entries atomically.
- Large file uploads complete via multipart with resumable support and emit progress metrics.
- Retries/backoff handle transient S3 errors without breaking idempotency semantics.
- Tests simulate at least one bucket mount, ensuring metadata (size/hash) is persisted and Redis notifications fire.
