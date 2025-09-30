# Ticket 605: Finalize Ticket Schema and Git-Backed Store

## Problem
We lack a defined data model and persistence strategy for the new ticketing service, leaving agents without a reliable source of truth and risking conflicts when multiple clones modify tickets concurrently.

## Proposal
- Design the canonical ticket schema (status lifecycle, dependencies, activity log, metadata) and publish JSON Schema artifacts in `packages/shared/ticketing`.
- Decide on the file layout under `tickets/` (per-ticket YAML plus derived indexes) and document locking semantics based on git commit hashes and advisory files.
- Implement a TypeScript store module that reads/writes tickets, maintains `tickets/index.json` and `tickets/dependencies.json`, and broadcasts change events.
- Capture edge cases (dependency cycles, deleted tickets, stale writes) in acceptance criteria and developer docs for downstream service work.

## Deliverables
- Schema definitions and TypeScript types shared via a new workspace package.
- Prototype store implementation with unit coverage for CRUD, optimistic locking, and dependency graph updates.
- Documentation (`docs/ticketing-schema.md`) explaining file structures, versioning, and usage patterns for agents and humans.

## Risks & Mitigations
- **Concurrency conflicts:** Model advisory lock strategy and stale write detection in tests before other components depend on the store.
- **Schema drift:** Automate schema publishing and lint CI checks so service and agents stay aligned.
