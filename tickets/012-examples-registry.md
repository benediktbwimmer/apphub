# Ticket 012: Centralize Example Metadata in a Typed Registry Package

## Problem Statement
Example jobs, services, and workflows are defined through duplicated maps scattered across the codebase (`services/catalog/src/routes/jobImports.ts`, `shared/exampleJobBundles.ts`, `apps/frontend/src/import/examples/exampleScenarios.ts`, and test helpers). Each copy diverges over time, forcing manual edits whenever paths or slugs change. The frontend reaches into `examples/` via brittle relative imports, while the backend reads JSON directly from disk. There is no single source of truth for example metadata, making it hard to evolve the example catalog or power new tooling.

## Goals
- Create a `packages/examples-registry` workspace package that exports typed definitions for all example bundles, workflows, services, and scenario bundles.
- Generate the existing `examples/catalog-index.json` from this package (or replace it entirely) so backend code consumes the registry programmatically.
- Provide utilities for locating example assets (manifest paths, Dockerfiles, datasets) and derived metadata (e.g., dependencies between examples).
- Update backend routes, frontend imports, and tests to rely on the shared registry module instead of hard-coded maps or fragile relative imports.
- Ensure the registry can be published or consumed by external tooling (CLI, docs generators) without coupling to repo internals.

## Non-Goals
- No content changes to the examples themselves beyond wiring them into the registry.
- No UX redesign of the import workspace; that is covered in a separate ticket.

## Implementation Sketch
1. **Registry Package Skeleton**
   - Create `packages/examples-registry` with a `package.json`, TypeScript entrypoint, and build step (if needed) that emits ESM/CJS bundles for consumers.
   - Define core types (`ExampleJob`, `ExampleWorkflow`, `ExampleScenario`, etc.) and re-export shared schemas (e.g. zod definitions) where appropriate.

2. **Data Source Normalization**
   - Store example metadata in structured TypeScript (or JSON files imported by the package) and eliminate duplicate definitions elsewhere.
   - Add a small build script to output `examples/catalog-index.json` for backwards compatibility until dependent code is migrated.

3. **Consumer Migration**
   - Update `services/catalog` to import example definitions from the registry, leveraging helper functions for packaging.
   - Replace frontend relative imports with explicit `@apphub/examples-registry` imports, ensuring Vite resolves the alias.
   - Modify tests under `examples/tests` to reference the registry for fixtures.

4. **Developer Ergonomics**
   - Provide helper utilities (e.g. `getExampleBySlug`, `listScenarioBundles`) and ensure they are tree-shakeable.
   - Document how to add new examples or update metadata via this package and incorporate lint/test guardrails.

5. **Validation**
   - Confirm backend routes still serve example previews/imports.
   - Run frontend import flows to verify dynamic loading works with the new module.
   - Ensure `npm run test:e2e` continues to exercise example ingestion successfully.

## Deliverables
- New `@apphub/examples-registry` workspace package with comprehensive typings and exports.
- Updated backend, frontend, and test code consuming the registry instead of duplicating metadata.
- Build script (temporary or permanent) that keeps `examples/catalog-index.json` in sync.
- Documentation outlining contribution guidelines for examples and registry usage.
