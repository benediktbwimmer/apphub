# @apphub/module-sdk

Lightweight runtime contracts for AppHub modules. The SDK exposes helper APIs to

- declare module metadata with `defineModule`
- register jobs and other targets with `createJobHandler`
- obtain typed runtime contexts via `createModuleContext`
- use default capability shims for core services (filestore, metastore, timestore, event bus, core HTTP)

The package is intentionally small so third-party modules can depend on it without pulling in the rest of the monorepo.

## Getting started

```ts
import { defineModule, createJobHandler } from '@apphub/module-sdk';

const generateJob = createJobHandler({
  name: 'observatory-data-generator',
  version: '1.0.0',
  parameters: {
    defaults: { minute: '2023-01-01T00:00' }
  },
  handler: async (ctx) => {
    const { minute } = ctx.parameters;
    await ctx.capabilities.filestore?.ensureDirectory({ path: `datasets/${minute}` });
  }
});

export default defineModule({
  metadata: { name: 'environmental-observatory', version: '0.1.0' },
  settings: {
    defaults: { minute: '2023-01-01T00:00', rows: 12 }
  },
  targets: [generateJob]
});
```

Every target can declare its own semantic version via the optional `version` field on `createJobHandler`, `createService`, and `createWorkflow`. When omitted, `defineModule` automatically assigns the module's
`metadata.version`, so older modules keep working without changes. Versions must be valid [Semantic Versioning](https://semver.org/) strings—invalid values cause `defineModule` to throw during build time so
mistakes are caught before publishing.

At runtime call `createModuleContext` (or `createJobContext` when invoking a job) to materialize the logger, configuration, parameters, and capabilities for a target.

## Capabilities

The SDK provides thin HTTP shims for the services modules commonly need:

- `createFilestoreCapability` exposes `ensureDirectory` and `uploadFile` with minimal JSON payloads.
- `createMetastoreCapability` adds `upsertRecord`.
- `createTimestoreCapability` adds `ingestRecords` and `triggerPartitionBuild`.
- `createEventBusCapability` publishes events to the proxy API.
- `createCoreHttpCapability` performs arbitrary authenticated requests against the core API.

Specify the base URLs and credentials in the module definition or when you construct a runtime context:

```ts
const capabilities = createModuleCapabilities({
  filestore: {
    baseUrl: process.env.FILESTORE_URL!,
    backendMountId: 1,
    token: () => process.env.FILESTORE_TOKEN ?? null
  },
  metastore: {
    baseUrl: process.env.METASTORE_URL!,
    namespace: 'observatory.ingest'
  }
});
```

When module instances control these values through stored settings or secrets, reference them directly from the module definition. The runtime resolves the references before instantiating the capability shims:

```ts
export default defineModule({
  metadata: { name: 'example-module', version: '1.0.0' },
  settings: { defaults: { filestore: { baseUrl: 'http://127.0.0.1:4300', backendId: 1 } } },
  secrets: { defaults: {} },
  capabilities: {
    filestore: {
      baseUrl: { $ref: 'settings.filestore.baseUrl' },
      backendMountId: { $ref: 'settings.filestore.backendId', fallback: 1 },
      token: { $ref: 'secrets.filestoreToken', optional: true }
    }
  },
  targets: [/* ... */]
});
```

Each `$ref` path starts with `settings` or `secrets` and may include an optional `fallback` value or `optional: true` flag. Fallbacks are used when the referenced value is missing, ensuring capability clients always receive concrete connection details.

### Custom overrides

Modules can override any capability on a per-target or per-runtime basis. Pass either a concrete implementation or a factory that receives the original config and a helper to build the default shim.

```ts
const job = createJobHandler({
  name: 'generator',
  capabilityOverrides: {
    filestore: (config, createDefault) => {
      const base = createDefault();
      return {
        ...base!,
        async uploadFile(input) {
          // Custom instrumentation
          console.log('Uploading', input.path);
          return base!.uploadFile(input);
        }
      };
    }
  },
  handler: async (ctx) => { /* ... */ }
});
```

## Versioning

The SDK itself follows semantic versioning within the monorepo. Changes to exported types or capability behaviour require a minor bump, while breaking changes trigger a major increase.

Modules can now version individual targets in addition to the module bundle: keep the module's `metadata.version` for API/config compatibility and bump per-target versions whenever you ship behavioural
changes to a job, workflow, or service. module.ts consumers should pin to the target version they expect when enqueuing work so rollouts remain deterministic.

## Testing

`npm run test --workspace @apphub/module-sdk` runs the compiled node tests. The suite verifies capability behaviour, override handling, and type-level expectations so the package can be published independently of the rest of the workspace.
