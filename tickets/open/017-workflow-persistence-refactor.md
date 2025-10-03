# Refactor workflow persistence and route layers

## Context
- Workflow persistence (`services/core/src/db/workflows.ts:1`) and routes (`services/core/src/routes/workflows.ts:1`) exceed several thousand lines, blending queries, serialization, and validation.
- New features (analytics, diffing, assets) continue to accumulate, making the modules harder to navigate.
- Tests cover behaviour but the module structure hinders incremental changes and knowledge transfer.

## Impact
- Developers face steep learning curves when modifying workflow logic, slowing feature delivery and code reviews.
- Coupled modules increase merge conflicts and discourage reuse of query helpers in other services.
- Risk of regressions grows because changes touch sprawling files with intertwined responsibilities.

## Proposed direction
1. Split workflow persistence into focused repositories (definitions, runs, analytics, assets) with clear interfaces.
2. Extract serialization/helpers into dedicated modules under `services/core/src/workflows/` to reduce route bloat.
3. Introduce service-layer abstractions used by routes and workers, easing future extraction to separate services.
4. Apply incremental refactors guarded by existing test suites, adding targeted unit tests for new helpers.
5. Update documentation to map new module boundaries and developer onboarding paths.

## Acceptance criteria
- Workflow DB logic and HTTP handlers are decomposed into smaller, well-named modules with single responsibilities.
- Routes import reusable helpers instead of embedding raw SQL/serialization logic inline.
- Existing tests remain green, and new unit tests cover extracted modules.
- Contributor docs highlight the new structure, improving discoverability for future work.
