# Ticket 057: Filestore Foundations & Navigation

## Problem Statement
Filestore now runs alongside Timestore and Metastore, yet the frontend has no notion of its base URL, scopes, or APIs. Without shared plumbing we cannot expose node explorers or write workflows later on. We need environment/config wiring, typed client helpers for the existing `/v1` endpoints, and a services-hub entry point so subsequent tickets can focus on UX.

## Goals
- Add `FILESTORE_BASE_URL` handling to `apps/frontend/src/config.ts`, defaulting to the catalog proxy when no env var is set. Document `VITE_FILESTORE_BASE_URL` and `.env` guidance.
- Extend the API access screen to list `filestore:read`, `filestore:write`, and `filestore:admin` scopes with copy consistent with other services.
- Scaffold `apps/frontend/src/filestore/` with `types.ts`, `api.ts`, and SSE helpers that wrap the existing routes:
  - `POST /v1/directories`
  - `DELETE /v1/nodes`
  - `GET /v1/nodes/:id`
  - `GET /v1/nodes/by-path`
  - `POST /v1/reconciliation`
  - `GET /v1/events/stream`
- Introduce a `FilestoreLayout` under the services hub and register `/services/filestore` as a placeholder route (accessible tab + guarded error boundary).
- Cover new schemas/client helpers with unit tests; update docs/README for config changes.

## Non-Goals
- Building a node browser UI or write operations.
- Modifying backend APIs beyond wiring the existing routes.
- Adding Filestore to the primary navbar (services sub-nav is sufficient).

## Implementation Sketch
1. Update config + docs, including `.env.example` if present.
2. Add scope metadata and tests in `ApiAccessPage`.
3. Scaffold filestore folder with Zod schemas, client functions, and SSE subscription hook.
4. Add the Filestore tab in `ServicesLayout` and child route in `router.tsx`, rendering a placeholder component that checks scopes.
5. Write unit tests validating schema parsing and base URL selection; ensure lint/tests pass.

## Acceptance Criteria
- Navigating to `/services/filestore` renders a Filestore placeholder within the services hub (no 404s) respecting scopes.
- `FILESTORE_BASE_URL` env var influences API helpers; defaults to the catalog proxy when unset.
- API access page lists Filestore scopes alphabetically with descriptions.
- New tests cover schema validation and config fallback; lint/tests pass.
