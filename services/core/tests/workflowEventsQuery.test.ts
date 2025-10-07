import './setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';
import { randomUUID } from 'node:crypto';
import type { WorkflowEventCursor, WorkflowEventInsert } from '../src/db/types';

async function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to determine port for embedded postgres')));
      }
    });
  });
}

async function startDatabase(): Promise<() => Promise<void>> {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'apphub-workflow-events-db-'));
  const port = await allocatePort();
  const postgres: EmbeddedPostgres = createEmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.PGPOOL_MAX = '4';

  return async () => {
    try {
    await stopEmbeddedPostgres(postgres);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function seedEvents(insertWorkflowEventFn: (event: WorkflowEventInsert) => Promise<unknown>): Promise<void> {
  const baseOccurred = new Date('2024-01-01T00:00:00Z');
  const samples = [
    {
      id: 'evt-001',
      type: 'asset.produced',
      source: 'core.assets',
      occurredAt: new Date(baseOccurred.getTime() + 5_000).toISOString(),
      payload: {
        workflow: { id: 'wf-alpha' },
        severity: 'warning'
      },
      correlationId: 'corr-1'
    },
    {
      id: 'evt-002',
      type: 'metastore.record.updated',
      source: 'metastore.api',
      occurredAt: new Date(baseOccurred.getTime() + 4_000).toISOString(),
      payload: {
        namespace: 'configs',
        key: 'search',
        record: { namespace: 'configs', key: 'search' }
      },
      correlationId: 'corr-2'
    },
    {
      id: 'evt-003',
      type: 'filestore.node.created',
      source: 'filestore.worker',
      occurredAt: new Date(baseOccurred.getTime() + 3_000).toISOString(),
      payload: {
        backendMountId: 42,
        nodeId: 7,
        path: '/datasets/run-7/output.parquet'
      }
    },
    {
      id: 'evt-004',
      type: 'timestore.partition.created',
      source: 'timestore.ingest',
      occurredAt: new Date(baseOccurred.getTime() + 2_000).toISOString(),
      payload: {
        datasetId: 'ds-1',
        datasetSlug: 'weather',
        manifestId: 'mf-1',
        partitionId: 'part-1',
        partitionKey: '2024-01-01',
        storageTargetId: 'st-1',
        filePath: 'weather/2024-01-01.parquet',
        rowCount: 100,
        fileSizeBytes: 2048,
        receivedAt: new Date(baseOccurred.getTime() + 2_100).toISOString()
      }
    },
    {
      id: 'evt-005',
      type: 'workflow.event.test',
      source: 'test.source',
      occurredAt: new Date(baseOccurred.getTime() + 1_000).toISOString(),
      payload: {
        workflow: { id: 'wf-beta' },
        context: { severity: 'error' }
      },
      correlationId: 'corr-1'
    }
  ];

  for (const sample of samples) {
    await insertWorkflowEventFn({
      id: sample.id,
      type: sample.type,
      source: sample.source,
      occurredAt: sample.occurredAt,
      payload: sample.payload,
      correlationId: sample.correlationId ?? null
    });
  }
}

async function run(): Promise<void> {
  const stop = await startDatabase();
  let db: typeof import('../src/db') | null = null;
  try {
    db = await import('../src/db');
    await db.ensureDatabase();
    await seedEvents(db.insertWorkflowEvent);

    const firstPage = await db.listWorkflowEvents({ limit: 2 });
    assert.equal(firstPage.events.length, 2, 'returns first page of events');
    assert.equal(firstPage.hasMore, true, 'paginates when more records exist');
    assert.ok(firstPage.nextCursor, 'next cursor emitted');

    const nextCursor = firstPage.nextCursor as WorkflowEventCursor;
    const secondPage = await db.listWorkflowEvents({ cursor: nextCursor, limit: 2 });
    assert.equal(secondPage.events.length, 2, 'second page returns next items');
    assert.equal(secondPage.events[0].id, 'evt-003');
    assert.equal(secondPage.events[1].id, 'evt-004');

    const correlationFiltered = await db.listWorkflowEvents({ correlationId: 'corr-1', limit: 10 });
    assert.deepEqual(
      correlationFiltered.events.map((event) => event.id),
      ['evt-001', 'evt-005'],
      'filters by correlation id'
    );

    const jsonFiltered = await db.listWorkflowEvents({
      jsonPath: '$.payload.workflow.id == "wf-alpha"',
      limit: 5
    });
    assert.ok(jsonFiltered.events.some((event) => event.id === 'evt-001'));
  } finally {
    if (db) {
      await db.closePool().catch(() => undefined);
    }
    await stop();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
