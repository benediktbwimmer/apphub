import { computeExponentialBackoff } from '@apphub/shared/retries/backoff';

import { getRuntimeScalingEffectiveConcurrency } from '../runtimeScaling/state';
import { getRuntimeScalingTarget } from '../runtimeScaling/targets';
import type { JobRetryPolicy } from '../db/types';

type RetryBackoffConfig = {
  baseMs: number;
  factor: number;
  maxMs: number;
  jitterRatio: number;
};

function normalizePositiveNumber(value: string | undefined, fallback: number, minimum = 1): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < minimum) {
    return fallback;
  }
  return parsed;
}

function normalizeRatio(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 1);
}

function resolveWorkflowRetryBackoff(env: NodeJS.ProcessEnv = process.env): RetryBackoffConfig {
  return {
    baseMs: normalizePositiveNumber(env.WORKFLOW_RETRY_BASE_MS, 5_000),
    factor: normalizePositiveNumber(env.WORKFLOW_RETRY_FACTOR, 2),
    maxMs: normalizePositiveNumber(env.WORKFLOW_RETRY_MAX_MS, 30 * 60_000),
    jitterRatio: normalizeRatio(env.WORKFLOW_RETRY_JITTER_RATIO, 0.2)
  } satisfies RetryBackoffConfig;
}

export function resolveRuntimeConcurrencyBaseline(env: NodeJS.ProcessEnv = process.env): number {
  const runtimeTarget = getRuntimeScalingTarget('core:workflow');
  const runtimeValue = getRuntimeScalingEffectiveConcurrency('core:workflow');
  if (runtimeValue !== null && runtimeValue > 0) {
    return Math.max(1, Math.min(runtimeValue, runtimeTarget.maxConcurrency));
  }

  const fallbackCandidate = Number(
    env.WORKFLOW_MAX_PARALLEL ?? env.WORKFLOW_CONCURRENCY ?? runtimeTarget.defaultConcurrency
  );

  const normalized =
    Number.isFinite(fallbackCandidate) && fallbackCandidate > 0
      ? Math.floor(fallbackCandidate)
      : runtimeTarget.defaultConcurrency;

  return Math.max(1, Math.min(normalized, runtimeTarget.maxConcurrency));
}

export function resolveRetryAttemptLimit(policy: JobRetryPolicy | null | undefined): number | null {
  if (!policy || policy.maxAttempts === undefined || policy.maxAttempts === null) {
    return null;
  }
  const parsed = Number(policy.maxAttempts);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return Math.floor(parsed);
}

export function calculateRetryDelay(attempt: number, policy: JobRetryPolicy | null | undefined): number {
  if (!policy || attempt <= 1) {
    return 0;
  }

  const strategy = policy.strategy ?? 'fixed';
  const baseDelay = policy.initialDelayMs ?? 1_000;
  let delay = 0;

  switch (strategy) {
    case 'none':
      delay = 0;
      break;
    case 'exponential':
      delay = baseDelay * Math.pow(2, attempt - 2);
      break;
    case 'fixed':
    default:
      delay = baseDelay;
      break;
  }

  if (policy.maxDelayMs !== undefined && policy.maxDelayMs !== null && policy.maxDelayMs >= 0) {
    delay = Math.min(delay, policy.maxDelayMs);
  }

  if (!Number.isFinite(delay) || delay <= 0) {
    return 0;
  }

  return Math.floor(delay);
}

export function computeWorkflowRetryTimestamp(
  nextAttemptNumber: number,
  policy: JobRetryPolicy | null | undefined,
  retryAttempts: number,
  now: Date = new Date(),
  env: NodeJS.ProcessEnv = process.env
): string {
  let delay = calculateRetryDelay(nextAttemptNumber, policy ?? null);
  if (delay <= 0) {
    delay = computeExponentialBackoff(Math.max(1, retryAttempts), resolveWorkflowRetryBackoff(env));
  }
  if (delay <= 0) {
    const fallback = resolveWorkflowRetryBackoff(env);
    delay = fallback.baseMs;
  }
  return new Date(now.getTime() + delay).toISOString();
}

export type { RetryBackoffConfig as WorkflowRetryBackoffConfig };
export { resolveWorkflowRetryBackoff };
