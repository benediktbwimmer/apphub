# Ticket 008: Sandboxed Dynamic Job Runtime

## Summary
Refactor the workflow/job workers to load job bundles dynamically from the registry and execute them inside isolated sandboxes with well-defined capabilities.

## Problem Statement
Even with a registry and packaging tooling, workers still expect hardcoded handlers. We need a runtime that fetches bundles on-demand, verifies integrity, sandboxes execution, and manages lifecycle (warm-up, cache eviction, version upgrades).

## Scope & Requirements
- Worker resolves job slug to registry manifest, downloads bundle if cache miss, and verifies checksum/signature.
- Execute handlers in an isolation layer (child process or VM sandbox) with enforced timeouts and capability restrictions (fs/network based on manifest declarations).
- Implement bundle cache with eviction policy and support for concurrent runs using different versions.
- Provide telemetry: per-run sandbox logs, status, resource usage, and surface errors back to orchestrator.
- Design failure handling (e.g., registry offline, checksum mismatch) with graceful fallbacks and alerts.

## Non-Goals
- Migrating existing built-in jobs to bundles (handled later).
- Building a fully containerized executor; start with Node child processes but design extensibility.

## Acceptance Criteria
- Worker can run at least one sample bundle from registry end-to-end without static handler registration.
- Sandboxes enforce declared capabilities; unauthorized operations are blocked/logged.
- Cache refresh handles new versions: ongoing runs finish with old bundle while new runs use latest.
- Errors in bundles do not crash the main worker process; they surface as failed job runs with diagnostics.

## Dependencies
- Ticket 006 (registry metadata) and 007 (packaged bundles to test with).
- Existing job queue infrastructure in catalog.

## Testing Notes
- Unit tests for cache manager, manifest resolution, and capability enforcement.
- Integration tests running fixture bundles, including failure scenarios (invalid checksum, runtime exception).
