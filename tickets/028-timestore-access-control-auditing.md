# Ticket 028: Timestore Access Control & Auditing Enhancements

## Problem Statement
The timestore query path requires a single global scope, while ingestion is entirely unauthenticated. This approach is insufficient for multi-tenant deployments where datasets need per-tenant scoping and auditable access patterns. Without granular authorization and event logging, we risk unauthorized ingestions, blind spots in compliance reviews, and difficulty tracing who queried which dataset.

## Goals
- Introduce dataset-aware authorization: derive required scopes or roles from dataset metadata and enforce them on both ingestion and query endpoints.
- Support optional API tokens or signed headers for service-to-service ingestion while still honoring tenant isolation.
- Emit structured audit logs for ingestion and query operations (success/failure), capturing actor identity, dataset, and request metadata.
- Provide operational configuration to toggle strict mode or fallback behaviors for legacy clients.

## Non-Goals
- Building a full identity provider; rely on existing IAM primitives and headers established in the platform.
- Implementing per-row security policies; authorization remains dataset-level.

## Implementation Sketch
1. Extend dataset metadata schema to include allowed scopes/roles and propagate this into service configuration helpers.
2. Refactor IAM middleware to evaluate dataset-specific requirements, applying to ingestion and admin routes in addition to queries.
3. Build an audit logging utility that funnels structured events into Postgres (new table) or an external sink, and expose queries via admin APIs.
4. Update integration tests to cover authorized/unauthorized ingestion and query attempts, including regression tests for legacy global-scope mode.
5. Document rollout guidance, configuration knobs, and migration steps for existing datasets.

## Deliverables
- Dataset-aware IAM enforcement across ingestion, query, and admin routes with tests.
- Structured audit log pipeline with storage schema and retrieval helpers.
- Documentation detailing new authorization metadata, audit log usage, and migration considerations.
