# Expand CLI to metastore, filestore, and service registry flows

## Context
- The CLI entrypoint (`apps/cli/src/index.ts:4`) wires only jobs and workflows commands.
- Operators rely on the UI or direct HTTP calls for metastore diffs, filestore mounts, and service manifest status.
- Shared schema/types already live in `packages/`, enabling reuse in CLI commands with minimal duplication.

## Impact
- Automation scripts cannot currently fetch or mutate metadata through the CLI, so teams roll their own tooling.
- Platform SREs lack a consistent interface for queueing service imports or validating filestore mounts in headless environments.
- Missing CLI coverage slows incident response for scenarios where the frontend is unavailable.

## Proposed direction
1. Add new command groups (`metastore`, `filestore`, `services`) under `apps/cli/src/commands/` with subcommands for list/show/diff/update flows.
2. Reuse zod schemas from `packages/shared` and OpenAPI clients (once generated) to validate payloads.
3. Implement output formatting (table/json) to integrate with scripting and CI pipelines.
4. Ensure authentication mirrors existing CLI flows (operator tokens/API keys) and document usage in `apps/cli/README.md`.
5. Cover commands with unit tests under `apps/cli/tests/` exercising happy-path and failure scenarios against mocked APIs.

## Acceptance criteria
- CLI exposes supported commands for metastore record management, filestore mount inspection, and service registry status checks.
- Documentation describes new flags/examples, and commands integrate with existing auth configuration.
- Automated tests cover new command groups, proving they parse flags and handle API failures gracefully.
