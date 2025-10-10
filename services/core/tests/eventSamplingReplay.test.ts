import './setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createEmbeddedPostgres, stopEmbeddedPostgres } from '@apphub/test-helpers';
import type EmbeddedPostgres from 'embedded-postgres';

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
  const dataDir = await mkdtemp(path.join(tmpdir(), 'apphub-event-sampling-replay-db-'));
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
  process.env.PGPOOL_MAX = '6';

  return async () => {
    try {
    await stopEmbeddedPostgres(postgres);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function run(): Promise<void> {
  const stopDatabase = await startDatabase();
  const previousRepoRoot = process.env.APPHUB_REPO_ROOT;

  process.env.APPHUB_EVENTS_MODE = 'inline';
  process.env.REDIS_URL = 'inline';
  process.env.APPHUB_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

  let db: typeof import('../src/db') | null = null;
  let replayModule: typeof import('../src/eventSamplingReplay') | null = null;
  let samplingModule: typeof import('../src/db/workflowEventSamples') | null = null;
  let replayMetricsModule: typeof import('../src/db/workflowEventSamplingReplay') | null = null;

  try {
    db = await import('../src/db');
    replayModule = await import('../src/eventSamplingReplay');
    samplingModule = await import('../src/db/workflowEventSamples');
    replayMetricsModule = await import('../src/db/workflowEventSamplingReplay');

    await db.ensureDatabase();

    const jobDefinition = await db.createJobDefinition({
      slug: 'sample-job',
      name: 'Sample Job',
      type: 'task',
      runtime: 'node',
      entryPoint: 'index.js'
    });

    const workflowDefinition = await db.createWorkflowDefinition({
      slug: 'sample-workflow',
      name: 'Sample Workflow',
      steps: [
        {
          id: 'step-a',
          name: 'Step A',
          type: 'job',
          jobSlug: 'sample-job'
        }
      ]
    });

    const workflowRun = await db.createWorkflowRun(workflowDefinition.id, { status: 'running' });
    const jobRun = await db.createJobRun(jobDefinition.id);

    await db.createWorkflowRunStep(workflowRun.id, {
      stepId: 'step-a',
      status: 'succeeded',
      jobRunId: jobRun.id,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    const replayEventId = `evt-${randomUUID()}`;
    await db.insertWorkflowEvent({
      id: replayEventId,
      type: 'sample.created',
      source: 'core.test',
      occurredAt: new Date().toISOString(),
      payload: { foo: 'bar' },
      correlationId: jobRun.id,
      metadata: null
    });

    const summary = await replayModule.replayWorkflowEventSampling({ lookbackMs: 60 * 60 * 1000, limit: 10 });
    assert.equal(summary.succeeded, 1, 'expected one successful replay');
    assert.equal(summary.failed, 0, 'unexpected replay failure');

    const snapshot = await samplingModule.getWorkflowEventProducerSamplingSnapshot();
    assert.equal(snapshot.totals.sampleCount, 1, 'sample count should reflect replayed event');
    assert.equal(snapshot.replay.metrics.succeeded, 1, 'replay metrics should capture success');
    assert.equal(snapshot.replay.pending, 0, 'no pending events after successful replay');

    const metrics = await replayMetricsModule.getEventSamplingReplayMetrics();
    assert.equal(metrics.total, 1, 'metrics should track replay attempts');
    assert.equal(metrics.failed, 0, 'no failures expected');

    const repeatSummary = await replayModule.replayWorkflowEventSampling({ lookbackMs: 60 * 60 * 1000, limit: 10 });
    assert.equal(repeatSummary.processed, 0, 'replay should skip already processed events');
    assert.equal(repeatSummary.succeeded, 0, 'no additional successes expected');

    const missingCorrelationId = `evt-${randomUUID()}`;
    await db.insertWorkflowEvent({
      id: missingCorrelationId,
      type: 'sample.created',
      source: 'core.test',
      occurredAt: new Date().toISOString(),
      payload: {},
      correlationId: 'missing-run',
      metadata: null
    });

    const failureSummary = await replayModule.replayWorkflowEventSampling({ lookbackMs: 60 * 60 * 1000, limit: 10 });
    assert.equal(failureSummary.failed, 1, 'expected failure for missing workflow context');

    const updatedMetrics = await replayMetricsModule.getEventSamplingReplayMetrics();
    assert.equal(updatedMetrics.failed, 1, 'failure metrics should reflect missing context');
    assert(updatedMetrics.lastFailure, 'last failure metadata should be populated');
  } finally {
    if (db) {
      await db.closePool().catch(() => undefined);
    }
    if (previousRepoRoot === undefined) {
      delete process.env.APPHUB_REPO_ROOT;
    } else {
      process.env.APPHUB_REPO_ROOT = previousRepoRoot;
    }
    delete process.env.APPHUB_EVENTS_MODE;
    delete process.env.REDIS_URL;
    await stopDatabase();
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
