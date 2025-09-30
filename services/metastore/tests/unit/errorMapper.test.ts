import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapToHttpError } from '../../src/errors/mapper';
import { HttpError } from '../../src/errors/httpError';
import { OptimisticLockError, RecordDeletedError } from '../../src/db/recordsRepository';

test('returns existing HttpError instance without modification', () => {
  const original = new HttpError(404, 'not_found', 'Missing');
  const mapped = mapToHttpError(original);
  assert.equal(mapped, original);
});

test('maps OptimisticLockError to version conflict HttpError', () => {
  const conflict = new OptimisticLockError('Version mismatch');
  const mapped = mapToHttpError(conflict);
  assert.equal(mapped.statusCode, 409);
  assert.equal(mapped.code, 'version_conflict');
  assert.equal(mapped.message, 'Version mismatch');
});

test('maps RecordDeletedError to record_deleted HttpError', () => {
  const deleted = new RecordDeletedError('Cannot patch deleted record');
  const mapped = mapToHttpError(deleted);
  assert.equal(mapped.statusCode, 409);
  assert.equal(mapped.code, 'record_deleted');
  assert.equal(mapped.message, 'Cannot patch deleted record');
});

test('preserves statusCode and code when provided on plain object', () => {
  const mapped = mapToHttpError({ statusCode: 429, code: 'rate_limited', message: 'slow down' });
  assert.equal(mapped.statusCode, 429);
  assert.equal(mapped.code, 'rate_limited');
  assert.equal(mapped.message, 'slow down');
});

test('falls back to 500 internal error for unknown inputs', () => {
  const mapped = mapToHttpError('boom');
  assert.equal(mapped.statusCode, 500);
  assert.equal(mapped.code, 'internal_error');
  assert.equal(mapped.message, 'Unknown error');
});
