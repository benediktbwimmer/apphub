import test from 'node:test';
import assert from 'node:assert/strict';
import { SecretTokenManager } from '../src/tokens/tokenManager';

const NOW = new Date('2024-01-01T00:00:00.000Z');

function nowProvider() {
  return new Date(NOW);
}

test('issues token with clamped TTL and scope validation', () => {
  const manager = new SecretTokenManager({
    defaultTtlSeconds: 120,
    maxTtlSeconds: 600,
    now: nowProvider
  });

  const token = manager.issue({
    subject: 'test-subject',
    keys: ['foo', 'bar'],
    ttlSeconds: 3600
  });

  assert.equal(token.subject, 'test-subject');
  assert.equal(token.allowedKeys === '*' ? 'wildcard' : token.allowedKeys.size, 2);
  assert.equal(token.issuedAt.toISOString(), NOW.toISOString());
  assert.equal(token.expiresAt.toISOString(), new Date(NOW.getTime() + 600 * 1000).toISOString());
});

test('refresh extends expiration and increments counter', () => {
  let current = NOW;
  const manager = new SecretTokenManager({
    defaultTtlSeconds: 60,
    maxTtlSeconds: 300,
    now: () => new Date(current)
  });

  const token = manager.issue({
    subject: 'refresh-test',
    keys: '*'
  });

  current = new Date(NOW.getTime() + 30 * 1000);
  const result = manager.refresh(token.token, 120);
  assert(result, 'expected refresh result');
  assert.equal(result.token.refreshCount, 1);
  assert.equal(
    result.token.expiresAt.toISOString(),
    new Date(current.getTime() + 120 * 1000).toISOString()
  );
});

test('revoke removes token', () => {
  const manager = new SecretTokenManager({
    defaultTtlSeconds: 60,
    maxTtlSeconds: 120,
    now: nowProvider
  });
  const token = manager.issue({ subject: 'revoke', keys: '*' });
  const revoked = manager.revoke(token.token);
  assert.ok(revoked);
  assert.equal(manager.get(token.token), null);
});
