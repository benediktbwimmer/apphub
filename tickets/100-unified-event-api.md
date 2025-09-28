# Ticket 100: Expand Event API for Unified Explorer

## Problem
Operators lack a consistent backend contract for the real-time explorer. `workflow.event.received` envelopes exist, but the websocket type map drops them, `/admin/events` only filters on type/source, and there is no way to query by correlation id or payload fields. Without richer filters and pagination, a comprehensive events view cannot ship.

## Proposal
- Extend `/admin/events` query options to accept `correlationId`, JSONPath filter expressions, cursor-based pagination, and severity hints derived from payload metadata.
- Include `workflow.event.received` (plus asset, metastore, filestore, timestore subtypes) in the websocket outbound serializer with typed payloads.
- Serialize useful cross-links in each event: workflow ids, repository ids, dataset ids, etc., when present.
- Document the contract in `docs/events.md`, covering new query params, response schema, and websocket message shapes.

## Deliverables
- Updated Fastify handlers (`services/catalog/src/routes/admin.ts`, `routes/core.ts`) with tests covering new filters and cursor semantics.
- Database helpers that support the additional predicates without full table scans, including new indexes if needed.
- Type definitions in `@apphub/shared` so frontend consumers get compile-time safety.
- Documentation updates plus an example curl walkthrough for the expanded API.

## Risks & Mitigations
- **Query performance:** Adding payload filters may stress Postgres; mitigate with generated indexes or materialized views if needed.
- **Schema drift:** Clearly version the response shape and gate breaking changes behind feature flags during rollout.
