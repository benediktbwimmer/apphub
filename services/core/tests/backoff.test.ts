import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExponentialBackoff,
  computeNextAttemptTimestamp
} from '@apphub/shared/retries/backoff';

describe('computeExponentialBackoff', () => {
  it('applies exponential growth with deterministic jitter', () => {
    const delay = computeExponentialBackoff(1, {
      baseMs: 1_000,
      factor: 2,
      maxMs: 10_000,
      jitterRatio: 0.1,
      random: () => 1
    });

    assert.equal(delay, 1_100);
  });

  it('clamps jittered value to minimum base', () => {
    const delay = computeExponentialBackoff(2, {
      baseMs: 1_000,
      factor: 2,
      maxMs: 10_000,
      jitterRatio: 0.5,
      random: () => 0
    });

    assert.equal(delay, 1_000);
  });
});

describe('computeNextAttemptTimestamp', () => {
  it('returns an ISO timestamp offset by computed backoff', () => {
    const now = new Date('2024-01-01T00:00:00.000Z');
    const next = computeNextAttemptTimestamp(3, {
      baseMs: 500,
      factor: 2,
      maxMs: 10_000,
      jitterRatio: 0,
      random: () => 0.5
    }, now);

    assert.equal(next, new Date(now.getTime() + 2_000).toISOString());
  });
});
