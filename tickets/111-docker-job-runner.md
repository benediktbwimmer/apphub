# Ticket 111: Implement Docker Job Runner Execution Path

## Problem
Even with schema support, the runtime layer (`services/catalog/src/jobs/runtime.ts`) only dispatches to sandbox runners for Node/Python bundles. There is no executor that can stage a workspace, invoke `docker run`, manage timeouts, or surface container status back to the job run record.

## Proposal
- Add a `dockerJobRunner` module that mirrors the sandbox runner entry point but drives container execution via the existing Docker helpers (`services/catalog/src/docker.ts`).
- Build a per-run workspace under a configurable root, wiring mounts for inputs, config files, and output directories.
- Launch containers with `docker run --rm`, capturing stdout/stderr, exit codes, and enforcing timeouts using `docker kill` when needed.
- Wire the runner into `executeJobRun` so Docker job definitions dispatch to it when `runtimeKind === 'docker'` and the feature flag is enabled.
- Ensure the runner tears down containers/workspaces even on error and propagates rich error context (exit code, signal, docker stderr) to the job record.

## Deliverables
- New runner module with comprehensive unit coverage for command construction, timeout handling, and cleanup logic.
- Updates to job runtime dispatch plus tests proving Node/Python behaviour is unaffected.
- Utility helpers for workspace management (mkdtemp, symlinks) with guards against directory traversal.
- Documentation comments detailing assumptions about Docker daemon availability and required environment variables.

## Risks & Mitigations
- **Container leaks:** Implement robust `finally` blocks with retry loops for `docker rm` and workspace deletion; add logging for cleanup failures.
- **Timeout races:** Use monotonic timers and verified signal paths to avoid orphaned processes.
- **Docker availability:** Detect missing daemon or permission issues early and surface actionable errors instead of silent failures.
