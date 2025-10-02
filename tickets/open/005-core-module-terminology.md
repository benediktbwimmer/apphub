# Rename example terminology to module naming in core

## Context
- Core services, CLIs, and docs still refer to "examples" even though modules are the new packaging abstraction.
- Packages such as `packages/example-bundler` and commands like `migrate:example-bundles` conflict with the module-first roadmap.
- Aligning naming early prevents confusion while we migrate observatory and future modules away from the legacy layout.

## Impact
- Developers will juggle mixed terminology when onboarding or reading build output.
- Tooling and code references will diverge once modules ship, increasing the maintenance burden.
- Platform partners may implement against outdated names and need breaking changes later.

## Proposed direction
1. Rename workspace packages and internal references from `example-*` to `module-*` (e.g. `example-bundler` → `module-bundler`).
2. Update npm scripts, CLI commands, and documentation to use the new names.
3. Introduce transitional aliases (e.g. command shims) only if needed to avoid breaking current workflows; remove after deprecation period.
4. Audit code comments, log messages, and env vars for lingering "example" references tied to runtime loading; replace with "module" terminology where appropriate.

## Acceptance criteria
- Workspace package names, imports, and npm scripts use module terminology.
- CI/build output and docs no longer reference the old example naming for bundlers and tooling.
- Any temporary aliases are documented along with a plan to remove them.
