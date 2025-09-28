import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { EventEnvelope, JsonValue } from '@apphub/event-bus';

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
  const dataDir = await mkdtemp(path.join(tmpdir(), 'apphub-event-sampling-db-'));
  const port = await allocatePort();
  const postgres = new EmbeddedPostgres({
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
  process.env.PGPOOL_MAX = '6';

  return async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function run(): Promise<void> {
  const stopDatabase = await startDatabase();
  const previousEventsMode = process.env.APPHUB_EVENTS_MODE;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousRepoRoot = process.env.APPHUB_REPO_ROOT;

  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

  let db: typeof import('../src/db') | null = null;
  let queueModule: typeof import('../src/queue') | null = null;
  let queueManagerModule: typeof import('../src/queueManager') | null = null;
  let serverModule: typeof import('../src/server') | null = null;
  let app: import('fastify').FastifyInstance | null = null;

  try {
    db = await import('../src/db');
    queueModule = await import('../src/queue');
    queueManagerModule = await import('../src/queueManager');
    const { ingestWorkflowEvent } = await import('../src/workflowEvents');

    await db.ensureDatabase();

    const baseOccurred = new Date();
    const workflowMetadata = {
      __apphubWorkflow: {
        workflowDefinitionId: 'wf-test',
        workflowRunId: 'run-test',
        workflowRunStepId: 'step-test',
        jobRunId: 'jobrun-test',
        jobSlug: 'test-job'
      }
    } as Record<string, JsonValue>;

    const { enqueueWorkflowEvent } = queueModule;

    await enqueueWorkflowEvent({
      id: randomUUID(),
      type: 'catalog.sample.created',
      source: 'catalog.worker',
      occurredAt: new Date(baseOccurred.getTime() + 1_000),
      payload: { foo: 'bar' },
      metadata: workflowMetadata
    });

    await enqueueWorkflowEvent({
      id: randomUUID(),
      type: 'catalog.sample.created',
      source: 'catalog.worker',
      occurredAt: new Date(baseOccurred.getTime() + 5_000),
      payload: { foo: 'baz' },
      metadata: workflowMetadata
    });

    const snapshot = await db.getWorkflowEventProducerSamplingSnapshot({
      staleBefore: new Date(Date.now() - 60_000).toISOString()
    });

    assert.equal(snapshot.totals.rows, 1, 'should track a single producer edge');
    assert.equal(snapshot.totals.sampleCount, 2, 'should accumulate sample counts');
    assert.equal(snapshot.perJob.length, 1, 'should summarize single job');
    assert.equal(snapshot.perJob[0]?.sampleCount, 2, 'job summary includes sample count');
    assert.equal(snapshot.perJob[0]?.workflowDefinitionIds.length, 1, 'captures workflow ids');
    assert(snapshot.stale.length === 0, 'recent samples are not stale');

    const invalidEnvelope: EventEnvelope = {
      id: randomUUID(),
      type: 'catalog.sample.created',
      source: 'catalog.worker',
      occurredAt: new Date(baseOccurred.getTime() + 10_000).toISOString(),
      payload: {},
      correlationId: undefined,
      ttl: undefined,
      metadata: {
        __apphubWorkflow: {
          workflowDefinitionId: 'wf-invalid',
          workflowRunId: 'run-invalid',
          workflowRunStepId: '',
          jobRunId: 'job-invalid',
          jobSlug: 'invalid-job'
        }
      }
    };

    await ingestWorkflowEvent(invalidEnvelope);

    const postInvalidSnapshot = await db.getWorkflowEventProducerSamplingSnapshot({
      staleBefore: null
    });

    assert.equal(
      postInvalidSnapshot.totals.sampleCount,
      2,
      'invalid metadata should not change sample counters'
    );

    serverModule = await import('../src/server');
    app = await serverModule.buildServer();
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/admin/event-sampling' });
    assert.equal(response.statusCode, 200, 'admin endpoint returns 200');
    const body = response.json() as {
      data?: {
        totals: { sampleCount: number };
        perJob: Array<{ jobSlug: string; sampleCount: number }>;
      };
    };
    assert(body.data, 'admin response includes data block');
    assert.equal(body.data?.totals.sampleCount, 2, 'admin snapshot reflects sample count');
    assert.equal(body.data?.perJob?.[0]?.jobSlug, 'test-job', 'admin snapshot lists job slug');
  } finally {
    if (app) {
      await app.close();
    }
    if (queueManagerModule) {
      await queueManagerModule.queueManager.closeConnection().catch(() => undefined);
    }
    if (db) {
      await db.closePool().catch(() => undefined);
    }

    if (previousEventsMode === undefined) {
      delete process.env.APPHUB_EVENTS_MODE;
    } else {
      process.env.APPHUB_EVENTS_MODE = previousEventsMode;
    }
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
    }
    if (previousRepoRoot === undefined) {
      delete process.env.APPHUB_REPO_ROOT;
    } else {
      process.env.APPHUB_REPO_ROOT = previousRepoRoot;
    }

    await stopDatabase();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
