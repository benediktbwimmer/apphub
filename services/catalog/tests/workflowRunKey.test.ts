import './setupTestEnv';
import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRunKeyFromParts, computeRunKeyColumns, normalizeRunKey } from '../src/workflows/runKey';

test('normalizeRunKey preserves meaningful content and lowercases normalized value', () => {
  const { runKey, normalized } = normalizeRunKey('Invoice-123');
  assert.equal(runKey, 'Invoice-123');
  assert.equal(normalized, 'invoice-123');
});

test('normalizeRunKey trims separators and validates allowed characters', () => {
  const { runKey, normalized } = normalizeRunKey('  partition_2024-05-01  ');
  assert.equal(runKey, 'partition_2024-05-01');
  assert.equal(normalized, 'partition_2024-05-01');
});

test('normalizeRunKey rejects invalid characters', () => {
  assert.throws(() => normalizeRunKey('foo bar'), /invalid characters/i);
});

test('computeRunKeyColumns handles nullable inputs', () => {
  const result = computeRunKeyColumns(null);
  assert.equal(result.runKey, null);
  assert.equal(result.runKeyNormalized, null);

  const derived = computeRunKeyColumns('Run-XYZ');
  assert.equal(derived.runKey, 'Run-XYZ');
  assert.equal(derived.runKeyNormalized, 'run-xyz');
});

test('buildRunKeyFromParts assembles sanitized keys', () => {
  const key = buildRunKeyFromParts('schedule', 'daily', '2024-05-01T03:00:00Z');
  assert.equal(key, 'schedule-daily-2024-05-01T03-00-00Z');

  const missing = buildRunKeyFromParts(null, undefined, '   ');
  assert.equal(missing, null);
});
