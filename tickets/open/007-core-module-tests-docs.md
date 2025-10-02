# Align core tests and docs with module architecture

## Context
- Documentation and integration tests still point to the example-based workflow, including observatory references under `examples/`.
- After modules land, guides and tests must validate the new runtime paths to avoid confusion and regressions.

## Impact
- Developers may follow stale docs and hit missing files or commands.
- CI could pass despite broken module paths if tests still target the deprecated entry points.
- External adopters lack authoritative guidance on module deployment once the examples are removed.

## Proposed direction
1. Update core and repo-wide docs (READMEs, architecture notes) to reference modules, the new tooling, and updated commands.
2. Refactor integration and benchmark tests to import module bundles through the loader introduced in ticket 006.
3. Adjust configuration fixtures and env templates to reflect module naming (e.g. `MODULES_DIR` instead of `EXAMPLES_DIR`).
4. Validate the observatory scenario end-to-end using the module build outputs and document manual runbooks for troubleshooting.

## Acceptance criteria
- Documentation across the repo reflects module-first architecture with no stale example references for active workflows.
- Integration tests run against module outputs and continue to pass in CI.
- Sample configs/env templates align with module terminology and loader expectations.
- Manual run instructions are updated and verified for the observatory module.
