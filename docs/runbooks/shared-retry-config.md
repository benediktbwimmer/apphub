# Shared Retry Configuration Helpers

Centralised helpers in `@apphub/shared/retries/config` remove copy-pasted number coercion logic across core workers. New queues and workers should adopt them to keep retry policies aligned.

## Getting Started

Import the helpers from the shared package:

```ts
import { resolveRetryBackoffConfig } from '@apphub/shared/retries/config';
```

Define defaults that match the intended behaviour, then call the resolver with a prefix for environment overrides:

```ts
const RETRY_BACKOFF = resolveRetryBackoffConfig(
  {
    baseMs: 5_000,
    factor: 2,
    maxMs: 10 * 60_000,
    jitterRatio: 0.2
  },
  { prefix: 'MY_WORKER_RETRY' }
);
```

The resolver looks for `MY_WORKER_RETRY_BASE_MS`, `..._FACTOR`, `..._MAX_MS`, and `..._JITTER_RATIO`, normalising any malformed, negative, or missing values back to the defaults.

## Positive Numbers & Ratios

Need to coerce standalone numbers (for sampling windows, concurrency limits, etc.)? The same module exports `normalizePositiveNumber` and `normalizeRatio`:

```ts
const samplingMinutes = normalizePositiveNumber(
  process.env.EVENT_SAMPLING_STALE_MINUTES,
  360,
  { integer: true }
);

const jitterRatio = normalizeRatio(process.env.WORKER_JITTER_RATIO, 0.2);
```

Both helpers guard against `NaN`, clamp values to sensible bounds, and support optional minimum thresholds.

## Migration Checklist

1. Remove ad-hoc `normalizePositiveNumber`/`normalizeRatio` helpers from the worker.
2. Replace inline retry configs with `resolveRetryBackoffConfig` using a consistent env prefix.
3. Update docs for the worker to reference the new env var names if they changed.
4. Add or update unit tests to cover overrides, invalid inputs, and bound clamping.
5. Run `npm run test --workspace @apphub/shared` to ensure shared guardrails still pass.

Following this pattern keeps retry policy tweaks consistent across services and surfaces common edge cases in one place.
