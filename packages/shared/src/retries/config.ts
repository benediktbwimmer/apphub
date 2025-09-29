import type { BackoffOptions } from './backoff';

const DEFAULT_JITTER_RATIO = 0.2;

export type NormalizePositiveNumberOptions = {
  minimum?: number;
  integer?: boolean;
};

type NormalizePositiveNumberArgs =
  | number
  | NormalizePositiveNumberOptions
  | undefined;

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return Number.NaN;
    }
    return Number(trimmed);
  }
  return Number.NaN;
}

export function normalizePositiveNumber(
  value: unknown,
  fallback: number,
  minimumOrOptions?: NormalizePositiveNumberArgs
): number {
  const options: NormalizePositiveNumberOptions =
    typeof minimumOrOptions === 'number'
      ? { minimum: minimumOrOptions }
      : minimumOrOptions ?? {};

  const minimum = options.minimum ?? 1;
  const integer = options.integer ?? false;

  const fallbackValue = integer ? Math.floor(fallback) : fallback;
  const parsed = toNumber(value);

  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallbackValue;
  }

  return integer ? Math.floor(parsed) : parsed;
}

export type NormalizeRatioOptions = {
  min?: number;
  max?: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function normalizeRatio(
  value: unknown,
  fallback: number,
  options: NormalizeRatioOptions = {}
): number {
  const min = options.min ?? 0;
  const max = options.max ?? 1;

  const normalizedFallback = clamp(fallback, min, max);
  const parsed = toNumber(value);

  if (!Number.isFinite(parsed)) {
    return normalizedFallback;
  }

  return clamp(parsed, min, max);
}

export type RetryBackoffDefaults = {
  baseMs: number;
  factor: number;
  maxMs: number;
  jitterRatio?: number;
};

export type RetryBackoffConfig = Readonly<{
  baseMs: number;
  factor: number;
  maxMs: number;
  jitterRatio: number;
}>;

export type RetryBackoffEnvKeys = Partial<{
  baseMs: string;
  factor: string;
  maxMs: string;
  jitterRatio: string;
}>;

export type ResolveRetryBackoffConfigOptions = {
  prefix?: string;
  keys?: RetryBackoffEnvKeys;
  env?: Record<string, string | undefined>;
};

type BackoffKey = 'baseMs' | 'factor' | 'maxMs' | 'jitterRatio';

const KEY_SUFFIX: Record<BackoffKey, string> = {
  baseMs: 'BASE_MS',
  factor: 'FACTOR',
  maxMs: 'MAX_MS',
  jitterRatio: 'JITTER_RATIO',
};

function resolveEnvValue(
  key: BackoffKey,
  options: ResolveRetryBackoffConfigOptions
): string | undefined {
  const keyOverride = options.keys?.[key];
  if (keyOverride) {
    return options.env?.[keyOverride];
  }
  const prefix = options.prefix;
  if (!prefix) {
    return undefined;
  }
  const envKey = `${prefix}_${KEY_SUFFIX[key]}`;
  return options.env?.[envKey];
}

export function resolveRetryBackoffConfig(
  defaults: RetryBackoffDefaults,
  options: ResolveRetryBackoffConfigOptions = {}
): RetryBackoffConfig {
  const envBag = options.env ?? (process.env as Record<string, string | undefined>);
  const envOptions = { ...options, env: envBag } satisfies ResolveRetryBackoffConfigOptions;

  const baseMs = normalizePositiveNumber(
    resolveEnvValue('baseMs', envOptions),
    defaults.baseMs
  );
  const factor = normalizePositiveNumber(
    resolveEnvValue('factor', envOptions),
    defaults.factor
  );
  const maxMs = normalizePositiveNumber(
    resolveEnvValue('maxMs', envOptions),
    defaults.maxMs
  );
  const jitterRatio = normalizeRatio(
    resolveEnvValue('jitterRatio', envOptions),
    defaults.jitterRatio ?? DEFAULT_JITTER_RATIO
  );

  return Object.freeze({
    baseMs,
    factor,
    maxMs,
    jitterRatio,
  });
}

export function backoffConfigToOptions(config: RetryBackoffConfig): BackoffOptions {
  return {
    baseMs: config.baseMs,
    factor: config.factor,
    maxMs: config.maxMs,
    jitterRatio: config.jitterRatio,
  } satisfies BackoffOptions;
}
