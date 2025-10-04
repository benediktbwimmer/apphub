# @apphub/module-sdk

Lightweight runtime contracts for AppHub modules. The SDK exposes helper APIs to

- declare module metadata with `defineModule`
- register jobs, services, and workflows with `createJobHandler`, `createService`, and `createWorkflow`
- obtain typed runtime contexts via `createModuleContext` / `createJobContext`
- configure default capability shims for core services (filestore, metastore, timestore, event bus, core HTTP)
- eliminate boilerplate through capability references, inheritance helpers, and reusable value descriptors

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
      baseUrl: settingsRef('filestore.baseUrl'),
      backendMountId: settingsRef('filestore.backendId', { fallback: 1 }),
      token: secretsRef('filestoreToken')
    },
    events: namedCapabilities({
      default: {
        baseUrl: settingsRef('core.baseUrl'),
        token: secretsRef('coreApiToken', { optional: true })
      },
      audit: {
        baseUrl: settingsRef('core.baseUrl'),
        defaultSource: 'audit.events'
      }
    })
  },
  targets: [/* ... */]
});
```

Each `settingsRef` / `secretsRef` wraps the runtime reference into a type-safe descriptor. `namedCapabilities` groups multiple logical capability clients (for example, a default event bus plus an audit bus). The runtime resolves the references before instantiating the capability shims, ensuring capability clients always receive concrete connection details.

### Custom overrides and named capability maps

Modules can override any capability on a per-target or per-runtime basis. Pass either a concrete implementation or a factory that receives the original config and a helper to build the default shim. When you use `namedCapabilities`, the override factory is executed for each entry so you can customise individual instances without hand-written wiring.

```ts
const job = createJobHandler({
  name: 'generator',
  requires: ['filestore', 'events.audit'],
  capabilityOverrides: {
    filestore: (config, createDefault) => {
      const base = createDefault();
      return {
        ...base!,
        async uploadFile(input) {
          console.log('Uploading', input.path);
          return base!.uploadFile(input);
        }
      };
    },
    events: namedCapabilityOverrides({
      audit: (entryConfig, createDefault) =>
        createDefault() ?? createEventBusCapability(entryConfig ?? { baseUrl: 'https://audit.local', defaultSource: 'audit.events' })
    })
  },
  handler: async (ctx) => {
    const audit = (ctx.capabilities.events as Record<string, EventBusCapability>).audit;
    await audit.publish({ type: 'observatory.audit.created', payload: {} });
  }
});
```

### Capability requirements

Declare the capabilities each target needs via the `requires` field. The SDK enforces them before invoking your handler and the manifest lists them for tooling.

```ts
const plannerJob = createJobHandler({
  name: 'observatory-calibration-planner',
  requires: ['filestore', 'events.audit'],
  handler: async (ctx) => {
    requireCapabilities(ctx.capabilities, ['filestore', 'events.audit']);
    // guaranteed typed access
    const audit = (ctx.capabilities.events as Record<string, EventBusCapability>).audit;
    await audit.publish({ type: 'observatory.plan.created', payload: {} });
  }
});
```

`requireCapabilities` also understands dotted selectors when you check dynamic capability maps at runtime.

### Inherit module settings and secrets

Targets often reuse the module-level descriptors. Instead of repeating `settings: { defaults: ... }` on every job/service, mark the target with `inheritModuleSettings()` / `inheritModuleSecrets()`. The manifest records the inheritance so tooling knows no overrides were provided.

```ts
const generateJob = createJobHandler({
  name: 'observatory-generator',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  handler: async (ctx) => {
    await ctx.capabilities.filestore?.ensureDirectory({ path: 'datasets' });
  }
});
```

### Reusable descriptors and workflow templates

Most modules use Zod or simple JSON parsing to hydrate settings/parameters. The SDK ships helpers so targets can reuse the same patterns across the repo:

```ts
import { z } from 'zod';
import { zodDescriptor, jsonDescriptor } from '@apphub/module-sdk/descriptors';

const generatorParams = zodDescriptor(
  z.object({ minute: z.string().min(1) }),
  { defaults: { minute: '2024-01-01T00:00' } }
);

const serviceSettings = jsonDescriptor({ defaults: { retryMs: 1000 } });

const generateJob = createJobHandler({
  name: 'observatory-generator',
  parameters: generatorParams,
  handler: async (ctx) => {
    ctx.parameters.minute.toUpperCase();
  }
});

const dashboardService = createService({
  name: 'observatory-dashboard',
  settings: serviceSettings,
  handler: async (ctx) => ({ start() {/* ... */} })
});
```

For workflow definitions and schedules, `moduleSetting('core.baseUrl')`, `moduleSecret('api.token')`, and `capability('events.audit')` emit the templated strings the control plane expects:

```ts
import { moduleSetting, moduleSecret } from '@apphub/module-sdk/templates';

const workflow = createWorkflow({
  name: 'observatory-daily-publication',
  definition: {
    slug: 'observatory-daily-publication',
    steps: [
      {
        id: 'render-report',
        jobSlug: 'observatory-report-publisher',
        type: 'job',
        parameters: {
          coreBaseUrl: moduleSetting('core.baseUrl'),
          coreApiToken: moduleSecret('coreApiToken')
        }
      }
    ]
  }
});
```

## Versioning

The SDK itself follows semantic versioning within the monorepo. Changes to exported types or capability behaviour require a minor bump, while breaking changes trigger a major increase.

Modules can now version individual targets in addition to the module bundle: keep the module's `metadata.version` for API/config compatibility and bump per-target versions whenever you ship behavioural
changes to a job, workflow, or service. module.ts consumers should pin to the target version they expect when enqueuing work so rollouts remain deterministic.

## Tooling support

The CLI ships a companion command group that understands the same descriptors and capability helpers shipped by the SDK:

- `apphub module config generate` – materialise a config file from a built module (including capability wiring, named instances, and inherited descriptors).
- `apphub module doctor --config <path>` – validate module settings, secrets, and required capabilities against the compiled definition.

Both commands rely on the SDK exports, so adopting `settingsRef`, `inheritModuleSettings`, or named capabilities automatically flows through to the CLI experience.

## Testing

`npm run test --workspace @apphub/module-sdk` runs the compiled node tests. The suite verifies capability behaviour, override handling, inheritance, descriptors/templates, and type-level expectations so the package can be published independently of the rest of the workspace.
