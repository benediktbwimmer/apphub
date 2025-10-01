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
  handler: async (ctx) => {
    const { minute } = ctx.settings;
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

At runtime call `createModuleContext` to materialize the logger, configuration, and capabilities for a target.

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

The SDK follows semantic versioning within the monorepo. Changes to exported types or capability behaviour require a minor bump, while breaking changes trigger a major increase. Modules should pin to the version they were built with and update deliberately when new capabilities ship.

## Testing

`npm run test --workspace @apphub/module-sdk` runs the compiled node tests. The suite verifies capability behaviour, override handling, and type-level expectations so the package can be published independently of the rest of the workspace.
