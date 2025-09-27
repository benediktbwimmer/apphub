import '@apphub/catalog-tests/setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { startTimestoreTestServer, type TimestoreTestServer } from '../helpers/timestore';
import { startFilestoreTestServer, type FilestoreTestServer } from '../helpers/filestore';
import { listExampleWorkflowDefinitions } from '../helpers/examples';
import type { WorkflowDefinitionCreateInput } from '../../../services/catalog/src/workflows/zodSchemas';
import { runWorkflowOrchestration } from '../../../services/catalog/src/workflowOrchestrator';
import { resetDatabasePool } from '../../../services/catalog/src/db/client';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import {
  validateEventEnvelope,
  type EventIngressJobData,
  type EventEnvelope
} from '@apphub/event-bus';
import {
  EVENT_QUEUE_NAME,
  EVENT_TRIGGER_QUEUE_NAME,
  WORKFLOW_QUEUE_NAME,
  getQueueConnection,
  type EventTriggerJobData
} from '../../../services/catalog/src/queue';
import { registerSourceEvent } from '../../../services/catalog/src/eventSchedulerState';
import { ingestWorkflowEvent } from '../../../services/catalog/src/workflowEvents';
import { processEventTriggersForEnvelope } from '../../../services/catalog/src/eventTriggerProcessor';
import { TIMESTORE_INGEST_QUEUE_NAME } from '../../../services/timestore/src/queue';
import { processIngestionJob } from '../../../services/timestore/src/ingestion/processor';
import type { IngestionJobPayload } from '../../../services/timestore/src/ingestion/types';
import {
  resolveWorkflowProvisioningPlan,
  type ExampleJobSlug,
  type ExampleWorkflowSlug,
  type JsonValue,
  type WorkflowDefinitionTemplate,
  type WorkflowProvisioningEventTrigger,
  type WorkflowProvisioningSchedule
} from '@apphub/examples-registry';
import { runE2E } from '@apphub/test-helpers';
import { Pool } from 'pg';

type WorkflowRunResponse = {
  data: {
    id: string;
    status: string;
    partitionKey: string | null;
  };
};

const OPERATOR_TOKEN = 'observatory-e2e-operator-token';

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'observatory-e2e',
    token: OPERATOR_TOKEN,
    scopes: [
      'job-bundles:write',
      'job-bundles:read',
      'workflows:write',
      'workflows:read',
      'workflows:run'
    ]
  }
]);
process.env.APPHUB_EVENTS_MODE = 'redis';
process.env.APPHUB_DISABLE_ANALYTICS = '1';

let activeRedisUrl: string | null = null;

const OBSERVATORY_BUNDLE_SLUGS: ExampleJobSlug[] = [
  'observatory-data-generator',
  'observatory-inbox-normalizer',
  'observatory-timestore-loader',
  'observatory-visualization-runner',
  'observatory-report-publisher'
];

const OBSERVATORY_ROWS_PER_INSTRUMENT = 6;
const OBSERVATORY_INTERVAL_MINUTES = 1;

const OBSERVATORY_WORKFLOW_SLUGS: ExampleWorkflowSlug[] = [
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication'
];

function isProvisioningObject(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function compactRecord<T extends Record<string, unknown>>(record: T): T {
  for (const key of Object.keys(record)) {
    if (record[key] === undefined) {
      delete record[key];
    }
  }
  return record;
}

function provisioningMetadataValue(metadata: JsonValue | undefined, path: string): unknown {
  if (!isProvisioningObject(metadata)) {
    return undefined;
  }
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current: unknown = metadata;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isNaN(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function buildSchedulePayload(schedule: WorkflowProvisioningSchedule) {
  const parameters = schedule.parameters && Object.keys(schedule.parameters).length > 0
    ? schedule.parameters
    : undefined;
  return compactRecord({
    name: schedule.name,
    description: schedule.description,
    cron: schedule.cron,
    timezone: schedule.timezone ?? undefined,
    startWindow: schedule.startWindow ?? undefined,
    endWindow: schedule.endWindow ?? undefined,
    catchUp: schedule.catchUp ?? undefined,
    isActive: schedule.isActive ?? undefined,
    parameters
  });
}

function pruneProvisioningParameterTemplate(
  metadata: JsonValue | undefined,
  template: Record<string, JsonValue> | undefined
): Record<string, JsonValue> | undefined {
  if (!template || Object.keys(template).length === 0) {
    return undefined;
  }
  const result: Record<string, JsonValue> = { ...template };
  const metadataPattern = /^{{\s*trigger\.metadata\.([^.}]+(?:\.[^.}]+)*)\s*}}$/;
  for (const [key, value] of Object.entries(template)) {
    if (typeof value !== 'string') {
      continue;
    }
    const match = metadataPattern.exec(value.trim());
    if (!match) {
      continue;
    }
    const resolved = provisioningMetadataValue(metadata, match[1]);
    if (resolved === null || resolved === undefined || resolved === '') {
      delete result[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildTriggerPayload(trigger: WorkflowProvisioningEventTrigger) {
  const parameterTemplate = pruneProvisioningParameterTemplate(trigger.metadata, trigger.parameterTemplate);
  const predicates = trigger.predicates.length > 0 ? trigger.predicates : undefined;
  const metadataPayload = trigger.metadata ?? undefined;
  return compactRecord({
    name: trigger.name,
    description: trigger.description,
    eventType: trigger.eventType,
    eventSource: trigger.eventSource ?? undefined,
    predicates,
    parameterTemplate,
    metadata: metadataPayload,
    throttleWindowMs: trigger.throttleWindowMs,
    throttleCount: trigger.throttleCount,
    maxConcurrency: trigger.maxConcurrency,
    idempotencyKeyExpression: trigger.idempotencyKeyExpression,
    status: trigger.status
  });
}

async function applyWorkflowProvisioning(
  app: FastifyInstance,
  workflow: WorkflowDefinitionCreateInput
): Promise<void> {
  const plan = resolveWorkflowProvisioningPlan(workflow as unknown as WorkflowDefinitionTemplate);
  if (plan.schedules.length === 0 && plan.eventTriggers.length === 0) {
    return;
  }

  const workflowSlug = workflow.slug;
  const authHeaders = { Authorization: `Bearer ${OPERATOR_TOKEN}` };

  const existingSchedules = new Map<string, { id: string }>();
  if (plan.schedules.length > 0) {
    const scheduleResponse = await app.inject({ method: 'GET', url: '/workflow-schedules', headers: authHeaders });
    if (scheduleResponse.statusCode !== 200) {
      throw new Error(`Failed to list workflow schedules (${scheduleResponse.statusCode})`);
    }
    const schedulePayload = JSON.parse(scheduleResponse.payload) as {
      data?: Array<{ schedule?: { id: string; name: string | null }; workflow?: { slug?: string | null } }>;
    };
    for (const entry of schedulePayload.data ?? []) {
      if (!entry.schedule || entry.workflow?.slug !== workflowSlug) {
        continue;
      }
      const key = entry.schedule.name ?? '__default__';
      existingSchedules.set(key, { id: entry.schedule.id });
    }
  }

  const existingTriggers = new Map<string, { id: string }>();
  if (plan.eventTriggers.length > 0) {
    const triggerResponse = await app.inject({
      method: 'GET',
      url: `/workflows/${workflowSlug}/triggers`,
      headers: authHeaders
    });
    if (triggerResponse.statusCode !== 200) {
      throw new Error(`Failed to list workflow triggers (${triggerResponse.statusCode})`);
    }
    const triggerPayload = JSON.parse(triggerResponse.payload) as {
      data?: { triggers?: Array<{ id: string; name: string | null }> };
    };
    for (const entry of triggerPayload.data?.triggers ?? []) {
      const key = entry.name ?? '__default__';
      existingTriggers.set(key, { id: entry.id });
    }
  }

  for (const schedule of plan.schedules) {
    const scheduleKey = schedule.name ?? '__default__';
    const payload = buildSchedulePayload(schedule);
    const existing = existingSchedules.get(scheduleKey);
    if (existing) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/workflow-schedules/${existing.id}`,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: JSON.stringify(payload)
      });
      if (response.statusCode !== 200) {
        throw new Error(`Failed to update schedule (${response.statusCode})`);
      }
    } else {
      const response = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowSlug}/schedules`,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: JSON.stringify(payload)
      });
      if (response.statusCode !== 201 && response.statusCode !== 409) {
        throw new Error(`Failed to create schedule (${response.statusCode})`);
      }
    }
  }

  for (const trigger of plan.eventTriggers) {
    const triggerKey = trigger.name ?? '__default__';
    const payload = buildTriggerPayload(trigger);
    const existing = existingTriggers.get(triggerKey);
    if (existing) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/workflows/${workflowSlug}/triggers/${existing.id}`,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: JSON.stringify(payload)
      });
      if (response.statusCode !== 200) {
        throw new Error(`Failed to update trigger (${response.statusCode})`);
      }
    } else {
      const response = await app.inject({
        method: 'POST',
        url: `/workflows/${workflowSlug}/triggers`,
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        payload: JSON.stringify(payload)
      });
      if (response.statusCode !== 201 && response.statusCode !== 409) {
        throw new Error(`Failed to create trigger (${response.statusCode})`);
      }
    }
  }
}

type ServerContext = {
  timestore: TimestoreTestServer;
  filestore: FilestoreTestServer;
};

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;
let embeddedDatabaseUrl: string | null = null;

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    if (embeddedDatabaseUrl) {
      process.env.DATABASE_URL = embeddedDatabaseUrl;
    }
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-observatory-pg-'));
  const port = await findAvailablePort();

  const postgres = new EmbeddedPostgres({
    databaseDir: dataRoot,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: false
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase('apphub');

  embeddedDatabaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
  process.env.DATABASE_URL = embeddedDatabaseUrl;
  process.env.PGPOOL_MAX = '8';

  embeddedPostgresCleanup = async () => {
    try {
      await postgres.stop();
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  };
  embeddedPostgres = postgres;
}

async function shutdownEmbeddedPostgres(): Promise<void> {
  const cleanup = embeddedPostgresCleanup;
  embeddedPostgres = null;
  embeddedPostgresCleanup = null;
  embeddedDatabaseUrl = null;
  if (cleanup) {
    await cleanup();
  }
}

async function findAvailablePort(): Promise<number> {
  const net = await import('node:net');
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
        server.close(() => reject(new Error('Failed to determine available port')));
      }
    });
  });
}

async function withServer(fn: (app: FastifyInstance, context: ServerContext) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  const previousRedisUrl = process.env.REDIS_URL;
  const redisUrl = previousRedisUrl ?? 'redis://127.0.0.1:6379';
  process.env.REDIS_URL = redisUrl;
  activeRedisUrl = redisUrl;
  await resetDatabasePool();

  const timestore = await startTimestoreTestServer({
    databaseUrl:
      embeddedDatabaseUrl ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/apphub',
    redisUrl,
    keepStorageRoot: process.env.OBSERVATORY_KEEP_STORAGE === '1'
  });

  const filestore = await startFilestoreTestServer({
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/apphub',
    redisUrl
  });

  const storageDir = await mkdtemp(path.join(tmpdir(), 'apphub-observatory-bundles-'));
  const previousStorageDir = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageDir;

  const serviceConfigDir = await mkdtemp(path.join(tmpdir(), 'apphub-observatory-services-'));
  const serviceConfigPath = path.join(serviceConfigDir, 'service-config.json');
  await writeFile(serviceConfigPath, `${JSON.stringify({ module: 'local/test', services: [], networks: [] }, null, 2)}
`, 'utf8');
  const previousServiceConfig = process.env.SERVICE_CONFIG_PATH;
  process.env.SERVICE_CONFIG_PATH = `!${serviceConfigPath}`;

  const { buildServer } = await import('@apphub/catalog/server');
  const app = await buildServer();
  await app.ready();

  try {
    await fn(app, { timestore, filestore });
  } finally {
    await app.close();
    await timestore.close();
    await filestore.close();
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
      activeRedisUrl = null;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
      activeRedisUrl = previousRedisUrl;
    }
    if (previousServiceConfig === undefined) {
      delete process.env.SERVICE_CONFIG_PATH;
    } else {
      process.env.SERVICE_CONFIG_PATH = previousServiceConfig;
    }
    await rm(serviceConfigDir, { recursive: true, force: true });

    if (previousStorageDir === undefined) {
      delete process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
    } else {
      process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = previousStorageDir;
    }
    await rm(storageDir, { recursive: true, force: true });
  }
}


async function enqueueExampleBundles(app: FastifyInstance, slugs: readonly string[]): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: '/examples/load',
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`,
      'Content-Type': 'application/json'
    },
    payload: { slugs }
  });
  assert.equal(response.statusCode, 202, `Failed to enqueue bundles: ${response.payload}`);
}

async function waitForExampleBundles(app: FastifyInstance, slugs: readonly string[]): Promise<void> {
  const remaining = new Set(slugs.map((slug) => slug.toLowerCase()));
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/examples/bundles/status',
      headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
    });
    assert.equal(statusResponse.statusCode, 200, `Status check failed: ${statusResponse.payload}`);
    const statusBody = JSON.parse(statusResponse.payload) as {
      data: { statuses: Array<{ slug: string; state: string; error?: string | null }> };
    };

    for (const entry of statusBody.data.statuses ?? []) {
      const normalized = entry.slug.toLowerCase();
      if (!remaining.has(normalized)) {
        continue;
      }
      if (entry.state === 'completed') {
        remaining.delete(normalized);
      } else if (entry.state === 'failed') {
        throw new Error(`Example bundle ${entry.slug} failed to package: ${entry.error ?? 'unknown error'}`);
      }
    }

    if (remaining.size === 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Timed out waiting for bundles: ${Array.from(remaining).join(', ')}`);
}

async function importExampleBundle(app: FastifyInstance, slug: string): Promise<void> {
  const previewResponse = await app.inject({
    method: 'POST',
    url: '/job-imports/preview',
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    payload: { source: 'example', slug }
  });
  assert.equal(previewResponse.statusCode, 200, `Preview failed for ${slug}: ${previewResponse.payload}`);
  const previewBody = JSON.parse(previewResponse.payload) as {
    data: { bundle: { slug: string; version: string } };
  };
  const reference = `${previewBody.data.bundle.slug}@${previewBody.data.bundle.version}`;

  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/job-imports',
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    payload: { source: 'example', slug, reference }
  });
  assert.equal(confirmResponse.statusCode, 201, `Import failed for ${slug}: ${confirmResponse.payload}`);
}

async function importExampleWorkflows(
  app: FastifyInstance,
  definitions: WorkflowDefinitionCreateInput[]
): Promise<void> {
  for (const workflow of definitions) {
    const response = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(workflow)
    });
    if (response.statusCode !== 201 && response.statusCode !== 409) {
      assert.fail(`Failed to import workflow ${workflow.slug}: ${response.payload}`);
    }
    await applyWorkflowProvisioning(app, workflow);
  }
}

async function fetchWorkflowRun(app: FastifyInstance, runId: string) {
  const response = await app.inject({ method: 'GET', url: `/workflow-runs/${runId}` });
  if (response.statusCode !== 200) {
    return null;
  }
  return JSON.parse(response.payload) as {
    data: {
      id: string;
      status: string;
      errorMessage?: string | null;
      context?: unknown;
    };
  };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runWorkflow(
  app: FastifyInstance,
  slug: string,
  partitionKey: string | undefined,
  parameters: Record<string, unknown>
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: `/workflows/${slug}/run`,
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    payload: partitionKey ? { partitionKey, parameters } : { parameters }
  });
  assert.equal(response.statusCode, 202, `Workflow ${slug} run failed: ${response.payload}`);
  const body = JSON.parse(response.payload) as WorkflowRunResponse;
  if (body.data.status === 'succeeded') {
    return body.data.id;
  }

  const runId = body.data.id;
  await runWorkflowOrchestration(runId).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.fail(`Workflow ${slug} orchestration failed: ${message}`);
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    await drainBackgroundQueues();
    const runDetails = await fetchWorkflowRun(app, runId);
    if (!runDetails) {
      await delay(100);
      continue;
    }
    const status = runDetails.data.status;
    if (status === 'succeeded') {
      return runId;
    }
    if (status === 'pending' || status === 'running') {
      await delay(200);
      continue;
    }
    if (status === 'failed' || status === 'canceled' || status === 'expired') {
      const detailSnippet = JSON.stringify(runDetails.data, null, 2);
      assert.fail(`Workflow ${slug} did not succeed (status=${status}). Details: ${detailSnippet}`);
    }
    await delay(200);
  }

  const finalDetails = await fetchWorkflowRun(app, runId);
  const finalSnippet = finalDetails ? JSON.stringify(finalDetails.data, null, 2) : 'unavailable';
  assert.fail(`Workflow ${slug} did not complete within timeout. Last details: ${finalSnippet}`);
}

async function drainBackgroundQueues(): Promise<void> {
  let connection;
  try {
    connection = getQueueConnection();
  } catch {
    return;
  }

  const eventQueue = new Queue<EventIngressJobData>(EVENT_QUEUE_NAME, { connection });
  const eventTriggerQueue = new Queue<EventTriggerJobData>(EVENT_TRIGGER_QUEUE_NAME, { connection });
  const workflowQueue = new Queue<{ workflowRunId?: string }>(WORKFLOW_QUEUE_NAME, { connection });

  try {
    for (let iteration = 0; iteration < 25; iteration += 1) {
      const processedEvents = await flushEventQueue(eventQueue);
      const processedTriggers = await flushEventTriggerQueue(eventTriggerQueue);
      const processedWorkflows = await flushWorkflowQueue(workflowQueue);
      const processedTimestore = await flushTimestoreIngestionQueue();
      if (!processedEvents && !processedTriggers && !processedWorkflows && !processedTimestore) {
        break;
      }
    }
  } finally {
    await Promise.all([eventQueue.close(), eventTriggerQueue.close(), workflowQueue.close()]);
  }
}

async function flushEventQueue(queue: Queue<EventIngressJobData>): Promise<boolean> {
  const jobs = await queue.getJobs(['waiting', 'delayed']);
  if (jobs.length === 0) {
    return false;
  }

  for (const job of jobs) {
    const envelope = validateEventEnvelope(job.data.envelope);
    await ingestWorkflowEvent(envelope);
    const evaluation = registerSourceEvent(envelope.source ?? 'unknown');
    if (evaluation.allowed) {
      await processEventTriggersForEnvelope(envelope);
    }
    await job.remove();
  }

  return true;
}

async function flushEventTriggerQueue(queue: Queue<EventTriggerJobData>): Promise<boolean> {
  const jobs = await queue.getJobs(['waiting', 'delayed']);
  if (jobs.length === 0) {
    return false;
  }

  for (const job of jobs) {
    const envelope = job.data.envelope as EventEnvelope | undefined;
    if (envelope) {
      await processEventTriggersForEnvelope(envelope);
    }
    await job.remove();
  }

  return true;
}

async function flushWorkflowQueue(queue: Queue<{ workflowRunId?: string }>): Promise<boolean> {
  const jobs = await queue.getJobs(['waiting', 'delayed']);
  if (jobs.length === 0) {
    return false;
  }

  for (const job of jobs) {
    const { workflowRunId } = job.data ?? {};
    if (typeof workflowRunId === 'string' && workflowRunId.trim()) {
      await runWorkflowOrchestration(workflowRunId);
    }
    await job.remove();
  }

  return true;
}

async function flushTimestoreIngestionQueue(): Promise<boolean> {
  const redisUrl = activeRedisUrl;
  if (!redisUrl) {
    return false;
  }

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue<IngestionJobPayload>(TIMESTORE_INGEST_QUEUE_NAME, { connection });

  try {
    const jobs = await queue.getJobs(['waiting', 'delayed']);
    if (jobs.length === 0) {
      return false;
    }

    for (const job of jobs) {
      const payload = job.data as IngestionJobPayload;
      await processIngestionJob(payload);
      await job.remove();
    }

    return true;
  } finally {
    await queue.close();
    await connection.quit();
  }
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, 'utf8');
  return JSON.parse(contents) as T;
}
async function queryTimestoreRowCount(url: string, datasetSlug: string, startIso: string, endIso: string): Promise<number> {
  const response = await fetch(`${url}/datasets/${encodeURIComponent(datasetSlug)}/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      timeRange: { start: startIso, end: endIso },
      timestampColumn: 'timestamp',
      limit: 10000
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Timestore query failed with status ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as { rows?: unknown[] };
  return Array.isArray(payload.rows) ? payload.rows.length : 0;
}

type WorkflowRunSummary = {
  id: string;
  status: string;
  triggeredBy?: string | null;
  partitionKey?: string | null;
  errorMessage?: string | null;
  parameters?: Record<string, unknown> | null;
};

function getRunParameter(run: WorkflowRunSummary, key: string): string | null {
  const parameters = run.parameters;
  if (!parameters || typeof parameters !== 'object') {
    return null;
  }
  const value = (parameters as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

async function waitForWorkflowRunMatching(
  app: FastifyInstance,
  slug: string,
  predicate: (run: WorkflowRunSummary) => boolean,
  options: { description: string; timeoutMs?: number }
): Promise<WorkflowRunSummary> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  let lastRuns: WorkflowRunSummary[] = [];
  while (Date.now() < deadline) {
    await drainBackgroundQueues();
    const response = await app.inject({
      method: 'GET',
      url: `/workflows/${slug}/runs?limit=25`,
      headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
    });
    assert.equal(response.statusCode, 200, `Failed to list runs for ${slug}`);
    const body = JSON.parse(response.payload) as {
      data: { runs: WorkflowRunSummary[] };
    };
    lastRuns = body.data.runs;
    const match = lastRuns.find(predicate);
    if (match) {
      if (match.status === 'succeeded') {
        return match;
      }
      if (match.status === 'failed' || match.status === 'canceled' || match.status === 'expired') {
        const detail = match.errorMessage ?? 'no error message provided';
        assert.fail(
          `Workflow ${slug} run did not succeed (status=${match.status}): ${detail}`
        );
      }
    }
    await delay(100);
  }
  const observed = lastRuns.map((run) => ({
    id: run.id,
    status: run.status,
    partitionKey: run.partitionKey ?? null,
    minute: getRunParameter(run, 'minute'),
    reportedPartition: getRunParameter(run, 'partitionKey')
  }));
  throw new Error(
    `Timed out waiting for workflow ${slug} run (${options.description}). Observed runs: ${JSON.stringify(observed)}`
  );
}

async function runObservatoryScenario(app: FastifyInstance, context: ServerContext): Promise<void> {
  await enqueueExampleBundles(app, OBSERVATORY_BUNDLE_SLUGS);
  await waitForExampleBundles(app, OBSERVATORY_BUNDLE_SLUGS);
  for (const slug of OBSERVATORY_BUNDLE_SLUGS) {
    await importExampleBundle(app, slug);
  }

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'observatory-event-e2e-'));
  const paths = {
    inbox: path.join(tempRoot, 'inbox'),
    staging: path.join(tempRoot, 'staging'),
    archive: path.join(tempRoot, 'archive'),
    plots: path.join(tempRoot, 'plots'),
    reports: path.join(tempRoot, 'reports')
  } as const;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    await Promise.all(
      Object.values(paths).map((dir) => resetDirectory(dir))
    );

    const backendMountId = await ensureFilestoreBackendMount(pool, context.filestore.schema, tempRoot);

    const config = {
      paths,
      filestore: {
        baseUrl: context.filestore.url,
        backendMountId,
        inboxPrefix: 'inbox',
        stagingPrefix: 'staging',
        archivePrefix: 'archive',
        token: null,
        principal: 'observatory-inbox-normalizer'
      },
      timestore: {
        baseUrl: context.timestore.url,
        datasetSlug: 'observatory-timeseries',
        datasetName: 'Observatory Time Series',
        tableName: 'observations',
        storageTargetId: null,
        authToken: null
      },
      metastore: {
        baseUrl: '',
        namespace: 'observatory.reports',
        authToken: null
      },
      workflows: {
        generatorSlug: 'observatory-minute-data-generator',
        ingestSlug: 'observatory-minute-ingest',
        publicationSlug: 'observatory-daily-publication'
      }
    } as const;

    const workflowDefinitions = listExampleWorkflowDefinitions(OBSERVATORY_WORKFLOW_SLUGS);
    for (const workflow of workflowDefinitions) {
      const defaults = (workflow.defaultParameters ??= {} as Record<string, unknown>);
      if (workflow.slug === config.workflows.generatorSlug) {
        defaults.inboxDir = paths.inbox;
        defaults.filestoreBaseUrl = config.filestore.baseUrl;
        defaults.filestoreBackendId = config.filestore.backendMountId;
        defaults.inboxPrefix = config.filestore.inboxPrefix;
        defaults.stagingPrefix = config.filestore.stagingPrefix;
        defaults.archivePrefix = config.filestore.archivePrefix;
        defaults.filestorePrincipal = 'observatory-data-generator';
      } else if (workflow.slug === config.workflows.ingestSlug) {
        defaults.stagingDir = paths.staging;
        defaults.archiveDir = paths.archive;
        defaults.filestoreBaseUrl = config.filestore.baseUrl;
        defaults.filestoreBackendId = config.filestore.backendMountId;
        defaults.inboxPrefix = config.filestore.inboxPrefix;
        defaults.stagingPrefix = config.filestore.stagingPrefix;
        defaults.archivePrefix = config.filestore.archivePrefix;
        defaults.filestorePrincipal = config.filestore.principal;
        defaults.timestoreBaseUrl = config.timestore.baseUrl;
        defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
        defaults.timestoreDatasetName = config.timestore.datasetName;
        defaults.timestoreTableName = config.timestore.tableName;
      } else if (workflow.slug === config.workflows.publicationSlug) {
        defaults.plotsDir = paths.plots;
        defaults.reportsDir = paths.reports;
        defaults.timestoreBaseUrl = config.timestore.baseUrl;
        defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
        defaults.metastoreBaseUrl = config.metastore.baseUrl;
        defaults.metastoreNamespace = config.metastore.namespace;
      }
    }

    await importExampleWorkflows(app, workflowDefinitions);

    const minute = '2030-01-01T03:30';
    const minuteKey = minute.replace(':', '-');
    const minuteIsoMatch = minute.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/);
    const hourSegment = minuteIsoMatch ? `${minuteIsoMatch[1]}T${minuteIsoMatch[2]}` : minuteKey;
    const archiveMinuteFilename = minuteIsoMatch ? `${minuteIsoMatch[3]}.csv` : `${minuteKey}.csv`;

    await runWorkflow(app, config.workflows.generatorSlug, minute, {
      inboxDir: paths.inbox,
      minute,
      rowsPerInstrument: OBSERVATORY_ROWS_PER_INSTRUMENT,
      intervalMinutes: OBSERVATORY_INTERVAL_MINUTES,
      filestoreBaseUrl: config.filestore.baseUrl,
      filestoreBackendId: config.filestore.backendMountId,
      inboxPrefix: config.filestore.inboxPrefix,
      stagingPrefix: config.filestore.stagingPrefix,
      archivePrefix: config.filestore.archivePrefix,
      filestorePrincipal: 'observatory-data-generator'
    });

    const ingestRun = await waitForWorkflowRunMatching(
      app,
      config.workflows.ingestSlug,
      (run) => getRunParameter(run, 'minute') === minute,
      { description: `parameters.minute === ${minute}`, timeoutMs: 20_000 }
    );
    assert.equal(ingestRun.status, 'succeeded', 'Ingest workflow should succeed');
    assert.equal(ingestRun.triggeredBy, 'event-trigger');
    const inboxEntries = await readdir(paths.inbox);
    assert.equal(inboxEntries.length, 0, 'Inbox should be empty once files are archived');

    const stagingMinuteDir = path.join(paths.staging, minuteKey);
    const stagingEntries = await readdir(stagingMinuteDir);
    assert.equal(stagingEntries.length, 3, 'Normalizer should copy all CSVs into staging');

    const archiveInstrumentDirs = (await readdir(paths.archive)).sort();
    assert.deepEqual(
      archiveInstrumentDirs,
      ['instrument_alpha', 'instrument_bravo', 'instrument_charlie'],
      'Archived files should be organized by instrument'
    );

    for (const archiveDirName of archiveInstrumentDirs) {
      const instrumentSlug = archiveDirName.replace(/^instrument_/, '');
      const instrumentArchiveDir = path.join(paths.archive, archiveDirName, hourSegment);
      const archivedEntries = (await readdir(instrumentArchiveDir)).sort();
      assert.deepEqual(archivedEntries, [archiveMinuteFilename]);

      const stagingFilename = stagingEntries.find((entry) =>
        entry.startsWith(`instrument_${instrumentSlug}_`)
      );
      assert.ok(stagingFilename, `Expected staging file for ${archiveDirName}`);

      const archivedContents = await readFile(
        path.join(instrumentArchiveDir, archiveMinuteFilename),
        'utf8'
      );
      const stagingContents = await readFile(path.join(stagingMinuteDir, stagingFilename), 'utf8');
      assert.equal(
        archivedContents,
        stagingContents,
        `Archived CSV for ${archiveDirName} should match staging copy`
      );
    }

    const partitionStart = `${minute}:00Z`;
    const startDate = new Date(partitionStart);
    const lookaheadSeconds =
      (OBSERVATORY_ROWS_PER_INSTRUMENT - 1) * OBSERVATORY_INTERVAL_MINUTES * 60 + 59;
    const partitionEndDate = new Date(startDate.getTime() + lookaheadSeconds * 1000 + 999);
    const partitionEnd = partitionEndDate.toISOString();
    const windowStartDate = new Date(startDate.getTime() - (OBSERVATORY_ROWS_PER_INSTRUMENT - 1) * OBSERVATORY_INTERVAL_MINUTES * 60 * 1000);
    const partitionRangeStart = windowStartDate.toISOString();
    const rowCount = await queryTimestoreRowCount(
      config.timestore.baseUrl,
      config.timestore.datasetSlug,
      partitionRangeStart,
      partitionEnd
    );
    assert.equal(
      rowCount,
      18,
      `Timestore loader should append 18 rows (3 instruments × 6 rows) but received ${rowCount}`
    );

    const publicationRun = await waitForWorkflowRunMatching(
      app,
      config.workflows.publicationSlug,
      (run) =>
        getRunParameter(run, 'partitionKey') === minute || getRunParameter(run, 'minute') === minute,
      { description: `publication minute ${minute}`, timeoutMs: 20_000 }
    );
    assert.equal(publicationRun.status, 'succeeded');
    assert.equal(publicationRun.triggeredBy, 'event-trigger');

    const plotsMinuteDir = path.join(paths.plots, minuteKey);
    const plotEntries = await readdir(plotsMinuteDir);
    assert.equal(plotEntries.sort().join(','), 'metrics.json,pm25_trend.svg,temperature_trend.svg');

    const reportsMinuteDir = path.join(paths.reports, minuteKey);
    const reportEntries = await readdir(reportsMinuteDir);
    assert.equal(reportEntries.sort().join(','), 'status.html,status.json,status.md');
    for (const entry of reportEntries) {
      const statsResult = await stat(path.join(reportsMinuteDir, entry));
      assert(statsResult.size > 0, `Report artifact ${entry} should not be empty`);
    }

    const publicationParameters = (publicationRun.parameters ?? {}) as Record<string, unknown>;
    assert.equal(publicationParameters.plotsDir, paths.plots);
    assert.equal(publicationParameters.reportsDir, paths.reports);

    const reportJson = await readJsonFile<{
      summary?: { instrumentCount?: number };
      visualization?: { metrics?: { instrumentCount?: number } };
    }>(path.join(reportsMinuteDir, 'status.json'));
    const reportedInstrumentCount = reportJson.summary?.instrumentCount
      ?? reportJson.visualization?.metrics?.instrumentCount;
    assert.equal(reportedInstrumentCount, 3);
  } finally {
    await pool.end();
    if (process.env.OBSERVATORY_KEEP_TEMP === '1') {
      // preserve temp directory for debugging
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function resetDirectory(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
}

async function ensureFilestoreBackendMount(
  pool: Pool,
  schema: string,
  rootPath: string
): Promise<number> {
  const mountKey = 'observatory-local';
  const result = await pool.query<{ id: number }>(
    `INSERT INTO ${schema}.backend_mounts (mount_key, backend_kind, root_path, access_mode, state)
       VALUES ($1, 'local', $2, 'rw', 'active')
       ON CONFLICT (mount_key)
       DO UPDATE SET root_path = EXCLUDED.root_path, state = 'active'
     RETURNING id`,
    [mountKey, rootPath]
  );
  return result.rows[0].id;
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => shutdownEmbeddedPostgres());
  await withServer(runObservatoryScenario);
}, { name: 'examples-environmentalObservatoryIngest.e2e' });
