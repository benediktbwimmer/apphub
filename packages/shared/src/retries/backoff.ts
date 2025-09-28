export type BackoffOptions = {
  baseMs?: number;
  factor?: number;
  maxMs?: number;
  jitterRatio?: number;
  random?: () => number;
};

const DEFAULT_BACKOFF: Required<Omit<BackoffOptions, 'random'>> = {
  baseMs: 5_000,
  factor: 2,
  maxMs: 5 * 60_000,
  jitterRatio: 0.2
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function computeExponentialBackoff(attempt: number, options: BackoffOptions = {}): number {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));

  const {
    baseMs = DEFAULT_BACKOFF.baseMs,
    factor = DEFAULT_BACKOFF.factor,
    maxMs = DEFAULT_BACKOFF.maxMs,
    jitterRatio = DEFAULT_BACKOFF.jitterRatio,
    random
  } = options;

  const rawDelay = baseMs * Math.pow(factor, normalizedAttempt - 1);
  const cappedDelay = clamp(rawDelay, baseMs, maxMs);

  if (jitterRatio <= 0) {
    return Math.round(cappedDelay);
  }

  const randomFn = typeof random === 'function' ? random : Math.random;
  const jitterSpan = cappedDelay * jitterRatio;
  const jitter = (randomFn() * 2 - 1) * jitterSpan;
  const jittered = clamp(cappedDelay + jitter, baseMs, maxMs);

  return Math.round(jittered);
}

export function computeNextAttemptTimestamp(
  attempt: number,
  options: BackoffOptions = {},
  now: Date = new Date()
): string {
  const delayMs = computeExponentialBackoff(attempt, options);
  return new Date(now.getTime() + delayMs).toISOString();
}
