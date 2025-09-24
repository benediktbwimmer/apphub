# Ticket 013: Dedicated Example Bundler Orchestrator & API

## Problem Statement
Packaging and importing example bundles relies on `services/catalog` shelling into `apps/cli` to run `npm install` and tarball generation during request handling. This coupling introduces performance bottlenecks (installing dependencies on demand), obscures failure modes, and prevents other clients (CLI, tests) from reusing the same pipeline. “Load all examples” rebuilds identical bundles multiple times and can fail midway without a restartable plan. We need a centralized orchestrator that manages bundle packaging, caching, and orchestration as a reusable service/API.

## Goals
- Extract bundle packaging logic into a dedicated module/service (e.g. `packages/example-bundler`) that can be invoked by the API, CLI, and background jobs without shelling into another workspace.
- Provide a long-running worker or task queue within `services/catalog` that handles dependency install, build, and tarball creation asynchronously with caching.
- Expose new API endpoints (e.g. `POST /examples/load`, `POST /job-imports/example`) that trigger orchestrated workflows instead of blocking on synchronous installs.
- Enable the orchestrator to emit progress events (via WebSocket or job status polling) so the UI can surface detailed progress/errors when loading many examples.
- Support resumable operations and cache invalidation when example sources change (e.g. versioning via git commit/GH tree hash).

## Non-Goals
- Frontend UX changes beyond wiring to the new API; a dedicated UX overhaul is handled separately.
- General-purpose build caching beyond examples (though the architecture should allow extension later).

## Implementation Sketch
1. **Packaging Module**
   - Build a workspace package exposing functions for resolving example metadata, ensuring dependencies (`npm install`/`pnpm install`), building, and producing bundle artifacts.
   - Implement caching keyed by directory + package-lock hash to avoid repeated installs.

2. **Catalog Integration**
   - Introduce a queue (BullMQ) or task runner dedicated to example packaging with concurrency control.
   - Refactor job import routes to enqueue packaging tasks and await results (with timeouts) rather than executing child processes directly.

3. **API & Eventing**
   - Add endpoints to trigger single-example packaging, multi-example “load all”, and status retrieval.
   - Emit structured progress events (queued, installing deps, packaging, success/failure) over the existing WebSocket event bus.

4. **CLI & Test Consumers**
   - Update the CLI and `examples/tests` to call the orchestrator directly (via API or shared module) so they benefit from caching and consistent error handling.

5. **Operational Concerns**
   - Add metrics/observability for packaging tasks (queue depth, install time, cache hit rate).
   - Document environment requirements (disk space, network) and provide guardrails for cleaning stale caches.

## Deliverables
- New packaging/orchestrator module with caching and reusable APIs.
- Updated catalog service routes leveraging the orchestrator instead of spawning CLI installs.
- API endpoints and events for single and bulk example imports with resumable progress.
- Updated CLI/tests consuming the orchestrator.
- Observability docs and runbooks for maintaining the packaging cache.
