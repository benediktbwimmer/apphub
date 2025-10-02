# Module Service Runtime

Publishing a module can now start HTTP services automatically. When you define a service with `createService` you can attach a `registration` block:

```ts
export const dashboardService = createService({
  name: 'observatory-dashboard-service',
  registration: {
    slug: 'observatory-dashboard',
    healthEndpoint: '/healthz',
    defaultPort: 4311,
    basePath: '/',
    env: {
      HOST: '0.0.0.0',
      PORT: '{{port}}'
    },
    ui: {
      previewPath: '/',
      spa: true
    }
  },
  handler: async (context) => {
    const app = fastify();
    // ...
    return {
      async start() {
        await app.listen({ host: process.env.HOST, port: Number(process.env.PORT) });
      },
      async stop() {
        await app.close();
      }
    };
  }
});
```

Running `npm run module:publish -- --register-jobs` will:

- Allocate a base URL/port for each registered service
- Upsert the service in the core registry so it appears in the Service gallery
- Persist a module service manifest (`service_manifests` table) that records artifact, target fingerprint, runtime env, and UI hints

## Runtime worker

The new supervisor (`npm run module:services`) watches module service manifests and keeps instances healthy. It will:

1. Load the module bundle via the module runtime loader
2. Create a module context and invoke the service handler
3. Call `start()`/`stop()` when manifests change or are removed
4. Update service health metadata via the registry

Run the supervisor alongside other dev workers:

```bash
npm run module:services --workspace @apphub/core
```

The top-level `npm run dev` orchestration now spawns the module service supervisor automatically, so local stacks pick up module-defined UIs/APIs without extra steps.

Environment variables:

| Variable | Description |
| --- | --- |
| `MODULE_SERVICE_HOST` | Hostname used for assigned base URLs (default `127.0.0.1`) |
| `MODULE_SERVICE_PORT_RANGE` | Preferred port or range (`4310-4399` by default) |
| `MODULE_SERVICE_REFRESH_MS` | Poll interval for manifest sync (default `5000`) |

When using React/Vite frontends inside a module, serve the static bundle in your service handler and set `registration.ui.previewPath` so the Service gallery links directly to the SPA.
