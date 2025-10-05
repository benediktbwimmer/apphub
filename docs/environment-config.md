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
| `TIMESTORE_STAGING_DIRECTORY` | `<repo>/services/data/timestore/staging` | Root path for DuckDB staging files; created on boot if missing. |
| `TIMESTORE_STAGING_MAX_DATASET_BYTES` | `536_870_912` (512 MiB) | Per-dataset guardrail; `0` disables the warning. Pair with `timestore_staging_disk_usage_bytes`. |
| `TIMESTORE_STAGING_MAX_TOTAL_BYTES` | `0` | Global staging footprint ceiling. `0` leaves the global check disabled. |
| `TIMESTORE_STAGING_MAX_PENDING` | `64` | In-memory queue depth per dataset before new batches are rejected. |
| `TIMESTORE_STAGING_FLUSH_MAX_ROWS` | `50_000` | Flush trigger when staged rows exceed the threshold. `0` disables the row-based trigger. |
| `TIMESTORE_STAGING_FLUSH_MAX_BYTES` | `134_217_728` (128 MiB) | Flush trigger based on DuckDB on-disk size. `0` disables the byte trigger. |
| `TIMESTORE_STAGING_FLUSH_MAX_AGE_MS` | `60_000` (60s) | Flush trigger when the oldest batch waits longer than the threshold. `0` flushes eagerly whenever staging is non-empty. |

Datasets can override the flush thresholds via metadata (`dataset.metadata.staging.flush`). Operators should document the overrides alongside alert thresholds so dashboards reflect the effective limits.

## Adding New Configuration

1. Declare expected variables in your service with `z.object({ ... }).passthrough()`.
2. Use `booleanVar`, `integerVar`, `numberVar`, `stringVar`, or the set/list helpers to capture defaults and bounds.
3. Call `loadEnvConfig(schema, { context: 'service-name' })` to parse the active environment.
4. Prefer derived transforms (`schema.transform`) to shape the final config object and keep defaults colocalised.

This pattern keeps configuration logic in one place, eliminates bespoke parsers, and ensures operators receive consistent error messages across services.
