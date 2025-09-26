# Ticket 027: Timestore Dataset Administration APIs

## Problem Statement
Operational teams currently need direct Postgres access to inspect datasets, manifests, retention policies, and storage targets. This creates operational risk, slows debugging, and blocks observability tooling from integrating with timestore. Providing first-class administrative endpoints would let operators and tooling manage datasets without touching the database layer.

## Goals
- Expose authenticated HTTP endpoints to list datasets, fetch latest manifests, inspect retention policies, and enumerate storage targets.
- Support creation/updating of retention policies and default storage targets through the API, with validation and audit logging.
- Ensure responses are paginated and filtered to support large dataset inventories.
- Document endpoint usage and provide CLI scripts/examples for common workflows.

## Non-Goals
- Building a full UI; focus on API-level support that the frontend or CLI can consume later.
- Allowing destructive operations beyond what is already possible via lifecycle jobs (e.g., manual partition deletes remain lifecycle-controlled).

## Implementation Sketch
1. Define `/admin/datasets` routes (list/show) plus supporting resources for manifests, retention policies, and storage targets.
2. Reuse existing metadata queries, adding pagination helpers and request validation via Zod.
3. Integrate IAM checks to ensure only scoped operators can call these endpoints and emit audit log entries for write operations.
4. Write integration tests exercising the new endpoints against embedded Postgres, covering success and authorization failure cases.
5. Update documentation with API reference, curl examples, and operational guidance.

## Deliverables
- Administrative route handlers with pagination, validation, and IAM enforcement.
- Tests and audit logging for dataset management operations.
- Documentation outlining endpoint contracts and usage patterns.
