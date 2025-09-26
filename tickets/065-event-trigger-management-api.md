# Ticket 065: Expose Event Trigger Management API & CLI

## Problem Statement
Engineers currently have no supported way to create, update, or inspect event triggers. Manual database writes are unsafe and error-prone, especially with predicate schemas and throttling metadata. We need API endpoints and CLI helpers that respect RBAC, validate definitions, and integrate with existing workflow tooling.

## Goals
- Implement Fastify routes for trigger CRUD (`GET`, `POST`, `PATCH`, `DELETE`) scoped to workflow administrators and integrated with the new DB helpers.
- Provide validation feedback for predicates, parameter templates, throttles, and idempotency expressions before persistence.
- Extend the internal CLI (`npm run workflow:*`) with commands to list, create, update, and disable triggers from terminal scripts.
- Return delivery history summaries via `GET /workflows/:id/triggers/:triggerId/deliveries` for debugging.

## Non-Goals
- Building a full UI (handled in subsequent ticket).
- Supporting public/tenant-facing APIs; scope remains internal admin for now.
- Implementing event replay or backfill operations.

## Implementation Sketch
1. Add Fastify schemas and handlers under `services/catalog/src/routes/workflows/triggers.ts`, wiring to DB helpers and emitting audit logs.
2. Reuse JSON schema/JSONPath validators from ticket 061 to validate incoming trigger definitions and respond with actionable errors.
3. Extend CLI tooling in `packages/cli` (or equivalent) to call the new API, supporting JSON/YAML input and TTY prompts for confirmation.
4. Introduce pagination and filtering for delivery history retrieval; ensure sensitive payload data is redacted according to RBAC rules.
5. Cover routes and CLI with integration tests and update API docs (`docs/workflows.md`) with usage examples.

## Acceptance Criteria
- Authorized users can manage triggers via API/CLI, receiving clear validation errors on invalid definitions.
- Trigger operations are recorded in audit logs with user identity and version metadata.
- Delivery history endpoint returns recent executions with status/attempt counts, respecting pagination.
- Documentation and CLI help text explain workflows for managing triggers end-to-end.
