# Module capability config should honor runtime settings

## Context
- `modules/environmental-observatory/module.ts` now wires `defineModule` with fixed capability configs using the default settings bundle so jobs have filestore/metastore/timestore access.
- The module runtime ultimately calls `createJobContext` with `settings` resolved from the database, but we never recalculate the capability configs based on those stored values.
- As a result, the SDK instantiates capability clients with the baked-in defaults (localhost, backend id 1, etc.) regardless of the module instance’s actual configuration.

## Impact
- Any operator who changes module settings via the API/DB still sees handlers talk to the hard-coded endpoints, causing mismatches or outright failures in non-local environments.
- Secrets injected for tokens/principals are ignored by the capability factories, so auth flows will break once we move beyond the default dev stack.
- Future modules cannot rely on capability wiring, forcing ad-hoc overrides or manual HTTP clients.

## Proposed direction
1. When we build the module job context (`services/core/src/jobs/runtime.ts`), derive a `ModuleCapabilityConfig` from the resolved module settings/secrets (e.g. `context.settings.filestore.baseUrl`, `context.secrets.filestoreToken`) instead of the static defaults from `module.ts`.
2. Allow targets to override capability slices if they need per-job adjustments, but default to the dynamically constructed config.
3. Ensure the module publish path stores any necessary metadata so the runtime knows which settings map onto which capability inputs.
4. Update tests to cover capability instantiation with custom settings, and document how module authors should structure their settings to drive capability wiring.

## Acceptance criteria
- Running a module job after changing `environmental-observatory` settings (e.g. filestore base URL) results in the capability clients using the new value without modifying code.
- Module settings/secrets are the single source of truth for capability endpoints and tokens; no localhost defaults leak into runtime unless explicitly configured.
- Unit/integration tests verify capability configs follow updated settings for at least filestore, metastore, timestore, and events.
- Documentation or inline comments explain the mapping between module settings and capability configuration for module authors.
