# Ticket 033: Consolidate BullMQ Queue Management

## Problem
`queue.ts` duplicates queue creation, inline-mode checks, handler bootstrapping, and disposal logic across ingest, build, launch, workflow, and event queues. The repetition complicates configuration changes and increases risk of drift when adding new workers.

## Proposal
- Introduce a queue manager/factory that centralizes inline-mode detection, Redis connection lifecycle, default job options, and handler loading.
- Convert existing enqueue helpers to consume the shared manager and remove per-queue `ensure*` flags.
- Add telemetry hooks (e.g., logging, metrics) at the manager level to capture queue registration state.
- Document the pattern for future queues (asset events, examples) to ensure consistency.

## Deliverables
- Queue manager module with unit coverage for inline and Redis-backed modes.
- Updated queue helpers and workers consuming the manager.
- Reduced duplication in `queue.ts` and clearer lifecycle handling.

## Risks & Mitigations
- **Runtime regressions:** Add integration tests that enqueue jobs in both inline and Redis modes to validate behavior.
- **Migration risk:** Ship changes incrementally, starting with one queue before migrating the rest.
