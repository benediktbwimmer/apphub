/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, test } from 'node:test';
import { loadServiceConfig, resetCachedServiceConfig } from '../src/config/serviceConfig';
import {
  getStagingWriteManager,
  resetStagingWriteManager,
  StagingQueueFullError
} from '../src/ingestion/stagingManager';
import type { StagePartitionRequest } from '../src/storage/spoolManager';

let stagingDir: string;

beforeEach(async () => {
  stagingDir = await mkdtemp(path.join(tmpdir(), 'timestore-staging-'));
  process.env.TIMESTORE_STAGING_DIRECTORY = stagingDir;
  process.env.TIMESTORE_STAGING_MAX_PENDING = '1';
  await resetCachedServiceConfig();
});

afterEach(async () => {
  await resetStagingWriteManager();
  await resetCachedServiceConfig();
  delete process.env.TIMESTORE_STAGING_DIRECTORY;
  delete process.env.TIMESTORE_STAGING_MAX_PENDING;
  await rm(stagingDir, { recursive: true, force: true });
});

test('staging manager enqueues sequential writes and enforces capacity', async () => {
  const config = loadServiceConfig();
  const manager = getStagingWriteManager(config);

  const baseRequest: StagePartitionRequest = {
    datasetSlug: 'queue-test',
    tableName: 'records',
    schema: [
      { name: 'recordedAt', type: 'timestamp' },
      { name: 'value', type: 'double' }
    ],
    rows: [
      { recordedAt: new Date('2024-04-01T00:00:00Z'), value: 1.23 },
      { recordedAt: new Date('2024-04-01T00:01:00Z'), value: 1.24 }
    ],
    partitionKey: { window: '2024-04-01T00:00:00Z' },
    partitionAttributes: null,
    timeRange: {
      start: '2024-04-01T00:00:00Z',
      end: '2024-04-01T00:05:00Z'
    },
    ingestionSignature: 'sig-primary',
    receivedAt: '2024-04-01T00:05:00Z'
  };

  const firstPromise = manager.enqueue(baseRequest);

  await assert.rejects(
    manager.enqueue({ ...baseRequest, ingestionSignature: 'sig-secondary' }),
    (error: unknown) => {
      assert.ok(error instanceof StagingQueueFullError);
      assert.match(error.message, /reached capacity/i);
      return true;
    }
  );

  const firstResult = await firstPromise;
  assert.equal(firstResult.alreadyStaged, false);

  const secondResult = await manager.enqueue({
    ...baseRequest,
    ingestionSignature: 'sig-secondary',
    rows: [{ recordedAt: new Date('2024-04-01T00:02:00Z'), value: 1.25 }]
  });
  assert.equal(secondResult.alreadyStaged, false);
});
