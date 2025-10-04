import './testEnv';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HotBufferStore } from '../src/streaming/hotBuffer';

const baseConfig = {
  enabled: true,
  retentionSeconds: 365 * 24 * 3600,
  maxRowsPerDataset: 10,
  maxTotalRows: undefined as number | undefined,
  refreshWatermarkMs: 5_000,
  fallbackMode: 'parquet_only' as const
};

test('HotBufferStore prunes rows that fall behind the watermark', () => {
  const store = new HotBufferStore(baseConfig);
  const datasetSlug = 'hybrid-test';
  const base = Date.now();

  store.ingest(datasetSlug, { timestamp: new Date(base).toISOString(), value: 1 }, base);
  store.ingest(datasetSlug, { timestamp: new Date(base + 15_000).toISOString(), value: 2 }, base + 15_000);

  let query = store.query(datasetSlug, {
    rangeStart: new Date(base - 5_000),
    rangeEnd: new Date(base + 30_000),
    timestampColumn: 'timestamp'
  });
  assert.equal(query.rows.length, 2);

  store.setWatermark(datasetSlug, base + 10_000);

  query = store.query(datasetSlug, {
    rangeStart: new Date(base - 5_000),
    rangeEnd: new Date(base + 30_000),
    timestampColumn: 'timestamp'
  });
  assert.equal(query.rows.length, 1);
  assert.equal(query.rows[0]?.value, 2);
  assert.equal(query.watermarkMs, base + 10_000);
});

test('HotBufferStore enforces global max rows across datasets', () => {
  const store = new HotBufferStore({
    ...baseConfig,
    maxRowsPerDataset: 10,
    maxTotalRows: 3
  });

  const base = Date.now();

  store.ingest('ds-a', { timestamp: new Date(base).toISOString(), v: 1 }, base);
  store.ingest('ds-b', { timestamp: new Date(base + 5_000).toISOString(), v: 2 }, base + 5_000);
  store.ingest('ds-a', { timestamp: new Date(base + 10_000).toISOString(), v: 3 }, base + 10_000);
  store.ingest('ds-c', { timestamp: new Date(base + 15_000).toISOString(), v: 4 }, base + 15_000);

  const queryA = store.query('ds-a', {
    rangeStart: new Date(base - 1_000),
    rangeEnd: new Date(base + 60_000),
    timestampColumn: 'timestamp'
  });
  const queryB = store.query('ds-b', {
    rangeStart: new Date(base - 1_000),
    rangeEnd: new Date(base + 60_000),
    timestampColumn: 'timestamp'
  });
  const queryC = store.query('ds-c', {
    rangeStart: new Date(base - 1_000),
    rangeEnd: new Date(base + 60_000),
    timestampColumn: 'timestamp'
  });

  const totalRows = queryA.rows.length + queryB.rows.length + queryC.rows.length;
  assert.equal(totalRows, 3);
  assert.equal(store.datasetCount(), 3);
  // Oldest row from ds-a should have been pruned to respect the global max.
  assert.deepEqual(queryA.rows.map((row) => row.v), [3]);
});
