/// <reference path="../src/types/embeddedPostgres.d.ts" />

import './testEnv';

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, test } from 'node:test';
import * as duckdb from 'duckdb';
import { DuckDbSpoolManager } from '../src/storage/spoolManager';
import type { FieldDefinition } from '../src/storage';

describe('DuckDbSpoolManager', () => {
  let rootDir: string;
  let manager: DuckDbSpoolManager;

  const schema: FieldDefinition[] = [
    { name: 'recordedAt', type: 'timestamp' },
    { name: 'value', type: 'double' },
    { name: 'label', type: 'string' }
  ];

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(tmpdir(), 'timestore-spool-'));
    manager = new DuckDbSpoolManager({
      directory: rootDir,
      maxDatasetBytes: 10 * 1024 * 1024,
      maxTotalBytes: 20 * 1024 * 1024
    });
  });

  afterEach(async () => {
    await manager.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  test('creates staging tables and appends rows', async () => {
    const datasetSlug = 'metrics.latency';
    const rows = [
      { recordedAt: new Date('2024-01-01T00:00:00Z'), value: 12.34, label: 'api' },
      { recordedAt: new Date('2024-01-01T00:05:00Z'), value: 9.87, label: 'api' }
    ];

    const appended = await manager.appendRows({
      datasetSlug,
      tableName: 'records',
      schema,
      rows
    });

    assert.equal(appended, rows.length, 'should report the number of staged rows');

    const stats = await manager.getDatasetStats(datasetSlug);
    assert.equal(stats.totalRows, rows.length, 'should track total staged rows');
    const tableStats = stats.tables.find((entry) => entry.tableName === 'records');
    assert.ok(tableStats, 'should expose table statistics');
    assert.equal(tableStats?.rowCount, rows.length);
    assert.ok(stats.databaseSizeBytes >= 0);
    assert.ok(stats.walSizeBytes >= 0);
  });

  test('recovers staged rows after a restart', async () => {
    const datasetSlug = 'metrics.throughput';

    await manager.appendRows({
      datasetSlug,
      tableName: 'records',
      schema,
      rows: [
        { recordedAt: new Date('2024-02-01T00:00:00Z'), value: 100, label: 'worker-a' }
      ]
    });

    await manager.close();

    manager = new DuckDbSpoolManager({
      directory: rootDir,
      maxDatasetBytes: 10 * 1024 * 1024,
      maxTotalBytes: 20 * 1024 * 1024
    });

    const statsAfterRestart = await manager.getDatasetStats(datasetSlug);
    const initialTable = statsAfterRestart.tables.find((entry) => entry.tableName === 'records');
    assert.equal(initialTable?.rowCount ?? 0, 1, 'should retain staged rows after restart');

    await manager.appendRows({
      datasetSlug,
      tableName: 'records',
      schema,
      rows: [
        { recordedAt: new Date('2024-02-01T00:10:00Z'), value: 104, label: 'worker-b' }
      ]
    });

    const finalStats = await manager.getDatasetStats(datasetSlug);
    const finalTable = finalStats.tables.find((entry) => entry.tableName === 'records');
    assert.equal(finalTable?.rowCount ?? 0, 2, 'should continue staging rows after recovery');
  });

  test('stagePartition records metadata and enforces idempotency', async () => {
    const datasetSlug = 'metrics.latency';
    const tableName = 'records';
    const ingestionSignature = 'sig-123';
    const rows = [
      { recordedAt: new Date('2024-03-01T00:00:00Z'), value: 42.5, label: 'api' },
      { recordedAt: new Date('2024-03-01T00:05:00Z'), value: 43.1, label: 'api' }
    ];

    const result = await manager.stagePartition({
      datasetSlug,
      tableName,
      schema,
      rows,
      partitionKey: { window: '2024-03-01T00:00:00Z', chunk: '0' },
      partitionAttributes: { source: 'test' },
      timeRange: {
        start: '2024-03-01T00:00:00Z',
        end: '2024-03-01T00:10:00Z'
      },
      ingestionSignature,
      receivedAt: '2024-03-01T00:10:00Z'
    });

    assert.equal(result.alreadyStaged, false);
    assert.equal(result.rowCount, rows.length);
    assert.ok(result.batchId);

    const sanitizedSlug = datasetSlug.replace(/[^a-zA-Z0-9_.-]/g, '_') || 'dataset';
    const databasePath = path.join(rootDir, sanitizedSlug, 'staging.duckdb');
    const database = new duckdb.Database(databasePath);
    const connection = database.connect();

    const metadataRows: Array<{ ingestion_signature: string; row_count: bigint }> = await new Promise(
      (resolve, reject) => {
        connection.all(
          'SELECT ingestion_signature, row_count FROM "staging"."staging"."__ingestion_batches"',
          (err: Error | null, rowsResult?: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            resolve((rowsResult ?? []) as Array<{ ingestion_signature: string; row_count: bigint }>);
          }
        );
      }
    );

    assert.equal(metadataRows.length, 1);
    assert.equal(metadataRows[0]?.ingestion_signature, ingestionSignature);
    assert.equal(Number(metadataRows[0]?.row_count ?? 0n), rows.length);

    await new Promise<void>((resolve, reject) => {
      connection.close((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      database.close((err: Error | null) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const duplicate = await manager.stagePartition({
      datasetSlug,
      tableName,
      schema,
      rows,
      partitionKey: { window: '2024-03-01T00:00:00Z', chunk: '0' },
      partitionAttributes: { source: 'test' },
      timeRange: {
        start: '2024-03-01T00:00:00Z',
        end: '2024-03-01T00:10:00Z'
      },
      ingestionSignature,
      receivedAt: '2024-03-01T00:10:00Z'
    });

    assert.equal(duplicate.alreadyStaged, true);
    assert.equal(duplicate.rowCount, rows.length);
  });

  test('dataset read lock blocks writers across managers', async () => {
    const datasetSlug = 'metrics.lock';
    await manager.appendRows({
      datasetSlug,
      tableName: 'records',
      schema,
      rows: [
        { recordedAt: new Date('2024-04-01T00:00:00Z'), value: 1, label: 'seed' }
      ]
    });

    const releaseReadLock = await manager.acquireDatasetReadLock(datasetSlug);
    const otherManager = new DuckDbSpoolManager({
      directory: rootDir,
      maxDatasetBytes: 10 * 1024 * 1024,
      maxTotalBytes: 20 * 1024 * 1024
    });

    let appendState: 'pending' | 'fulfilled' | 'rejected' = 'pending';
    const appendPromise = otherManager
      .appendRows({
        datasetSlug,
        tableName: 'records',
        schema,
        rows: [
          { recordedAt: new Date('2024-04-01T00:05:00Z'), value: 2, label: 'writer' }
        ]
      })
      .then((value) => {
        appendState = 'fulfilled';
        return value;
      })
      .catch((error) => {
        appendState = 'rejected';
        throw error;
      });

    try {
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
      assert.equal(appendState, 'pending', 'writer should wait while read lock held');
    } finally {
      releaseReadLock();
    }

    const appended = await appendPromise;
    assert.equal(appendState, 'fulfilled', 'writer should finish after lock released');
    assert.equal(appended, 1);
    await otherManager.close();
  });
});
