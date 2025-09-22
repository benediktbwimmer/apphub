# Ticket 016: Modularize Catalog Fastify Server

## Summary
Refactor the monolithic `services/catalog/src/server.ts` file into domain-scoped Fastify plugins so the API surface is easier to maintain, test, and extend.

## Problem Statement
The catalog service currently declares authentication, repositories, builds, services, jobs, workflows, AI helpers, and bundle publishing routes inside a single 3,900+ line `server.ts` file. Shared schemas are duplicated inline, operator guard logic is scattered, and the file’s size makes incremental changes risky. Breaking the server into domain modules with reusable schema packages will reduce coupling, improve readability, and unlock targeted testing for each area.

## Goals & Scope
- Define domain plugins (e.g., `routes/repositories.ts`, `routes/workflows.ts`, `routes/jobs.ts`, `routes/services.ts`, `routes/auth.ts`) that register related routes and reuse shared helpers.
- Extract Zod schema definitions and TypeScript types into per-domain modules or a shared `schemas/` package to eliminate inline duplication.
- Introduce a lightweight registration layer in `server.ts` that composes the domain plugins and wires common hooks (auth, logging, error handling).
- Ensure existing REST and WebSocket endpoints retain parity, including validation, error responses, and telemetry hooks.
- Delete redundant operator-scope guards or schema copies after the shared modules are adopted.
- Update documentation and runbooks to describe the new module layout and contribution guidelines.

## Non-Goals
- Changing public API contracts or adding new endpoints beyond necessary refactor-driven adjustments.
- Rewriting queue workers or ingestion logic (covered by separate tickets).
- Migrating to a different web framework; Fastify remains the server choice.

## Acceptance Criteria
- `server.ts` shrinks to a thin bootstrap that registers domain plugins and shared middleware in fewer than 500 lines.
- Each domain plugin encapsulates its routes, schemas, and handlers with clear exports and unit-testable functions.
- Shared Zod schemas/types are imported from the new modules; duplicated schema definitions in `server.ts` are removed.
- Operator scope checks are centralized (e.g., helper `requireScopes`) and reused across plugins without local inline copies.
- API regression tests or integration smoke tests confirm that existing endpoints behave identically post-refactor.
- Documentation/runbooks are updated to explain where to add new routes and schemas.

## Implementation Notes
- Start by identifying cohesive route clusters (repositories, workflows, jobs) and extracting them one at a time to keep diffs reviewable.
- Create helper utilities for registering auth hooks and error formatters so plugins can opt into common behavior with minimal boilerplate.
- Consider adding a `plugins/index.ts` barrel file to simplify registration order and avoid circular dependencies.
- Update existing unit/integration tests to import the new module paths; add focused tests per plugin to cover edge cases previously only tested indirectly.
- Ensure Hot Module Replacement or dev server reload paths remain functional after the file structure changes.

## Dependencies
- Existing Fastify server configuration, authentication utilities, and database access modules.
- Test harnesses and fixtures that exercise the catalog API endpoints.
- Documentation tooling for updating runbooks.

## Testing Notes
- Run existing API integration and end-to-end tests to ensure behavior parity after modularization.
- Add unit tests for newly extracted schema helpers and route handlers where feasible.
- Perform manual smoke tests against key operator flows (repository ingest, workflow launch) in a dev environment.

## Deliverables
- Refactored catalog server codebase with domain plugins and shared schema modules.
- Updated documentation/runbooks reflecting the modular structure and contribution patterns.
- Test evidence (CI runs, logs) demonstrating parity and coverage of the refactored server.
