# Ticket 506: Automate Catalog Route Plugin Registration

## Problem
`services/catalog/src/server.ts` manually registers every route plugin, creating a growing wall of boilerplate that is easy to forget when new modules land. Missing a registration silently hides endpoints and complicates code review.

## Proposal
- Introduce a route loader that scans `services/catalog/src/routes` for plugins (e.g., via `fs` + glob or a manifest) and registers them automatically with predictable ordering.
- Define explicit metadata (dependencies, required options) so plugins still receive the resources they need (e.g., service registry, queue manager).
- Add a startup smoke test to assert that all expected routes are registered and `/docs` reflects the full OpenAPI spec.
- Document the convention for adding new route plugins, including how to opt out or customize registration.

## Deliverables
- Automated route registration mechanism with tests.
- Simplified server bootstrap file delegating to the loader.
- Documentation update describing the convention and any migration steps for existing routes.

## Risks & Mitigations
- **Initialization order:** Allow plugins to specify priority or pre-requisites; keep critical ones (auth/core) explicitly ordered until proven safe.
- **Dynamic loading pitfalls:** Cache glob results in production and ensure bundlers (ts-node/webpack) include the route modules; add CI coverage that fails when new files lack metadata.
