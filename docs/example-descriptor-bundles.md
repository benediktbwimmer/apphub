# Descriptor-Driven Example Bundles

Ticket 082 extended the example system so packaging no longer depends on a static registry. This note covers the new workflows for bundling examples from their descriptors, both locally and from git sources, and how the core API now surfaces descriptor metadata.

## Descriptor Basics

Example descriptors live in `config.json` files that conform to `docs/schemas/example-config.schema.json`. They may declare bundle manifests via the `manifests` array. Any entry with `kind: "bundle"` (or no `kind` field) is treated as an `apphub.bundle.json` root that points at a job bundle.

Curated descriptors inside this repo already list each job bundle (see `modules/environmental-observatory/dist/config.json`). When the core loads descriptors it stores `{ module, configPath }` alongside each job bundle record so that tooling can reference the descriptor again at runtime.

## Bundling With `@apphub/example-bundler`

Two primary APIs now exist:

```ts
import { ExampleBundler } from '@apphub/example-bundler';

const bundler = new ExampleBundler({ repoRoot: process.cwd() });

// Legacy slug pathway remains available for curated examples
await bundler.packageExampleBySlug('observatory-data-generator');

// Descriptor pathway (local checkout)
await bundler.packageExampleByDescriptor({
  slug: 'observatory-data-generator',
  descriptor: {
    module: 'github.com/apphub/examples/environmental-observatory-event-driven',
    path: 'modules/environmental-observatory/dist'
  }
});

// Descriptor pathway (remote git clone)
await bundler.packageExampleByDescriptor({
  slug: 'observatory-data-generator',
  descriptor: {
    module: 'github.com/apphub/examples/environmental-observatory-event-driven',
    repo: 'https://github.com/apphub/examples.git',
    ref: 'main',
    configPath: 'modules/environmental-observatory/dist/config.json'
  }
});
```

`ExampleDescriptorReference` requires **exactly one** of `path` (local workspace) or `repo` (git remote). Optional fields:

- `module`: required identifier for the descriptor (mirrors the core module id)
- `ref`: git branch or tag (defaults to the repository default branch)
- `commit`: pin to a specific SHA (preferred for reproducibility)
- `configPath`: descriptor location relative to the repo/path root (defaults to `config.json`)

The bundler computes cache fingerprints from both the descriptor JSON and the bundle directory contents, so repeated packaging runs for the same descriptor take advantage of existing artifacts.

## Core Integration

`enqueueExampleBundleJob` and the `/job-imports/example` route now accept descriptor references:

```json
{
  "slug": "observatory-data-generator",
  "descriptor": {
    "module": "github.com/apphub/examples/environmental-observatory-event-driven",
    "repo": "https://github.com/apphub/examples.git",
    "ref": "main",
    "configPath": "modules/environmental-observatory/dist/config.json"
  }
}
```

- If a descriptor is provided it takes precedence; the bundler packages that descriptor directly.
- If no descriptor is provided, the service falls back to slug-based resolution (which still works for curated examples scanned into the core).
- `/examples/load` automatically passes stored descriptor metadata so bulk jobs continue to work after the migration.

## Core Metadata Changes

`ExampleJobBundle` now exposes an optional `descriptor` field:

```ts
interface ExampleJobBundle {
  slug: string;
  directory: string;
  manifestPath: string;
  jobDefinitionPath: string;
  descriptor?: {
    module: string;
    configPath: string; // repo-relative path when available
  };
}
```

When `loadExampleCore` runs it scans `examples/**/config.json`, matches each declared bundle manifest to the curated bundle list, and populates the `descriptor` field. Consumers can use this metadata to call the bundler or API with a full descriptor reference instead of relying on slug lookups.

## Testing

Descriptor scenarios are covered by `npm run test --workspace @apphub/example-bundler`, which exercises both local descriptors and git clones. Core API smoke tests (`npx tsx services/core/tests/examplesCoreRoute.test.ts`) run in inline queue mode and now close cleanly.

## Migration Notes

- Slug-based APIs remain functional, making the migration backward compatible.
- Add bundle manifest entries to any new descriptors so the bundler can discover jobs.
- External tooling should begin passing descriptor references (path or repo) when bundling examples that do not ship in the core repository.
- Once downstream systems no longer rely on the deprecated `@apphub/examples-registry`, that workspace can be removed completely.
