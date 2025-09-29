# Ticket 502: Introduce Service Layer for Catalog Job Routes

## Problem
`services/catalog/src/routes/jobs.ts` blends HTTP validation, database mutations, AI bundle orchestration, and queue scheduling in a single Fastify plugin. The 700+ line file is difficult to reason about, and failed requests require manual inspection of tangled `try/catch` blocks.

## Proposal
- Create a job domain service (e.g., `services/catalog/src/jobs/service.ts`) that encapsulates DB access, AI orchestration, and queue operations behind typed methods.
- Trim the Fastify route module to request validation, scope checks, and service invocation, using shared error mappers to generate consistent HTTP responses.
- Add focused unit tests for the new service layer, mocking queue and AI dependencies to cover success and failure paths.
- Update existing integration tests to ensure no behavioural regression at the API surface.

## Deliverables
- New job domain service with accompanying tests.
- Simplified Fastify route module delegating to the service.
- Shared error mapper utility reused by other catalog routes.

## Risks & Mitigations
- **Hidden coupling:** Map out current side effects (analytics snapshots, bundle recovery) before extraction to avoid missed hooks.
- **Test coverage gaps:** Extend test fixtures to simulate queue failures and AI provider errors, ensuring the service emits precise HTTP codes.
