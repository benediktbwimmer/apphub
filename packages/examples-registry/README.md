# Examples Registry

The `@apphub/examples-registry` workspace exposes typed metadata for every curated example job, workflow, and scenario. It replaces the hand-maintained lookup tables that previously lived across the backend, frontend, and test helpers.

## Capabilities

- `EXAMPLE_JOB_BUNDLES` and helpers expose bundle metadata (slug, directory, manifest, definition, version).
- `EXAMPLE_WORKFLOWS` provides typed workflow definitions used by the import flows and tests.
- `EXAMPLE_SCENARIOS` centralizes the scenario catalogue consumed by the frontend importer UI.
- Utility guards such as `isExampleJobSlug`/`isExampleWorkflowSlug` make it easy to validate user input.
- `buildExamplesCatalogIndex()` powers the legacy `examples/catalog-index.json` artifact for any scripts that still rely on it.

## Updating the Index

Run the package build to emit the latest TypeScript output **and** refresh `examples/catalog-index.json`:

```bash
npm run build --workspace @apphub/examples-registry
```

## Adding New Examples

1. Drop new job/workflow assets under `examples/` following the existing structure.
2. Extend the appropriate TypeScript lists in `packages/examples-registry/src/jobs.ts`, `src/workflows.ts`, or `src/scenarios.ts`.
3. Run the build command above so the generated JSON stays in sync.
4. Update any consumer code (frontend importer, integration tests, etc.) to rely on the new exports.

The registry module is safe to consume from other tooling (CLI, documentation generators, etc.) without reaching directly into the monorepo layout.
