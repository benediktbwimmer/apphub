import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeIdentifier, toTemporalKey } from '../utils';

test('sanitizeIdentifier removes disallowed characters', () => {
  assert.equal(sanitizeIdentifier('queue:name'), 'queue-name');
  assert.equal(sanitizeIdentifier('  foo  '), 'foo');
  assert.equal(sanitizeIdentifier('foo@@bar', { replacement: '_' }), 'foo_bar');
});

test('toTemporalKey normalizes minute strings', () => {
  assert.equal(toTemporalKey('2024-01-01T12:30'), '2024-01-01T12-30');
  assert.equal(toTemporalKey('2024-01-01T12:30Z'), '2024-01-01T12-30Z');
});
