# Ticket 041: Deliver Filestore SDK & CLI Toolkit

## Problem Statement
Even with REST endpoints, teams will struggle to adopt Filestore without ergonomic client libraries and tooling. Direct HTTP usage invites drift back to manual filesystem edits.

## Goals
- Publish a TypeScript SDK (within `packages/filestore-client` or similar) that wraps authentication, idempotent command submission, polling for completion, and streaming downloads.
- Provide a CLI (`filestore-cli`) that operators can use to inspect nodes, trigger commands, tail events, and run reconciliation tasks during migration.
- Ensure SDK + CLI integrate cleanly with Redis inline mode for local dev and respect platform auth tokens.
- Document usage patterns and examples, encouraging services to migrate from direct filesystem calls to the SDK.

## Non-Goals
- Supporting non-TypeScript languages in this ticket (document future work if needed).
- Replacing existing workflow CLIs—focus on filesystem operations.

## Implementation Sketch
1. Scaffold a new package with typed client methods calling the `/v1` endpoints, handling pagination and error translation.
2. Implement CLI commands using `commander` or similar, relying on the SDK under the hood; include commands like `list`, `stat`, `cat`, `move`, `watch-events`, `reconcile`.
3. Add unit tests with mocked HTTP + Redis inline mode to validate behaviours.
4. Update docs with migration guidance, code examples, and integration pointers for workers.

## Acceptance Criteria
- SDK published to the local workspace and used by at least one smoke-test script against the running filestore service.
- CLI commands succeed in local dev, demonstrating file create/move/delete and event tailing without manual filesystem mutations.
- Authentication + idempotency headers handled automatically by the SDK.
- Documentation covers setup, environment variables, and migration checklists for teams adopting the toolkit.
