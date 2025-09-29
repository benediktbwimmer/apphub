const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizePositiveNumber,
  normalizeRatio,
  resolveRetryBackoffConfig,
  backoffConfigToOptions
} = require('../../dist/retries/config.js');

describe('normalizePositiveNumber', () => {
  it('returns parsed value when above minimum', () => {
    assert.equal(normalizePositiveNumber('42', 10), 42);
  });

  it('respects minimum threshold', () => {
    assert.equal(normalizePositiveNumber('0', 5, 1), 5);
    assert.equal(normalizePositiveNumber('3', 5, { minimum: 4 }), 5);
  });

  it('coerces results to integers when requested', () => {
    assert.equal(normalizePositiveNumber('9.8', 1, { integer: true }), 9);
    assert.equal(normalizePositiveNumber(undefined, 7.5, { integer: true }), 7);
  });

  it('falls back on invalid numbers', () => {
    assert.equal(normalizePositiveNumber('not-a-number', 13), 13);
  });
});

describe('normalizeRatio', () => {
  it('clamps ratio within 0..1 by default', () => {
    assert.equal(normalizeRatio('1.5', 0.2), 1);
    assert.equal(normalizeRatio('-0.3', 0.2), 0);
  });

  it('uses fallback when parsed value is not numeric', () => {
    assert.equal(normalizeRatio('x', 0.7), 0.7);
  });

  it('applies custom bounds when provided', () => {
    assert.equal(normalizeRatio('5', 0.4, { min: 0.2, max: 0.6 }), 0.6);
  });
});

describe('resolveRetryBackoffConfig', () => {
  it('returns defaults when env overrides are missing', () => {
    const config = resolveRetryBackoffConfig(
      { baseMs: 1_000, factor: 2, maxMs: 10_000, jitterRatio: 0.3 },
      { prefix: 'MISSING' }
    );

    assert.deepEqual(config, {
      baseMs: 1_000,
      factor: 2,
      maxMs: 10_000,
      jitterRatio: 0.3
    });
  });

  it('normalizes overrides provided via env keys', () => {
    const env = {
      RETRY_BASE_MS: '500',
      RETRY_FACTOR: '4',
      RETRY_MAX_MS: '-2',
      RETRY_JITTER_RATIO: '1.5'
    };

    const config = resolveRetryBackoffConfig(
      { baseMs: 1_000, factor: 2, maxMs: 10_000, jitterRatio: 0.3 },
      { prefix: 'RETRY', env }
    );

    assert.deepEqual(config, {
      baseMs: 500,
      factor: 4,
      maxMs: 10_000,
      jitterRatio: 1
    });
  });

  it('supports explicit env key mapping and exposes plain options', () => {
    const env = {
      CUSTOM_BASE: '2500',
      CUSTOM_FACTOR: 'not-a-number',
      CUSTOM_MAX: '7500',
      CUSTOM_JITTER: '0.1'
    };

    const config = resolveRetryBackoffConfig(
      { baseMs: 1_000, factor: 2, maxMs: 10_000 },
      {
        env,
        keys: {
          baseMs: 'CUSTOM_BASE',
          factor: 'CUSTOM_FACTOR',
          maxMs: 'CUSTOM_MAX',
          jitterRatio: 'CUSTOM_JITTER'
        }
      }
    );

    assert.deepEqual(config, {
      baseMs: 2_500,
      factor: 2,
      maxMs: 7_500,
      jitterRatio: 0.1
    });

    assert.deepEqual(backoffConfigToOptions(config), {
      baseMs: 2_500,
      factor: 2,
      maxMs: 7_500,
      jitterRatio: 0.1
    });
  });
});
