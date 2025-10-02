# Adapt core loader to consume module bundles

## Context
- Core APIs and workers currently load example bundles via bespoke manifest code that expects the legacy directory structure.
- Once modules emit bundle manifests through the new tooling, the core runtime must discover and load them dynamically.
- We need to ensure backwards-compatible behaviour while enabling module-first deployments.

## Impact
- Without loader changes, the core stack can't execute jobs/services packaged as modules, blocking adoption of the new architecture.
- Manual wiring for each scenario will persist, increasing the risk of configuration drift and deployment mistakes.

## Proposed direction
1. Introduce a module registry in core that reads module bundle metadata (paths, capabilities, version info) produced by the build pipeline.
2. Update worker/service bootstrapping to register jobs and workflows from modules instead of referencing `examples/` manifests directly.
3. Provide configuration surface (env or config file) for specifying which modules to load at runtime, supporting multiple modules simultaneously.
4. Maintain compatibility with any remaining legacy examples during the transition, logging warnings to encourage migration.

## Acceptance criteria
- Core services load module bundles from the new build artifacts and expose jobs/services/workflows accordingly.
- Multiple modules can be configured and loaded without code changes.
- Legacy example loading can either be toggled off or emits a deprecation warning.
- Integration tests cover module registration and execution paths via the new loader.
