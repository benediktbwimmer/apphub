# Consolidate environment configuration parsing

## Context
- Core (`services/core/src/config/auth.ts:1`) and metastore (`services/metastore/src/config/serviceConfig.ts:1`) implement bespoke boolean/number parsing helpers.
- Other services replicate similar logic, leading to subtle differences in defaults and error handling.
- Misconfiguration often surfaces only at runtime because there is no shared validation layer.

## Impact
- Environment typos or missing secrets yield hard-to-debug startup failures across services.
- Consistency issues (e.g. differing interpretations of `APPHUB_ALLOW_INLINE_MODE`) complicate ops runbooks.
- Adding new settings forces copy/paste changes across multiple config modules, increasing drift risk.

## Proposed direction
1. Create a config validation helper in `packages/shared` using zod or envsafe to declare schema + defaults once.
2. Refactor service config loaders to consume the shared helper, removing custom parsing utilities.
3. Standardize error messaging and logging when required variables are absent or malformed.
4. Update documentation to surface the new config schema definitions and supported env vars per service.
5. Add unit tests verifying parsing of true/false, numbers, lists, and inline mode toggles across services.

## Acceptance criteria
- Services load configuration through shared helpers with consistent parsing and validation behaviour.
- Startup failures for invalid env values emit clear, consistent error messages.
- Documentation reflects canonical env variable definitions sourced from the shared schema.
