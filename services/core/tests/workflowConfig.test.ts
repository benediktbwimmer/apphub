import './setupTestEnv';
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import type { JobRetryPolicy } from '../src/db/types';
import type { RuntimeScalingSnapshot } from '../src/runtimeScaling/policies';

let calculateRetryDelay: typeof import('../src/workflow/config').calculateRetryDelay;
let computeWorkflowRetryTimestamp: typeof import('../src/workflow/config').computeWorkflowRetryTimestamp;
let resolveRetryAttemptLimit: typeof import('../src/workflow/config').resolveRetryAttemptLimit;
let resolveRuntimeConcurrencyBaseline: typeof import('../src/workflow/config').resolveRuntimeConcurrencyBaseline;

let clearRuntimeScalingSnapshots: typeof import('../src/runtimeScaling/state').clearRuntimeScalingSnapshots;
let setRuntimeScalingSnapshot: typeof import('../src/runtimeScaling/state').setRuntimeScalingSnapshot;
let getRuntimeScalingTarget: typeof import('../src/runtimeScaling/targets').getRuntimeScalingTarget;

before(async () => {
  process.env.APPHUB_ALLOW_INLINE_MODE = 'true';
  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';

  const configModule = await import('../src/workflow/config');
  calculateRetryDelay = configModule.calculateRetryDelay;
  computeWorkflowRetryTimestamp = configModule.computeWorkflowRetryTimestamp;
  resolveRetryAttemptLimit = configModule.resolveRetryAttemptLimit;
  resolveRuntimeConcurrencyBaseline = configModule.resolveRuntimeConcurrencyBaseline;

  const runtimeStateModule = await import('../src/runtimeScaling/state');
  clearRuntimeScalingSnapshots = runtimeStateModule.clearRuntimeScalingSnapshots;
  setRuntimeScalingSnapshot = runtimeStateModule.setRuntimeScalingSnapshot;

  const targetsModule = await import('../src/runtimeScaling/targets');
  getRuntimeScalingTarget = targetsModule.getRuntimeScalingTarget;
});

describe('resolveRuntimeConcurrencyBaseline', () => {
  it('clamps runtime scaling concurrency to target maximum when provided', () => {
    clearRuntimeScalingSnapshots();
    const target = getRuntimeScalingTarget('core:workflow');
    const snapshot: RuntimeScalingSnapshot = {
      target: target.key,
      queueKey: target.queueKey,
      queueName: target.queueName,
      displayName: target.displayName,
      description: target.description,
      desiredConcurrency: target.maxConcurrency * 2,
      effectiveConcurrency: target.maxConcurrency * 2,
      defaultConcurrency: target.defaultConcurrency,
      minConcurrency: target.minConcurrency,
      maxConcurrency: target.maxConcurrency,
      rateLimitMs: target.rateLimitMs,
      source: 'default',
      reason: null,
      updatedAt: new Date().toISOString(),
      updatedBy: null,
      updatedByKind: null,
      policy: null
    };

    setRuntimeScalingSnapshot(snapshot);

    try {
      const result = resolveRuntimeConcurrencyBaseline();
      assert.equal(result, target.maxConcurrency);
    } finally {
      clearRuntimeScalingSnapshots();
    }
  });

  it('falls back to environment overrides when runtime scaling is unavailable', () => {
    clearRuntimeScalingSnapshots();

    const env = {
      WORKFLOW_MAX_PARALLEL: '9'
    } as NodeJS.ProcessEnv;

    const result = resolveRuntimeConcurrencyBaseline(env);

    assert.equal(result, 9);
  });
});

describe('resolveRetryAttemptLimit', () => {
  it('returns null when policy is missing or invalid', () => {
    assert.equal(resolveRetryAttemptLimit(null), null);
    assert.equal(resolveRetryAttemptLimit({} as JobRetryPolicy), null);
    assert.equal(resolveRetryAttemptLimit({ maxAttempts: 0 } as JobRetryPolicy), null);
  });

  it('normalizes valid numeric attempts', () => {
    assert.equal(resolveRetryAttemptLimit({ maxAttempts: 3.8 } as JobRetryPolicy), 3);
  });
});

describe('calculateRetryDelay', () => {
  it('returns zero for strategies that disable retries', () => {
    const policy: JobRetryPolicy = { strategy: 'none', initialDelayMs: 2_000 };
    assert.equal(calculateRetryDelay(2, policy), 0);
  });

  it('applies exponential growth and respects max delay', () => {
    const policy: JobRetryPolicy = {
      strategy: 'exponential',
      initialDelayMs: 500,
      maxDelayMs: 900
    };
    assert.equal(calculateRetryDelay(3, policy), 900);
  });
});

describe('computeWorkflowRetryTimestamp', () => {
  it('uses policy-defined delays when provided', () => {
    const now = new Date('2024-01-01T00:00:00.000Z');
    const policy: JobRetryPolicy = {
      strategy: 'fixed',
      initialDelayMs: 2_500
    };

    const timestamp = computeWorkflowRetryTimestamp(2, policy, 1, now, {
      WORKFLOW_RETRY_BASE_MS: '1000',
      WORKFLOW_RETRY_FACTOR: '2',
      WORKFLOW_RETRY_MAX_MS: '10000',
      WORKFLOW_RETRY_JITTER_RATIO: '0'
    });

    assert.equal(timestamp, new Date(now.getTime() + 2_500).toISOString());
  });

  it('falls back to exponential backoff when policy delay is zero', () => {
    const now = new Date('2024-01-01T00:00:00.000Z');
    const timestamp = computeWorkflowRetryTimestamp(1, null, 3, now, {
      WORKFLOW_RETRY_BASE_MS: '1000',
      WORKFLOW_RETRY_FACTOR: '2',
      WORKFLOW_RETRY_MAX_MS: '10000',
      WORKFLOW_RETRY_JITTER_RATIO: '0'
    });

    assert.equal(timestamp, new Date(now.getTime() + 4_000).toISOString());
  });
});
