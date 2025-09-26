import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FastifyRequest } from 'fastify';
import type { DatasetRecord } from '../src/db/metadata';

process.env.TIMESTORE_REQUIRE_SCOPE = 'global:read';
process.env.TIMESTORE_REQUIRE_WRITE_SCOPE = 'global:write';
process.env.TIMESTORE_ADMIN_SCOPE = 'admin:scope';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const iam = require('../src/service/iam') as typeof import('../src/service/iam');
const {
  assertDatasetReadAccess,
  assertDatasetWriteAccess,
  resolveRequestActor
} = iam;

function fakeRequest(scopes: string[], actorId = 'user-1'): FastifyRequest {
  return {
    headers: {
      'x-iam-scopes': scopes.join(','),
      'x-iam-user': actorId
    }
  } as unknown as FastifyRequest;
}

function makeDataset(metadata: Record<string, unknown> = {}): DatasetRecord {
  return {
    id: `ds-${Math.random().toString(16).slice(2, 10)}`,
    slug: `dataset-${Math.random().toString(16).slice(2, 6)}`,
    name: 'Test Dataset',
    description: null,
    status: 'active',
    writeFormat: 'duckdb',
    defaultStorageTargetId: null,
    metadata,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

test('assertDatasetReadAccess honours dataset read scopes', () => {
  const dataset = makeDataset({
    iam: {
      readScopes: ['dataset:read']
    }
  });
  assertDatasetReadAccess(fakeRequest(['dataset:read']), dataset);
});

test('assertDatasetReadAccess falls back to global scope', () => {
  const dataset = makeDataset();
  assert.throws(
    () => {
      assertDatasetReadAccess(fakeRequest(['other-scope']), dataset);
    },
    /Missing required scope/
  );
});

test('assertDatasetWriteAccess checks dataset-specific scopes', () => {
  const dataset = makeDataset({
    iam: {
      writeScopes: ['dataset:write']
    }
  });
  assertDatasetWriteAccess(fakeRequest(['dataset:write']), dataset);
  assert.throws(
    () => {
      assertDatasetWriteAccess(fakeRequest(['dataset:read']), dataset);
    },
    /Missing required write scope/
  );
});

test('assertDatasetWriteAccess honours global fallback for new datasets', () => {
  assert.throws(
    () => {
      assertDatasetWriteAccess(fakeRequest(['dataset:write']), null);
    },
    /Missing required scope/
  );
  assertDatasetWriteAccess(fakeRequest(['global:write']), null);
});

test('resolveRequestActor extracts actor id and scopes', () => {
  const actor = resolveRequestActor(fakeRequest(['dataset:read'], 'user-99'));
  assert.ok(actor);
  assert.equal(actor?.id, 'user-99');
  assert.deepEqual(actor?.scopes, ['dataset:read']);
});
