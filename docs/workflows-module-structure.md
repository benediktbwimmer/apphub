# Workflow Module Structure

The workflow subsystem in `services/core` is intentionally split into a few focused layers so that API handlers, background workers, and future services can compose behaviour without wading through monolithic files.

## Repository layer

Workflow persistence is organised under `services/core/src/workflows/repositories/`:

- `definitionsRepository.ts` owns workflow definitions, schedules, and event triggers. It handles cron arithmetic, template validation, and emits definition-level events.
- `assetsRepository.ts` is responsible for workflow asset declarations, snapshot history, and partition metadata.
- `runsRepository.ts` encapsulates run creation and mutation, run step lifecycle, retry summaries, and queue-facing helpers.
- `analyticsRepository.ts` exposes aggregate views (run stats, metrics, and activity feeds) that can be shared between the HTTP layer and workers.
- `shared.ts` provides small JSON helpers reused across repositories.

These repositories all expose plain async functions and are re-exported through `services/core/src/db/workflows.ts`, so existing imports from `../db/workflows` continue to work.

## HTTP helpers

Request-layer helpers live beside route code:

- `workflows/http/normalizers.ts` contains request normalisation helpers for steps, triggers, and asset declarations so Fastify handlers stay lean.
- `workflows/http/analyticsQuery.ts` centralises analytics query parsing and validation (range presets, bucket choices, and error messaging).

By keeping HTTP concerns separate from persistence, we avoid leaking Fastify-only concepts into the repositories.

## Updating code

1. Prefer adding new database accessors in the appropriate repository file. Each repository groups related SQL, keeps transactions local, and can be tested in isolation.
2. HTTP handlers should delegate query parsing and coercion to the normaliser helpers instead of re-implementing them inline.
3. Workers and services that previously imported from `services/core/src/db/workflows` can continue to do so—every exported function is forwarded to the new repositories.

## Tests

New repository functions should ship with unit or integration coverage alongside existing suites under `services/core/tests/`. When introducing standalone helpers, consider colocated unit tests under `services/core/src/workflows/__tests__/` to keep feedback tight.
