# Ticket 092: Workflow Graph API & Caching Layer

## Problem Statement
With the graph assembler in place, we must expose the topology via a catalog API that frontend clients can consume efficiently. Rendering the graph on every page load without caching would overload Postgres, while exposing it without proper access control could leak operational details.

## Goals
- Add a Fastify route under `/api/workflows/graph` (exact path finalized with Ticket 090 outputs) that returns the versioned graph payload.
- Enforce operator/workflow scopes consistent with existing workflow admin endpoints.
- Introduce a lightweight caching strategy (in-memory or Redis) with invalidation hooks on workflow definition, trigger, schedule, and asset updates.
- Document the API in OpenAPI and provide integration tests covering authorization, cache invalidation, and response shape.

## Non-Goals
- Client-side data modeling or visualization.
- Live update streaming (handled later via event overlays).
- Long-term storage or historical snapshots of topology changes.

## Implementation Sketch
1. Define route schema, request/response typings, and authorization guard leveraging `requireOperatorScopes`.
2. Wrap the graph assembler in a cache abstraction:
   - Cache key keyed by graph version.
   - Invalidation triggers from existing event emitters (`workflow.definition.updated`, asset declarations, trigger mutations).
   - Metrics/logging for cache hits/misses.
3. Implement integration tests using Fastify inject:
   - Auth success/failure cases.
   - Cache hit after repeated calls.
   - Invalidation path triggered via mocked event.
4. Update OpenAPI document and add developer docs describing TTLs and invalidation semantics.

## Deliverables
- New API endpoint returning the graph payload with access controls.
- Cache implementation with instrumentation and invalidation hooks.
- Integration tests and OpenAPI documentation updates.
