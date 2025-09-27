# Ticket 044: Timestore Dataset Admin CRUD API

## Problem Statement
Timestore's admin routes expose read-only dataset listings plus retention and storage-target updates, but creating or editing dataset metadata still relies on side effects from ingestion calls or manual SQL. Operators cannot rename datasets, toggle status, or seed metadata before ingestion begins.

## Goals
- Add authenticated admin endpoints for creating, updating, and archiving datasets (name, description, status, default storage target, IAM metadata).
- Support optimistic concurrency or idempotency so UI workflows can safely retry without duplicating datasets.
- Extend audit logging to capture dataset CRUD actions with actor context.
- Provide request/response schemas in the shared package for UI consumers.

## Non-Goals
- Replacing ingestion-side auto-provisioning entirely; keep backward compatibility so ingest can still create datasets when needed.
- Implementing dataset-level version history beyond standard auditing.

## Implementation Sketch
1. Introduce POST/PATCH routes under `/admin/datasets` that validate payloads with zod, apply scope checks (`timestore:admin`), and persist changes through the metadata repository.
2. Update `services/timestore/src/db/metadata.ts` with helpers for dataset updates that preserve existing metadata fields and timestamps.
3. Emit dataset access audit records for each CRUD action, including before/after snapshots where appropriate.
4. Publish route typings through `packages/shared` so the frontend can consume them without duplicating schemas.
5. Add unit/integration tests covering happy-path creation, update validation failures, status toggles, and idempotent retries.

## Deliverables
- New admin dataset CRUD endpoints with validation, authorization, and audit logging in place.
- Shared TypeScript types for the new request/response payloads.
- Automated test coverage demonstrating dataset creation and updates work without side effects from ingestion.
- Updated API documentation describing the new endpoints and example workflows.
