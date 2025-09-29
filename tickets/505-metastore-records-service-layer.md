# Ticket 505: Layer Metastore Record Routes Behind Domain Services

## Problem
`services/metastore/src/routes/records.ts` inlines namespace checks, transactions, stream events, audit publishing, and error mapping inside each handler. The duplication breeds bugs (e.g., missed events on new endpoints) and makes the Fastify module unwieldy.

## Proposal
- Introduce a metastore record domain service that encapsulates create/update/delete/search behaviour, including audit stream emission and event publishing.
- Implement a shared error mapper and register it via Fastify's `setErrorHandler` to centralize `HttpError` serialization.
- Update the route handlers to perform validation, scope checks, and delegate to the service, dramatically reducing per-endpoint boilerplate.
- Add unit tests for the service functions and integration tests to confirm events/audits still fire.

## Deliverables
- Domain service module with clear interfaces and test coverage.
- Slimmed-down route file relying on shared error handling.
- Documentation snippet describing the service contract and extension patterns.

## Risks & Mitigations
- **Event consistency:** Write regression tests that assert `emitRecordStreamEvent` and `publishMetastoreRecordEvent` are invoked for core flows before merging.
- **Refactor scope:** Stage work per HTTP verb (POST/PUT/PATCH) to keep PRs reviewable and avoid long-lived branches.
