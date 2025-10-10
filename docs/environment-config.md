# Environment Configuration

The AppHub services now share a single configuration loader built on top of `zod` and exposed from `@apphub/shared/envConfig`. The helper normalises boolean and numeric inputs, supports defaults, and emits consistent error messages when required variables are missing or malformed.

## Helper Usage

```ts
import { booleanVar, integerVar, loadEnvConfig, stringVar } from '@apphub/shared/envConfig';
import { z } from 'zod';

const exampleEnvSchema = z
  .object({
    FEATURE_FLAG: booleanVar({ defaultValue: false }),
    WORKER_CONCURRENCY: integerVar({ defaultValue: 4, min: 1 }),
    API_BASE_URL: stringVar({ defaultValue: 'http://127.0.0.1:4000' })
  })
  .passthrough();

type ExampleEnv = z.infer<typeof exampleEnvSchema>;

export function loadExampleConfig(): ExampleEnv {
  return loadEnvConfig(exampleEnvSchema, { context: 'example-service' });
}
```

All parsers trim whitespace, de-duplicate list entries, and lower-case values when appropriate. Invalid values raise an `EnvConfigError` with a consolidated bullet list that includes the failing variable name.

## Core Service (auth)

| Variable | Default | Notes |
| --- | --- | --- |
| `APPHUB_AUTH_DISABLED` | `false` | Enables auth when omitted; accepts `yes/no`, `on/off`, `1/0`. |
| `APPHUB_SESSION_TTL_SECONDS` | `43200` | Validates positive integers and surfaces parse errors. |
| `APPHUB_SESSION_COOKIE_SECURE` | `NODE_ENV !== 'development'` | Explicit `true/false` overrides the environment-sensitive default. |
| `APPHUB_LEGACY_OPERATOR_TOKENS` | `true` | Consistent boolean parsing shared with other services. |
| `APPHUB_OIDC_ALLOWED_DOMAINS` | `[]` | Normalised, lower-case set with duplicates removed. |

The `getAuthConfig` loader and associated tests (`services/core/tests/authConfig.test.ts`) cover boolean coercion, numeric fallbacks, and invalid inputs.

## Metastore Service

| Variable | Default | Notes |
| --- | --- | --- |
| `FILESTORE_REDIS_URL` / `REDIS_URL` | `redis://127.0.0.1:6379` (non-prod) | Normalised to a `redis://` URL; missing values in production raise a descriptive error. |
| `APPHUB_ALLOW_INLINE_MODE` | `false` | Required for `FILESTORE_REDIS_URL=inline`; errors mention the toggle when absent. |
| `APPHUB_METASTORE_PGPOOL_MAX` | `5` | Uses shared integer parser with lower bound enforcement. |
| `APPHUB_METASTORE_SCHEMA_CACHE_*` | `300/60/60/30` seconds | Converted to milliseconds and validated as non-negative. |
| `APPHUB_METASTORE_TOKENS` | `[]` | Parsed from JSON once and reused across refreshes. |

Metastore-specific tests (`services/metastore/tests/unit/serviceConfig.test.ts`) exercise inline mode toggles, Redis validation, and token parsing via the shared helper.

## Timestore Service

| Variable | Default | Notes |
| --- | --- | --- |
| `TIMESTORE_CLICKHOUSE_HOST` | `clickhouse` | Hostname for the ClickHouse HTTP endpoint. Override when running against an external cluster. |
| `TIMESTORE_CLICKHOUSE_HTTP_PORT` | `8123` | HTTP port exposed by ClickHouse. |
| `TIMESTORE_CLICKHOUSE_MOCK` | `false` (prod), `true` in tests | When set to `true`, timestore serves requests from an in-memory store instead of ClickHouse. Useful for integration tests. |
| `TIMESTORE_QUERY_CACHE_DIR` | `<repo>/services/data/timestore/cache` | Filesystem path for the optional query result cache. |
| `TIMESTORE_MANIFEST_CACHE_REDIS_URL` | `REDIS_URL` | Redis connection string for caching manifest lookups. Set to `inline` only during tests with `APPHUB_ALLOW_INLINE_MODE=true`. |
| `TIMESTORE_STREAMING_BUFFER_ENABLED` | `true` | Controls whether the hot buffer merges streaming rows into query responses. |

## Adding New Configuration

1. Declare expected variables in your service with `z.object({ ... }).passthrough()`.
2. Use `booleanVar`, `integerVar`, `numberVar`, `stringVar`, or the set/list helpers to capture defaults and bounds.
3. Call `loadEnvConfig(schema, { context: 'service-name' })` to parse the active environment.
4. Prefer derived transforms (`schema.transform`) to shape the final config object and keep defaults colocalised.

This pattern keeps configuration logic in one place, eliminates bespoke parsers, and ensures operators receive consistent error messages across services.
