# Generate shared TypeScript clients from service OpenAPI specs

## Context
- Frontend modules (e.g. `apps/frontend/src/metastore/api.ts:1`) hand-roll fetch logic and zod parsing.
- Metastore already exports an OpenAPI document (`services/metastore/src/openapi/document.ts:70`), but the spec is not consumed by clients.
- Duplicate request/response shapes drift from backend types, increasing maintenance overhead.

## Impact
- Manual client code lags behind schema changes, causing runtime errors when fields evolve.
- Each service duplicates fetch/error handling patterns, inflating bundle size and inconsistent error messages.
- Adding new endpoints requires updating multiple code paths, slowing delivery and risking missing validations.

## Proposed direction
1. Introduce an OpenAPI code generation step (e.g. `openapi-typescript`, `orval`) in the root build to emit typed clients into `packages/shared/api`.
2. Generate clients for metastore, core, filestore, and timestore, including request/response schemas and helpers.
3. Replace bespoke fetch modules in the frontend and CLI with generated clients, wrapping them if needed for auth headers.
4. Ensure generated code passes lint/build and document regeneration commands in `README.md`.
5. Cover generated clients with smoke tests or contract tests to detect spec drift during CI.

## Acceptance criteria
- Shared typed clients exist for major services, with generation automated via npm scripts.
- Frontend/CLI consumers import generated clients instead of duplicating fetch + schema parsing logic.
- Regeneration instructions live in repo docs, and CI fails when specs and generated artifacts diverge.
