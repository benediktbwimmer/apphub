# Build and bootstrap tooling for modules

## Context
- `examples/environmental-observatory-event-driven/config.json` enumerates manifests, placeholders, and bootstrap steps by hand, and other tooling expects that file format.
- Moving to module definitions means manifests, bundles, and workflows should be generated from code rather than manually curated JSON.
- Bootstrap scripts must load module metadata to materialize runtime configuration, secrets templates, and scratch directories.

## Impact
- Manual manifest curation is error-prone and discourages modular development because every change requires editing several JSON files.
- CI/CD cannot yet consume module definitions to package bundles or seed environments, blocking adoption of the new layout.
- Without updated tooling, developers will have to juggle both legacy and module workflows, increasing confusion.

## Proposed direction
1. Introduce a repository-level CLI command (e.g. `npm run module:build -- <module>` or `scripts/module-build.ts`) that reads `module.ts`, generates bundle/workflow manifests, and writes them to `modules/<slug>/dist/`.
2. Update the bootstrap automation to consume the module definition: resolve placeholders, produce runtime config JSON, and seed scratch directories based on the declarative resource list.
3. Ensure the build command can emit artifacts compatible with existing orchestrator expectations (bundle manifests, workflow specs) so modules remain loadable at runtime.
4. Wire the new command into CI to validate modules on every push, and add lint/test hooks to keep emitted artifacts in sync.
5. Remove legacy `config.json` usage from the observatory example once the module build pipeline produces equivalent outputs.

## Acceptance criteria
- Running the new build command for the observatory module produces bundle/workflow manifests without manual edits.
- Bootstrap scripts read module metadata to generate runtime configuration and scratch directories.
- CI executes the module build step and fails if generated artifacts are out of date.
- Legacy `config.json` in the observatory example is deleted, with references updated to the module tooling.
- Documentation explains how to build and bootstrap modules using the new commands.
