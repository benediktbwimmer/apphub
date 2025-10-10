import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';

import { startStack } from './lib/stack';
import { waitForEndpoint } from './lib/http';
import { analyzeLogs } from './lib/logs';
import { TimestoreClient, type DatasetManifestPayload } from './lib/timestoreClient';
import {
  CORE_BASE_URL,
  TIMESTORE_BASE_URL,
  OPERATOR_TOKEN
} from './lib/env';

const SKIP_STACK = process.env.APPHUB_E2E_SKIP_STACK === '1';
const PRESERVE_STACK = process.env.APPHUB_E2E_PRESERVE_STACK === '1';
const TEST_ID = randomUUID().slice(0, 8);
const TEST_TIMEOUT_MS = (() => {
  const raw = process.env.APPHUB_E2E_TEST_TIMEOUT;
  if (!raw) {
    return 240_000;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 240_000;
})();

function sanitizeViewSlug(slug: string): string {
  const trimmed = slug.trim();
  const replaced = trimmed.replace(/[^A-Za-z0-9_]/g, '_');
  const collapsed = replaced.replace(/_+/g, '_');
  const stripped = collapsed.replace(/^_+|_+$/g, '');
  const fallback = stripped.length > 0 ? stripped : 'dataset';
  if (/^[0-9]/.test(fallback)) {
    return `d_${fallback}`;
  }
  return fallback;
}

function buildViewName(slug: string): string {
  return `timestore.${sanitizeViewSlug(slug)}`;
}

async function waitForQueryRows(
  client: TimestoreClient,
  slug: string,
  request: Parameters<TimestoreClient['queryDataset']>[1],
  expectedRows: number,
  options: { timeoutMs?: number; pollIntervalMs?: number; label?: string; log?: (line: string) => void } = {}
) {
  const timeout = options.timeoutMs ?? 180_000;
  const pollInterval = options.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeout;
  let lastError: unknown = null;
  const label = options.label ?? slug;
  const log = options.log;

  while (Date.now() < deadline) {
    try {
      const result = await client.queryDataset(slug, request);
      if (result.rows.length >= expectedRows) {
        log?.(`waitForQueryRows(${label}): satisfied with ${result.rows.length} rows`);
        return result;
      }
      lastError = new Error(`received ${result.rows.length} rows (expected ${expectedRows})`);
      log?.(`waitForQueryRows(${label}): ${result.rows.length}/${expectedRows} rows, retrying`);
    } catch (error) {
      lastError = error;
      log?.(`waitForQueryRows(${label}): error ${(error as Error)?.message ?? error}`);
    }
    await sleep(pollInterval);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(`Timed out waiting for dataset ${slug} rows (${message})`);
}

async function waitForSqlCount(
  client: TimestoreClient,
  viewName: string,
  expectedCount: number,
  options: { timeoutMs?: number; pollIntervalMs?: number; log?: (line: string) => void } = {}
) {
  const timeout = options.timeoutMs ?? 120_000;
  const pollInterval = options.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeout;
  let lastError: unknown = null;
  const log = options.log;

  while (Date.now() < deadline) {
    try {
      const response = await client.sqlRead(`SELECT COUNT(*) AS row_count FROM ${viewName}`);
      const value = response.rows[0]?.row_count ?? response.rows[0]?.ROW_COUNT;
      const numeric = typeof value === 'number' ? value : Number(value ?? 0);
      if (Number.isFinite(numeric) && numeric === expectedCount) {
        log?.(`waitForSqlCount(${viewName}): count=${numeric}, satisfied`);
        return response;
      }
      lastError = new Error(`row_count=${numeric}, expected=${expectedCount}`);
      log?.(`waitForSqlCount(${viewName}): row_count=${numeric}, retrying`);
    } catch (error) {
      lastError = error;
      log?.(`waitForSqlCount(${viewName}): error ${(error as Error)?.message ?? error}`);
    }
    await sleep(pollInterval);
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(`Timed out waiting for SQL runtime for ${viewName} (${message})`);
}

async function waitForManifestCondition(
  client: TimestoreClient,
  slug: string,
  predicate: (manifest: DatasetManifestPayload | null) => boolean,
  options: { timeoutMs?: number; pollIntervalMs?: number; label?: string; log?: (line: string) => void } = {}
): Promise<DatasetManifestPayload | null> {
  const timeout = options.timeoutMs ?? 120_000;
  const pollInterval = options.pollIntervalMs ?? 2_000;
  const deadline = Date.now() + timeout;
  const label = options.label ?? slug;
  const log = options.log;
  let lastManifest: DatasetManifestPayload | null = null;

  while (Date.now() < deadline) {
    try {
      const manifest = await client.getDatasetManifest(slug);
      lastManifest = manifest ?? null;
      if (predicate(lastManifest)) {
        log?.(`waitForManifestCondition(${label}): predicate satisfied`);
        return lastManifest;
      }
      const partitions = countPublishedPartitions(lastManifest);
      const rows = sumPartitionRows(lastManifest);
      log?.(
        `waitForManifestCondition(${label}): predicate not yet satisfied (partitions=${partitions}, rows=${rows}), retrying`
      );
    } catch (error) {
      log?.(`waitForManifestCondition(${label}): error ${(error as Error)?.message ?? error}`);
    }
    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for manifest condition on dataset ${slug}`);
}

function countPublishedPartitions(manifest: DatasetManifestPayload | null): number {
  if (!manifest) {
    return 0;
  }
  if (manifest.manifests && manifest.manifests.length > 0) {
    return manifest.manifests.reduce(
      (total, entry) => total + (entry.partitions?.length ?? 0),
      0
    );
  }
  return manifest.manifest?.partitions?.length ?? 0;
}

function sumPartitionRows(manifest: DatasetManifestPayload | null): number {
  if (!manifest) {
    return 0;
  }
  const partitions = manifest.manifests && manifest.manifests.length > 0
    ? manifest.manifests.flatMap((entry) => entry.partitions ?? [])
    : manifest.manifest?.partitions ?? [];
  return partitions.reduce((total, partition) => total + (partition?.rowCount ?? 0), 0);
}

async function waitForManifestRows(
  client: TimestoreClient,
  slug: string,
  expectedRows: number,
  options: { timeoutMs?: number; pollIntervalMs?: number; label?: string; log?: (line: string) => void } = {}
) {
  return waitForManifestCondition(
    client,
    slug,
    (manifest) => sumPartitionRows(manifest) >= expectedRows && countPublishedPartitions(manifest) > 0,
    options
  );
}

function assertRowsInclude(
  actualRows: Array<Record<string, unknown>>,
  expectedRows: Array<Record<string, unknown>>,
  label: string
) {
  for (const expected of expectedRows) {
    const keys = Object.keys(expected);
    const matchIndex = actualRows.findIndex((candidate) =>
      keys.every((key) => valuesEqual(expected[key], candidate[key]))
    );
    assert.notEqual(matchIndex, -1, `Expected row not found in ${label}: ${JSON.stringify(expected)}`);
  }
}

function valuesEqual(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'number') {
    const numeric = typeof actual === 'number' ? actual : Number(actual ?? NaN);
    return Number.isFinite(numeric) && Math.abs(numeric - expected) < 1e-9;
  }
  if (typeof expected === 'boolean') {
    return actual === expected;
  }
  if (expected === null || expected === undefined) {
    return actual === expected;
  }
  return String(actual) === String(expected);
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

test('timestore row-threshold flush behavior', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  const flushRowThreshold = Number(process.env.APPHUB_E2E_FLUSH_ROW_THRESHOLD ?? '6');
  process.env.TIMESTORE_TEST_API_ENABLED = process.env.TIMESTORE_TEST_API_ENABLED ?? '1';
  process.env.TIMESTORE_TEST_HOT_BUFFER_ENABLED =
    process.env.TIMESTORE_TEST_HOT_BUFFER_ENABLED ?? '1';
  process.env.TIMESTORE_TEST_HOT_BUFFER_STATE =
    process.env.TIMESTORE_TEST_HOT_BUFFER_STATE ?? 'ready';
  process.env.APPHUB_STREAMING_ENABLED = process.env.APPHUB_STREAMING_ENABLED ?? 'true';
  process.env.TIMESTORE_STREAMING_BUFFER_ENABLED =
    process.env.TIMESTORE_STREAMING_BUFFER_ENABLED ?? 'true';
  process.env.APPHUB_STREAM_BROKER_URL = process.env.APPHUB_STREAM_BROKER_URL ?? 'dummy:9092';
  process.env.TIMESTORE_STREAMING_BATCHERS = process.env.TIMESTORE_STREAMING_BATCHERS ?? '[]';
  process.env.TIMESTORE_STREAMING_CONNECTORS =
    process.env.TIMESTORE_STREAMING_CONNECTORS ?? '[]';
  process.env.TIMESTORE_BULK_CONNECTORS = process.env.TIMESTORE_BULK_CONNECTORS ?? '[]';

  const log = (message: string) => {
    const line = `[timestore-e2e] ${message}`;
    console.log(line);
    t.diagnostic(line);
  };

  log(`configured ingestion flush threshold to ${flushRowThreshold} rows`);
  log(`starting stack (skipUp=${SKIP_STACK})`);
  const stack = await startStack({ skipUp: SKIP_STACK });
  const startedAt = new Date();

  if (!SKIP_STACK && !PRESERVE_STACK) {
    t.after(async () => {
      log('stopping stack');
      await stack.stop();
    });
  } else if (PRESERVE_STACK) {
    log('preserving stack after test run (APPHUB_E2E_PRESERVE_STACK=1)');
  }

  log('waiting for core health');
  await waitForEndpoint(`${CORE_BASE_URL}/health`, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    expectedStatus: [200, 503]
  });
  log('waiting for timestore health');
  await waitForEndpoint(`${TIMESTORE_BASE_URL}/health`, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    expectedStatus: [200, 503]
  });

  const client = new TimestoreClient();

  // Batch dataset exercises ClickHouse ingestion and unified query visibility.
  const batchSlug = `timestore-e2e-batch-${TEST_ID}`;
  const batchBaseTime = Date.UTC(2024, 0, 1, 0, 0, 0);
  const batchSchema = {
    fields: [
      { name: 'timestamp', type: 'timestamp' },
      { name: 'sensor_id', type: 'string' },
      { name: 'value', type: 'double' },
      { name: 'is_online', type: 'boolean' }
    ]
  } as const;
  const batchPartitionKey = {
    key: { window: iso(batchBaseTime), sensor: 'alpha-bravo' },
    attributes: { region: 'iad' }
  } as const;
  const batchQueryRange = {
    start: iso(batchBaseTime - 5 * 60 * 1000),
    end: iso(batchBaseTime + 60 * 60 * 1000)
  };

  const makeBatchRow = (offsetMinutes: number, sensor: string): Record<string, unknown> => ({
    timestamp: iso(batchBaseTime + offsetMinutes * 60_000),
    sensor_id: sensor,
    value: 12 + offsetMinutes / 10,
    is_online: offsetMinutes % 2 === 0
  });

  const batchChunk1 = [0, 5, 10, 15].map((offset, index) =>
    makeBatchRow(offset, index % 2 === 0 ? 'alpha' : 'bravo')
  );
  const batchChunk2 = [20, 25, 30, 35].map((offset, index) =>
    makeBatchRow(offset, index % 2 === 0 ? 'alpha' : 'bravo')
  );
  const batchChunk3 = [40, 45].map((offset, index) =>
    makeBatchRow(offset, index % 2 === 0 ? 'alpha' : 'bravo')
  );

  const allBatchRows: Record<string, unknown>[] = [];

  async function ingestBatchRows(rows: Record<string, unknown>[], label: string) {
    const timeRange = {
      start: String(rows[0]?.timestamp ?? iso(batchBaseTime)),
      end: String(rows[rows.length - 1]?.timestamp ?? iso(batchBaseTime))
    };
    const idempotencyKey = `${label}-${randomUUID()}`;
    log(`ingesting ${rows.length} rows (${label}) into ${batchSlug}`);
    await client.ingestDataset(batchSlug, {
      datasetName: 'E2E Batch Dataset',
      tableName: 'batch_measurements',
      schema: batchSchema,
      partition: {
        ...batchPartitionKey,
        timeRange
      },
      rows,
      idempotencyKey
    });
    allBatchRows.push(...rows);
  }

  await ingestBatchRows(batchChunk1, 'batch-chunk-1');
  await waitForManifestRows(
    client,
    batchSlug,
    allBatchRows.length,
    { label: `${batchSlug}-manifest-initial`, log }
  );
  const batchInitialQuery = await waitForQueryRows(
    client,
    batchSlug,
    {
      timeRange: batchQueryRange,
      timestampColumn: 'timestamp'
    },
    allBatchRows.length,
    { label: `${batchSlug}-initial`, log }
  );
  assertRowsInclude(batchInitialQuery.rows, allBatchRows, `${batchSlug}-initial`);

  await ingestBatchRows(batchChunk2, 'batch-chunk-2');
  await waitForManifestRows(
    client,
    batchSlug,
    allBatchRows.length,
    { label: `${batchSlug}-manifest-second`, log }
  );
  const batchAfterSecondQuery = await waitForQueryRows(
    client,
    batchSlug,
    {
      timeRange: batchQueryRange,
      timestampColumn: 'timestamp'
    },
    allBatchRows.length,
    { label: `${batchSlug}-second`, log }
  );
  assertRowsInclude(batchAfterSecondQuery.rows, allBatchRows, `${batchSlug}-second`);

  await ingestBatchRows(batchChunk3, 'batch-chunk-3');
  await waitForManifestRows(
    client,
    batchSlug,
    allBatchRows.length,
    { label: `${batchSlug}-manifest-final`, log }
  );
  const batchFinalQuery = await waitForQueryRows(
    client,
    batchSlug,
    {
      timeRange: batchQueryRange,
      timestampColumn: 'timestamp'
    },
    allBatchRows.length,
    { label: `${batchSlug}-final`, log }
  );
  assertRowsInclude(batchFinalQuery.rows, allBatchRows, `${batchSlug}-final`);

  const manifestSummary = await client.getDatasetManifest(batchSlug);
  const finalPartitionRows = sumPartitionRows(manifestSummary);
  assert.equal(
    finalPartitionRows,
    allBatchRows.length,
    'manifest row count should equal total ingested rows'
  );

  const batchView = buildViewName(batchSlug);
  await waitForSqlCount(client, batchView, allBatchRows.length, { log });

  // Streaming dataset mirrors the batch assertions and ensures hot-buffer data is surfaced.
  const streamSlug = `timestore-e2e-stream-${TEST_ID}`;
  const streamBaseTime = Date.UTC(2024, 0, 1, 3, 0, 0);
  const streamSchema = {
    fields: [
      { name: 'timestamp', type: 'timestamp' },
      { name: 'sensor_id', type: 'string' },
      { name: 'reading', type: 'double' }
    ]
  } as const;
  const streamPartitionKey = {
    key: { window: iso(streamBaseTime) },
    attributes: { source: 'stream' }
  } as const;
  const streamQueryRange = {
    start: iso(streamBaseTime - 5 * 60 * 1000),
    end: iso(streamBaseTime + 90 * 60 * 1000)
  };

  const makeStreamRow = (offsetMinutes: number, sensor: string): Record<string, unknown> => ({
    timestamp: iso(streamBaseTime + offsetMinutes * 60_000),
    sensor_id: sensor,
    reading: 20 + offsetMinutes / 20
  });

  const streamChunk1 = [0, 6, 12].map((offset, index) =>
    makeStreamRow(offset, index % 2 === 0 ? 'delta' : 'echo')
  );
  const streamChunk2 = [18, 24, 30, 36].map((offset, index) =>
    makeStreamRow(offset, index % 2 === 0 ? 'delta' : 'echo')
  );
  const streamChunk3 = [42, 48].map((offset, index) =>
    makeStreamRow(offset, index % 2 === 0 ? 'delta' : 'echo')
  );
  const hotBufferInserts = [
    makeStreamRow(54, 'delta'),
    makeStreamRow(60, 'foxtrot')
  ];

  const allStreamRows: Record<string, unknown>[] = [];

  async function ingestStreamRows(rows: Record<string, unknown>[], label: string) {
    const timeRange = {
      start: String(rows[0]?.timestamp ?? iso(streamBaseTime)),
      end: String(rows[rows.length - 1]?.timestamp ?? iso(streamBaseTime))
    };
    const idempotencyKey = `${label}-${randomUUID()}`;
    log(`ingesting ${rows.length} rows (${label}) into ${streamSlug}`);
    await client.ingestDataset(streamSlug, {
      datasetName: 'E2E Streaming Dataset',
      tableName: 'stream_measurements',
      schema: streamSchema,
      partition: {
        ...streamPartitionKey,
        timeRange
      },
      rows,
      idempotencyKey
    });
    allStreamRows.push(...rows);
  }

  await ingestStreamRows(streamChunk1, 'stream-chunk-1');
  await waitForManifestRows(
    client,
    streamSlug,
    allStreamRows.length,
    { label: `${streamSlug}-manifest-initial`, log }
  );
  const streamInitialQuery = await waitForQueryRows(
    client,
    streamSlug,
    {
      timeRange: streamQueryRange,
      timestampColumn: 'timestamp'
    },
    allStreamRows.length,
    { label: `${streamSlug}-initial`, log }
  );
  assertRowsInclude(streamInitialQuery.rows, allStreamRows, `${streamSlug}-initial`);

  await ingestStreamRows(streamChunk2, 'stream-chunk-2');
  await waitForManifestRows(
    client,
    streamSlug,
    allStreamRows.length,
    { label: `${streamSlug}-manifest-second`, log }
  );
  const streamAfterSecondQuery = await waitForQueryRows(
    client,
    streamSlug,
    {
      timeRange: streamQueryRange,
      timestampColumn: 'timestamp'
    },
    allStreamRows.length,
    { label: `${streamSlug}-second`, log }
  );
  assertRowsInclude(streamAfterSecondQuery.rows, allStreamRows, `${streamSlug}-second`);

  await ingestStreamRows(streamChunk3, 'stream-chunk-3');
  await waitForManifestRows(
    client,
    streamSlug,
    allStreamRows.length,
    { label: `${streamSlug}-manifest-final`, log }
  );
  const streamFinalIngestQuery = await waitForQueryRows(
    client,
    streamSlug,
    {
      timeRange: streamQueryRange,
      timestampColumn: 'timestamp'
    },
    allStreamRows.length,
    { label: `${streamSlug}-final-ingest`, log }
  );
  assertRowsInclude(streamFinalIngestQuery.rows, allStreamRows, `${streamSlug}-final-ingest`);

  log(`injecting ${hotBufferInserts.length} rows into hot buffer for ${streamSlug}`);
  await client.updateHotBuffer(streamSlug, {
    watermark: iso(streamBaseTime + 70 * 60 * 1000),
    rows: hotBufferInserts.map((row) => ({
      timestamp: String(row.timestamp),
      payload: row
    }))
  });

  const streamExpectedWithHotBuffer = [...allStreamRows, ...hotBufferInserts];
  const streamFinalQuery = await waitForQueryRows(
    client,
    streamSlug,
    {
      timeRange: streamQueryRange,
      timestampColumn: 'timestamp'
    },
    streamExpectedWithHotBuffer.length,
    { label: `${streamSlug}-with-hot-buffer`, log }
  );
  assertRowsInclude(streamFinalQuery.rows, streamExpectedWithHotBuffer, `${streamSlug}-with-hot-buffer`);
  assert.ok(streamFinalQuery.streaming, 'streaming metadata should be populated');
  assert.equal((streamFinalQuery.streaming as Record<string, unknown>)?.bufferState, 'ready');
  assert.equal(streamFinalQuery.sources?.hotBuffer.rows ?? 0, hotBufferInserts.length);

  // SQL visibility for streaming datasets should include ClickHouse-backed ingestion data.
  const streamView = buildViewName(streamSlug);
  await waitForSqlCount(client, streamView, allStreamRows.length, { log });

  // Schema discovery should expose both datasets.
  const schemaSnapshot = await client.getSqlSchema();
  const tableNames = schemaSnapshot.tables.map((table) => table.name);
  assert.ok(tableNames.includes(batchView), `expected ${batchView} in SQL schema`);
  assert.ok(tableNames.includes(streamView), `expected ${streamView} in SQL schema`);

  const logOutput = await stack.collectLogs({ since: startedAt }).catch(() => '');
  if (logOutput) {
    const logAnalysis = analyzeLogs(logOutput);
    assert.equal(logAnalysis.errors.length, 0, `stack errors detected: ${logAnalysis.errors.join('\n')}`);

    const logsDir = path.resolve(process.cwd(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `timestore-e2e-${TEST_ID}.log`);
    await fs.writeFile(logPath, logOutput, 'utf8');
  }
});
