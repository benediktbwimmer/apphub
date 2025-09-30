import '@apphub/catalog-tests/setupTestEnv';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  readdir,
  stat,
  readFile,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import {
  createEventDrivenObservatoryConfig,
  applyObservatoryWorkflowDefaults,
  ensureObservatoryBackend,
  resolveWorkflowProvisioningPlan,
  type EventDrivenObservatoryConfig,
  type WorkflowDefinitionTemplate,
  type WorkflowProvisioningEventTrigger
} from '@apphub/examples';
import { validateEventEnvelope, type EventEnvelope } from '@apphub/event-bus';
import { runE2E, scheduleForcedExit } from '@apphub/test-helpers';

import { loadExampleWorkflowDefinition } from '../helpers/examples';
import type { WorkflowDefinitionCreateInput } from '../../../services/catalog/src/workflows/zodSchemas';
import {
  startFilestoreTestServer,
  type FilestoreTestServer
} from '../helpers/filestore';
import {
  startTimestoreTestServer,
  type TimestoreTestServer
} from '../helpers/timestore';
import {
  startMetastoreTestServer,
  type MetastoreTestServer
} from '../helpers/metastore';

import { runWorkflowOrchestration } from '../../../services/catalog/src/workflowOrchestrator';
import { closePool, resetDatabasePool } from '../../../services/catalog/src/db/client';
import {
  EVENT_QUEUE_NAME,
  EVENT_TRIGGER_QUEUE_NAME,
  WORKFLOW_QUEUE_NAME,
  getQueueConnection,
  type EventIngressJobData,
  type EventTriggerJobData
} from '../../../services/catalog/src/queue';
import { registerSourceEvent } from '../../../services/catalog/src/eventSchedulerState';
import { ingestWorkflowEvent } from '../../../services/catalog/src/workflowEvents';
import {
  processEventTriggersForEnvelope,
  retryWorkflowTriggerDelivery
} from '../../../services/catalog/src/eventTriggerProcessor';
import { TIMESTORE_INGEST_QUEUE_NAME } from '../../../services/timestore/src/queue';
import { processIngestionJob } from '../../../services/timestore/src/ingestion/processor';
import type { IngestionJobPayload } from '../../../services/timestore/src/ingestion/types';

const execFile = promisify(execFileCallback);

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

type ManagedCleanup = () => Promise<void> | void;

const managedCleanups: ManagedCleanup[] = [];
let managedCleanupExecuted = false;

function registerResourceCleanup(cleanup: ManagedCleanup): void {
  managedCleanups.push(cleanup);
}

async function runResourceCleanups(): Promise<void> {
  if (managedCleanupExecuted) {
    return;
  }
  managedCleanupExecuted = true;
  while (managedCleanups.length > 0) {
    const cleanup = managedCleanups.pop();
    if (!cleanup) {
      continue;
    }
    try {
      await cleanup();
    } catch (error) {
      console.error('[benchmark] resource cleanup failed', error);
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void (async () => {
      console.warn(`[benchmark] received ${signal}, tearing down resources`);
      try {
        await runResourceCleanups();
      } finally {
        process.exit(130);
      }
    })();
  });
}

const OPERATOR_TOKEN = 'observatory-event-benchmark-token';
const OBSERVATORY_BUNDLE_SLUGS = [
  'observatory-data-generator',
  'observatory-inbox-normalizer',
  'observatory-timestore-loader',
  'observatory-visualization-runner',
  'observatory-report-publisher',
  'observatory-calibration-importer',
  'observatory-dashboard-aggregator'
] as const;
const OBSERVATORY_WORKFLOW_SLUGS = [
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication',
  'observatory-dashboard-aggregate',
  'observatory-calibration-import'
] as const;
const GENERATOR_WORKFLOW_SLUG = 'observatory-minute-data-generator';
const DEFAULT_INSTRUMENT_COUNT = 5;
const OBSERVATORY_INSTRUMENT_COUNT = resolveInstrumentCount();
const OBSERVATORY_ROWS_PER_INSTRUMENT = 6;
const OBSERVATORY_INTERVAL_MINUTES = 1;
const RUN_MINUTES = 5;
const TEST_TIMEOUT_MS = Number(process.env.OBSERVATORY_BENCH_TIMEOUT_MS ?? 15 * 60 * 1000);

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'observatory-benchmark',
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
let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedDatabaseUrl: string | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function applyEnvDefaults(defaults: Record<string, string>): () => void {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(defaults)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
      applied.push(key);
    }
  }
  return () => {
    for (const key of applied) {
      delete process.env[key];
    }
  };
}

function applyEnvOverrides(overrides: Record<string, string>): () => void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  return () => {
    for (const [key, prior] of previous) {
      if (prior === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = prior;
      }
    }
  };
}

async function ensureDockerAvailable(): Promise<void> {
  try {
    await execFile('docker', ['version', '--format', '{{.Server.Version}}']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[benchmark] Docker CLI is required for this test: ${message}`);
  }
}

type MinioContainerInfo = {
  name: string;
  dataDir: string;
  apiPort: number;
  consolePort: number;
  rootUser: string;
  rootPassword: string;
};

type RedisContainerInfo = {
  name: string;
  port: number;
};

const MINIO_ROOT_USER = 'apphub';
const MINIO_ROOT_PASSWORD = 'apphub123';
const MINIO_BUCKETS = ['apphub-filestore', 'apphub-example-bundles', 'apphub-timestore'];

async function startMinioContainer(): Promise<MinioContainerInfo> {
  const apiPort = await findAvailablePort();
  const consolePort = await findAvailablePort();
  const dataDir = await mkdtemp(path.join(tmpdir(), 'observatory-minio-'));
  const name = `observatory-minio-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await execFile('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-p',
      `${apiPort}:9000`,
      '-p',
      `${consolePort}:9001`,
      '-e',
      `MINIO_ROOT_USER=${MINIO_ROOT_USER}`,
      '-e',
      `MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}`,
      '-v',
      `${dataDir}:/data`,
      'minio/minio:latest',
      'server',
      '/data',
      '--address',
      ':9000',
      '--console-address',
      ':9001'
    ]);

    await waitForMinio(apiPort);
    await ensureMinioBuckets(name, MINIO_ROOT_USER, MINIO_ROOT_PASSWORD);

    return {
      name,
      dataDir,
      apiPort,
      consolePort,
      rootUser: MINIO_ROOT_USER,
      rootPassword: MINIO_ROOT_PASSWORD
    } satisfies MinioContainerInfo;
  } catch (error) {
    await execFile('docker', ['rm', '-f', name]).catch(() => undefined);
    await rm(dataDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensureMinioBuckets(containerName: string, rootUser: string, rootPassword: string): Promise<void> {
  for (const bucket of MINIO_BUCKETS) {
    await execFile('docker', [
      'run',
      '--rm',
      '--network',
      `container:${containerName}`,
      '-e',
      `MC_HOST_local=http://${encodeURIComponent(rootUser)}:${encodeURIComponent(rootPassword)}@127.0.0.1:9000`,
      'minio/mc:latest',
      'mb',
      '--ignore-existing',
      `local/${bucket}`
    ]);
  }
}

async function waitForMinio(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/minio/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await delay(250);
  }
  throw new Error('[benchmark] Timed out waiting for MinIO to become ready');
}

async function startRedisContainer(): Promise<RedisContainerInfo> {
  const port = await findAvailablePort();
  const name = `observatory-redis-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await execFile('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      name,
      '-p',
      `${port}:6379`,
      'redis:7'
    ]);
    await waitForRedis(`redis://127.0.0.1:${port}`);
    return { name, port } satisfies RedisContainerInfo;
  } catch (error) {
    await execFile('docker', ['rm', '-f', name]).catch(() => undefined);
    throw error;
  }
}

async function waitForRedis(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    const client = new IORedis(url, {
      maxRetriesPerRequest: 0,
      lazyConnect: true,
      retryStrategy: () => null
    });
    client.on('error', () => {
      // suppress unhandled error events during startup retries
    });
    try {
      await client.connect();
      await client.ping();
      await client.quit();
      return;
    } catch (error) {
      lastError = error;
      await client.quit().catch(() => undefined);
      await delay(250);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'unknown error');
  throw new Error(`[benchmark] Timed out waiting for Redis at ${url}: ${message}`);
}

async function stopDockerContainer(name: string): Promise<void> {
  try {
    await execFile('docker', ['stop', name]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/No such container/i.test(message)) {
      return;
    }
    console.warn(`[benchmark] Failed to stop container ${name}:`, message);
  }
}

async function setupExternalInfrastructure(): Promise<void> {
  await ensureDockerAvailable();

  const minio = await startMinioContainer();
  registerResourceCleanup(async () => {
    await stopDockerContainer(minio.name);
    await rm(minio.dataDir, { recursive: true, force: true }).catch(() => undefined);
  });

  const redis = await startRedisContainer();
  registerResourceCleanup(() => stopDockerContainer(redis.name));

  const instrumentCountOverride =
    process.env.OBSERVATORY_GENERATOR_INSTRUMENT_COUNT
      ?? process.env.OBSERVATORY_INSTRUMENT_COUNT
      ?? process.env.OBSERVATORY_BENCH_INSTRUMENT_COUNT
      ?? process.env.OBSERVATORY_BENCH_INSTRUMENTS
      ?? '10';

  const restoreOverrides = applyEnvOverrides({
    REDIS_URL: `redis://127.0.0.1:${redis.port}`,
    OBSERVATORY_FILESTORE_S3_ENDPOINT: `http://127.0.0.1:${minio.apiPort}`,
    OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID: minio.rootUser,
    OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY: minio.rootPassword,
    OBSERVATORY_FILESTORE_S3_REGION: 'us-east-1',
    OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE: 'true',
    OBSERVATORY_INSTRUMENT_COUNT: instrumentCountOverride,
    OBSERVATORY_GENERATOR_INSTRUMENT_COUNT: instrumentCountOverride,
    FILESTORE_S3_ENDPOINT: `http://127.0.0.1:${minio.apiPort}`,
    FILESTORE_S3_ACCESS_KEY_ID: minio.rootUser,
    FILESTORE_S3_SECRET_ACCESS_KEY: minio.rootPassword,
    FILESTORE_S3_REGION: 'us-east-1',
    FILESTORE_S3_FORCE_PATH_STYLE: 'true',
    APPHUB_BUNDLE_STORAGE_BACKEND: 's3',
    APPHUB_BUNDLE_STORAGE_BUCKET: 'apphub-example-bundles',
    APPHUB_BUNDLE_STORAGE_ENDPOINT: `http://127.0.0.1:${minio.apiPort}`,
    APPHUB_BUNDLE_STORAGE_REGION: 'us-east-1',
    APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE: 'true',
    APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID: minio.rootUser,
    APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY: minio.rootPassword,
    APPHUB_BUNDLE_STORAGE_SIGNING_SECRET: 'local-benchmark-secret'
  });
  registerResourceCleanup(restoreOverrides);

  const restoreDefaults = applyEnvDefaults({
    APPHUB_ALLOW_INLINE_MODE: '1',
    APPHUB_EVENTS_MODE: 'redis',
    APPHUB_DISABLE_ANALYTICS: '1',
    OBSERVATORY_BENCH_INSTRUMENTS: instrumentCountOverride,
    OBSERVATORY_BENCH_INSTRUMENT_COUNT: instrumentCountOverride
  });
  registerResourceCleanup(restoreDefaults);
}

type BenchmarkTiming = {
  minute: string;
  generatorMs: number;
  ingestLagMs: number;
  publicationLagMs: number;
  totalMs: number;
  ingestSteps: Record<string, number>;
  publicationSteps: Record<string, number>;
};

type WorkflowRunSummary = {
  id: string;
  status: string;
  triggeredBy?: string | null;
  partitionKey?: string | null;
  parameters?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

type ServerContext = {
  timestore: TimestoreTestServer;
  filestore: FilestoreTestServer;
  metastore: MetastoreTestServer;
  tempRoot: string;
};

type BenchmarkContext = ServerContext & {
  config: EventDrivenObservatoryConfig;
  instrumentCount: number;
};

type InstrumentProfileInput = {
  instrumentId: string;
  site: string;
};

function buildInstrumentProfiles(count: number): InstrumentProfileInput[] {
  const profiles: InstrumentProfileInput[] = [];
  for (let index = 0; index < count; index += 1) {
    const suffix = String(index + 1).padStart(3, '0');
    profiles.push({
      instrumentId: `instrument_${suffix}`,
      site: `site_${suffix}`
    });
  }
  return profiles;
}

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    if (embeddedDatabaseUrl) {
      process.env.DATABASE_URL = embeddedDatabaseUrl;
    }
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'observatory-event-pg-'));
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
  embeddedPostgresCleanup = null;
  embeddedPostgres = null;
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

async function withServer(
  fn: (app: FastifyInstance, context: ServerContext) => Promise<void>
): Promise<void> {
  await ensureEmbeddedPostgres();
  const previousHostRoot = process.env.HOST_ROOT;
  const previousRedisUrl = process.env.REDIS_URL;
  const redisUrl = previousRedisUrl ?? 'redis://127.0.0.1:6379';
  process.env.REDIS_URL = redisUrl;
  activeRedisUrl = redisUrl;
  const previousFilestoreLogLevel = process.env.FILESTORE_LOG_LEVEL;
  process.env.FILESTORE_LOG_LEVEL = previousFilestoreLogLevel ?? 'trace';

  await resetDatabasePool();

  const timestore = await startTimestoreTestServer({
    databaseUrl: embeddedDatabaseUrl ?? process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/apphub',
    redisUrl
  });

  const filestore = await startFilestoreTestServer({
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/apphub',
    redisUrl
  });

  const metastore = await startMetastoreTestServer({
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/apphub',
    redisUrl
  });

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'observatory-event-benchmark-'));

  const storageDir = await mkdtemp(path.join(tmpdir(), 'observatory-bundle-cache-'));
  const previousStorageDir = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageDir;

  const serviceConfigDir = await mkdtemp(path.join(tmpdir(), 'observatory-service-config-'));
  const serviceConfigPath = path.join(serviceConfigDir, 'service-config.json');
  await writeServiceConfig(serviceConfigPath);
  const previousServiceConfig = process.env.SERVICE_CONFIG_PATH;
  process.env.SERVICE_CONFIG_PATH = `!${serviceConfigPath}`;

  const { buildServer } = await import('@apphub/catalog/server');
  const app = await buildServer();
  await app.ready();

  try {
    await fn(app, { timestore, filestore, metastore, tempRoot });
  } finally {
    await app.close();
    await timestore.close();
    await filestore.close();
    await metastore.close();
    await closePool().catch(() => undefined);

    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
      activeRedisUrl = null;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
      activeRedisUrl = previousRedisUrl;
    }

    if (previousFilestoreLogLevel === undefined) {
      delete process.env.FILESTORE_LOG_LEVEL;
    } else {
      process.env.FILESTORE_LOG_LEVEL = previousFilestoreLogLevel;
    }

    if (previousHostRoot === undefined) {
      delete process.env.HOST_ROOT;
    } else {
      process.env.HOST_ROOT = previousHostRoot;
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
    if (process.env.OBSERVATORY_KEEP_TEMP === '1') {
      console.log('[benchmark] preserving temp root', tempRoot);
    } else {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}

async function writeServiceConfig(configPath: string): Promise<void> {
  const payload = {
    module: 'local/test-observatory-event',
    services: [],
    networks: []
  };
  await rm(configPath, { force: true }).catch(() => undefined);
  await writeFile(configPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function packageExampleBundles(slugs: readonly string[]): Promise<void> {
  const module = await import('../../../services/catalog/src/exampleBundleWorker');
  for (const slug of slugs) {
    const jobId = `benchmark-inline-${slug}-${Date.now()}`;
    console.log('[benchmark] packaging bundle', { slug });
    await module.processExampleBundleJob({ slug, force: true }, jobId);
  }
}

async function importExampleBundle(app: FastifyInstance, slug: string): Promise<void> {
  const preview = await app.inject({
    method: 'POST',
    url: '/job-imports/preview',
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    payload: { source: 'example', slug }
  });
  assert.equal(preview.statusCode, 200, `Preview failed for ${slug}: ${preview.payload}`);
  const previewBody = JSON.parse(preview.payload) as {
    data: { bundle: { slug: string; version: string } };
  };
  const reference = `${previewBody.data.bundle.slug}@${previewBody.data.bundle.version}`;

  const confirm = await app.inject({
    method: 'POST',
    url: '/job-imports',
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` },
    payload: { source: 'example', slug, reference }
  });
  assert.equal(confirm.statusCode, 201, `Import failed for ${slug}: ${confirm.payload}`);
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

async function applyWorkflowProvisioning(
  app: FastifyInstance,
  workflow: WorkflowDefinitionCreateInput
): Promise<void> {
  const plan = resolveWorkflowProvisioningPlan(workflow as unknown as WorkflowDefinitionTemplate);
  if (!plan || (plan.schedules.length === 0 && plan.eventTriggers.length === 0)) {
    return;
  }

  const authHeaders = { Authorization: `Bearer ${OPERATOR_TOKEN}` };
  const workflowSlug = workflow.slug;

  if (plan.schedules.length > 0) {
    const response = await app.inject({ method: 'GET', url: '/workflow-schedules', headers: authHeaders });
    assert.equal(response.statusCode, 200, 'Failed to list workflow schedules');
    const payload = JSON.parse(response.payload) as {
      data?: Array<{
        schedule?: { id: string; name: string | null };
        workflow?: { slug?: string | null };
      }>;
    };
    const existing = new Map<string, { id: string }>();
    for (const entry of payload.data ?? []) {
      if (entry.workflow?.slug !== workflowSlug || !entry.schedule) {
        continue;
      }
      const key = entry.schedule.name ?? '__default__';
      existing.set(key, { id: entry.schedule.id });
    }
    for (const schedule of plan.schedules) {
      const key = schedule.name ?? '__default__';
      const payloadBody = buildSchedulePayload(schedule);
      const current = existing.get(key);
      if (current) {
        const update = await app.inject({
          method: 'PATCH',
          url: `/workflow-schedules/${current.id}`,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          payload: JSON.stringify(payloadBody)
        });
        assert.equal(update.statusCode, 200, `Failed to update schedule ${key}`);
      } else {
        const create = await app.inject({
          method: 'POST',
          url: `/workflows/${workflowSlug}/schedules`,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          payload: JSON.stringify(payloadBody)
        });
        if (create.statusCode !== 201 && create.statusCode !== 409) {
          assert.fail(`Failed to create schedule ${key}: ${create.payload}`);
        }
      }
    }
  }

  if (plan.eventTriggers.length > 0) {
    const response = await app.inject({
      method: 'GET',
      url: `/workflows/${workflowSlug}/triggers`,
      headers: authHeaders
    });
    assert.equal(response.statusCode, 200, 'Failed to list triggers');
    const payload = JSON.parse(response.payload) as {
      data?: { triggers?: Array<{ id: string; name: string | null }> };
    };
    const existing = new Map<string, { id: string }>();
    for (const trigger of payload.data?.triggers ?? []) {
      const key = trigger.name ?? '__default__';
      existing.set(key, { id: trigger.id });
    }
    for (const trigger of plan.eventTriggers) {
      const key = trigger.name ?? '__default__';
      const payloadBody = buildTriggerPayload(trigger);
      const current = existing.get(key);
      if (current) {
        const update = await app.inject({
          method: 'PATCH',
          url: `/workflows/${workflowSlug}/triggers/${current.id}`,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          payload: JSON.stringify(payloadBody)
        });
        assert.equal(update.statusCode, 200, `Failed to update trigger ${key}`);
      } else {
        const create = await app.inject({
          method: 'POST',
          url: `/workflows/${workflowSlug}/triggers`,
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          payload: JSON.stringify(payloadBody)
        });
        if (create.statusCode !== 201 && create.statusCode !== 409) {
          assert.fail(`Failed to create trigger ${key}: ${create.payload}`);
        }
      }
    }
  }
}

function buildSchedulePayload(schedule: { [key: string]: unknown }): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...schedule };
  delete payload.metadata;
  delete payload.parameterTemplate;
  return payload;
}

function buildTriggerPayload(trigger: WorkflowProvisioningEventTrigger): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: trigger.name,
    description: trigger.description,
    eventType: trigger.eventType,
    eventSource: trigger.eventSource ?? undefined,
    predicates: trigger.predicates,
    parameterTemplate: trigger.parameterTemplate,
    metadata: trigger.metadata,
    throttleWindowMs: trigger.throttleWindowMs,
    throttleCount: trigger.throttleCount,
    maxConcurrency: trigger.maxConcurrency,
    idempotencyKeyExpression: trigger.idempotencyKeyExpression,
    status: trigger.status
  };
  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined) {
      delete payload[key];
    }
  }
  return payload;
}

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
  const body = JSON.parse(response.payload) as {
    data: { id: string; status: string };
  };
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
    const details = await fetchWorkflowRun(app, runId);
    if (!details) {
      await delay(100);
      continue;
    }
    const status = details.data.status;
    if (status === 'succeeded') {
      return runId;
    }
    if (status === 'pending' || status === 'running') {
      await delay(150);
      continue;
    }
    const snippet = JSON.stringify(details.data);
    assert.fail(`Workflow ${slug} did not succeed (status=${status}): ${snippet}`);
  }

  assert.fail(`Workflow ${slug} did not complete within timeout`);
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

async function fetchWorkflowRunSteps(
  app: FastifyInstance,
  runId: string
): Promise<WorkflowRunStepRecord[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/workflow-runs/${runId}/steps`,
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
  });
  if (response.statusCode !== 200) {
    throw new Error(`Failed to fetch steps for run ${runId} (${response.statusCode})`);
  }
  const payload = JSON.parse(response.payload) as {
    data: { steps: WorkflowRunStepRecord[] };
  };
  return payload.data.steps ?? [];
}

type WorkflowRunStepRecord = {
  id: string;
  stepId: string;
  name?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
};

function computeStepDurations(steps: WorkflowRunStepRecord[]): Record<string, number> {
  const durations: Record<string, number> = {};
  for (const step of steps) {
    const key = step.stepId || step.name || step.id;
    if (!key) {
      continue;
    }
    const started = step.startedAt ? Date.parse(step.startedAt) : NaN;
    const completed = step.completedAt ? Date.parse(step.completedAt) : NaN;
    if (!Number.isNaN(started) && !Number.isNaN(completed) && completed >= started) {
      durations[key] = completed - started;
    }
  }
  return durations;
}

function getRunParameter(run: WorkflowRunSummary, key: string): string | null {
  const parameters = run.parameters;
  if (!parameters || typeof parameters !== 'object') {
    return null;
  }
  const value = parameters[key];
  return typeof value === 'string' ? value : null;
}

async function waitForWorkflowRunMatching(
  app: FastifyInstance,
  slug: string,
  predicate: (run: WorkflowRunSummary) => boolean,
  options: { description: string; timeoutMs?: number }
): Promise<WorkflowRunSummary> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const deadline = Date.now() + timeoutMs;
  let observed: WorkflowRunSummary[] = [];

  while (Date.now() < deadline) {
    await drainBackgroundQueues();
    const response = await app.inject({
      method: 'GET',
      url: `/workflows/${slug}/runs?limit=25`,
      headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
    });
    assert.equal(response.statusCode, 200, `Failed to list runs for ${slug}`);
    const payload = JSON.parse(response.payload) as {
      data: { runs: WorkflowRunSummary[] };
    };
    observed = payload.data.runs;
    const match = observed.find(predicate);
    if (match) {
      if (match.status === 'succeeded') {
        return match;
      }
      if (match.status === 'failed' || match.status === 'canceled' || match.status === 'expired') {
        const detailResponse = await fetchWorkflowRun(app, match.id);
        const detail = match.errorMessage ?? detailResponse?.data?.errorMessage ?? 'no error message provided';
        console.error('Workflow run failure diagnostics', {
          slug,
          runId: match.id,
          status: match.status,
          error: detail,
          context: detailResponse?.data?.context
        });
        assert.fail(`Workflow ${slug} run failed (status=${match.status}): ${detail}`);
      }
    }
    await delay(200);
  }

  const summary = observed.map((run) => ({
    id: run.id,
    status: run.status,
    partitionKey: run.partitionKey ?? null,
    minute: getRunParameter(run, 'minute'),
    reportedPartition: getRunParameter(run, 'partitionKey')
  }));
  throw new Error(
    `Timed out waiting for workflow ${slug} (${options.description}). Observed runs: ${JSON.stringify(summary)}`
  );
}

async function drainBackgroundQueues(): Promise<void> {
  let connection;
  try {
    connection = getQueueConnection();
  } catch {
    return;
  }

  const eventQueue = new Queue<EventIngressJobData>(EVENT_QUEUE_NAME, { connection });
  const triggerQueue = new Queue<EventTriggerJobData>(EVENT_TRIGGER_QUEUE_NAME, { connection });
  const workflowQueue = new Queue<{ workflowRunId?: string }>(WORKFLOW_QUEUE_NAME, { connection });

  try {
    for (let iteration = 0; iteration < 50; iteration += 1) {
      const processedEvents = await flushEventQueue(eventQueue);
      const processedTriggers = await flushEventTriggerQueue(triggerQueue);
      const processedWorkflows = await flushWorkflowQueue(workflowQueue);
      const processedTimestore = await flushTimestoreIngestionQueue();
      if (!processedEvents && !processedTriggers && !processedWorkflows && !processedTimestore) {
        break;
      }
    }
  } finally {
    await Promise.all([eventQueue.close(), triggerQueue.close(), workflowQueue.close()]);
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
    const evaluation = await registerSourceEvent(envelope.source ?? 'unknown');
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
    } else if (job.data.retryKind === 'trigger' && typeof job.data.deliveryId === 'string') {
      await retryWorkflowTriggerDelivery(job.data.deliveryId);
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
      await processIngestionJob(job.data as IngestionJobPayload);
      await job.remove();
    }

    return true;
  } finally {
    await queue.close();
    await connection.quit();
  }
}

function generateMinuteSeries(start: string, count: number): string[] {
  const result: string[] = [];
  const base = new Date(`${start}:00Z`);
  for (let index = 0; index < count; index += 1) {
    const current = new Date(base.getTime() + index * 60 * 1000);
    result.push(current.toISOString().slice(0, 16));
  }
  return result;
}

function minuteKey(minute: string): string {
  return minute.replace(':', '-');
}

function computePartitionRange(
  minute: string,
  rowsPerInstrument: number,
  intervalMinutes: number
): { startIso: string; endIso: string } {
  const partitionStart = `${minute}:00Z`;
  const startDate = new Date(partitionStart);
  const lookaheadSeconds = (rowsPerInstrument - 1) * intervalMinutes * 60 + 59;
  const partitionEndDate = new Date(startDate.getTime() + lookaheadSeconds * 1000 + 999);
  const windowStartDate = new Date(startDate.getTime() - (rowsPerInstrument - 1) * intervalMinutes * 60 * 1000);
  return { startIso: windowStartDate.toISOString(), endIso: partitionEndDate.toISOString() };
}

async function queryTimestoreRowCount(
  url: string,
  datasetSlug: string,
  startIso: string,
  endIso: string,
  windowKey: string
): Promise<number> {
  const response = await fetch(`${url}/datasets/${encodeURIComponent(datasetSlug)}/query`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      timeRange: { start: startIso, end: endIso },
      timestampColumn: 'timestamp',
      limit: 10000,
      filters: {
        partitionKey: {
          window: { eq: windowKey }
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Timestore query failed with status ${response.status}: ${errorText}`);
  }

  const payload = (await response.json()) as { rows?: unknown[] };
  return Array.isArray(payload.rows) ? payload.rows.length : 0;
}

async function waitForTimestoreRowCount(
  url: string,
  datasetSlug: string,
  startIso: string,
  endIso: string,
  windowKey: string,
  expected: number,
  opts: { timeoutMs?: number; pollMs?: number } = {}
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastCount = 0;
  while (Date.now() < deadline) {
    lastCount = await queryTimestoreRowCount(url, datasetSlug, startIso, endIso, windowKey);
    if (lastCount >= expected) {
      return lastCount;
    }
    await delay(pollMs);
  }
  throw new Error(
    `Timed out waiting for ${expected} Timestore rows (last observed ${lastCount}) for ${datasetSlug}`
  );
}

async function verifyReports(
  paths: { plots: string; reports: string },
  minute: string,
  expectedInstrumentCount: number
): Promise<void> {
  const key = minuteKey(minute);
  const plotsDir = path.join(paths.plots, key);
  const reportsDir = path.join(paths.reports, key);

  const plotEntries = await readdir(plotsDir);
  const reportEntries = await readdir(reportsDir);

  assert.equal(
    plotEntries.sort().join(','),
    'metrics.json,pm25_trend.svg,temperature_trend.svg',
    `Unexpected plot outputs for ${minute}`
  );
  assert.equal(
    reportEntries.sort().join(','),
    'status.html,status.json,status.md',
    `Unexpected report outputs for ${minute}`
  );

  for (const entry of reportEntries) {
    const stats = await stat(path.join(reportsDir, entry));
    assert(stats.size > 0, `Report artifact ${entry} should not be empty for ${minute}`);
  }

  const reportJson = await readFile(path.join(reportsDir, 'status.json'), 'utf8');
  const parsed = JSON.parse(reportJson) as {
    summary?: { instrumentCount?: number };
    visualization?: { metrics?: { instrumentCount?: number } };
  };
  const instrumentCount =
    parsed.summary?.instrumentCount ?? parsed.visualization?.metrics?.instrumentCount;
  assert.equal(
    instrumentCount,
    expectedInstrumentCount,
    `Instrument count mismatch for ${minute}`
  );
}

async function runBenchmarkScenario(app: FastifyInstance, serverContext: ServerContext): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const dataRoot = path.join(serverContext.tempRoot, 'data');
  await rm(dataRoot, { recursive: true, force: true });

  const envOverrides: Record<string, string> = {
    OBSERVATORY_DATA_ROOT: dataRoot,
    OBSERVATORY_FILESTORE_BASE_URL: serverContext.filestore.url,
    OBSERVATORY_TIMESTORE_BASE_URL: serverContext.timestore.url,
    OBSERVATORY_FILESTORE_BACKEND_ID: '1',
    OBSERVATORY_METASTORE_BASE_URL: serverContext.metastore.url,
    OBSERVATORY_METASTORE_NAMESPACE: 'observatory.ingest',
    OBSERVATORY_METASTORE_INGEST_NAMESPACE: 'observatory.ingest',
    OBSERVATORY_METASTORE_TOKEN: '',
    OBSERVATORY_CATALOG_BASE_URL: 'http://127.0.0.1:4000',
    OBSERVATORY_CATALOG_TOKEN: OPERATOR_TOKEN,
    FILESTORE_LOG_LEVEL: 'debug'
  };

  const originalEnv = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(envOverrides)) {
    originalEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  let benchmarkConfig: EventDrivenObservatoryConfig | null = null;
  try {
    const { config } = createEventDrivenObservatoryConfig({
      repoRoot,
      variables: { ...process.env },
      outputPath: path.join(serverContext.tempRoot, 'observatory-config.json')
    });
    assert.ok(
      typeof config.filestore.calibrationsPrefix === 'string' && config.filestore.calibrationsPrefix.length > 0,
      'Observatory config missing filestore.calibrationsPrefix'
    );
    assert.ok(
      typeof config.filestore.plansPrefix === 'string' && config.filestore.plansPrefix.length > 0,
      'Observatory config missing filestore.plansPrefix'
    );
    assert.equal(
      config.workflows.calibrationImportSlug,
      'observatory-calibration-import',
      'Unexpected calibration import workflow slug'
    );
    console.log('[benchmark] resolved observatory config paths', config.paths);
    console.log('[benchmark] resolved observatory filestore prefixes', config.filestore);
    console.log('[benchmark] resolved generator settings', config.workflows.generator);
    config.catalog = {
      baseUrl: 'http://127.0.0.1:4000',
      apiToken: OPERATOR_TOKEN
    };

    const backendId = await ensureObservatoryBackend(config);
    if (typeof backendId === 'number' && Number.isFinite(backendId)) {
      config.filestore.backendMountId = backendId;
      process.env.OBSERVATORY_FILESTORE_BACKEND_ID = String(backendId);
    }

    benchmarkConfig = config;

    const workflowDefinitions = OBSERVATORY_WORKFLOW_SLUGS.map((slug) =>
      loadExampleWorkflowDefinition(slug)
    );
    for (const workflow of workflowDefinitions) {
      applyObservatoryWorkflowDefaults(
        workflow as unknown as WorkflowDefinitionTemplate,
        config
      );
      const triggers =
        (workflow as WorkflowDefinitionTemplate).metadata?.provisioning?.eventTriggers ?? [];
      for (const trigger of triggers) {
        delete trigger.throttleWindowMs;
        delete trigger.throttleCount;
        delete trigger.maxConcurrency;
      }
    }

    await packageExampleBundles(OBSERVATORY_BUNDLE_SLUGS);
    for (const slug of OBSERVATORY_BUNDLE_SLUGS) {
      await importExampleBundle(app, slug);
    }

    await importExampleWorkflows(app, workflowDefinitions);

    for (const slug of OBSERVATORY_WORKFLOW_SLUGS) {
      const info = await app.inject({
        method: 'GET',
        url: `/workflows/${slug}/triggers`,
        headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
      });
      console.log('[benchmark] triggers for', slug, info.payload);
    }

    const instrumentCount =
      config.workflows.generator?.instrumentCount ?? OBSERVATORY_INSTRUMENT_COUNT;

    await runBenchmark(app, { ...serverContext, config, instrumentCount });
  } finally {
    for (const [key, value] of originalEnv.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    if (benchmarkConfig) {
      const keepTemp = process.env.OBSERVATORY_KEEP_TEMP === '1';
      if (!keepTemp) {
        const unique = new Set(Object.values(benchmarkConfig.paths));
        for (const entry of unique) {
          await rm(entry, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    }
  }
}

async function runBenchmark(app: FastifyInstance, context: BenchmarkContext): Promise<void> {
  const minutes = generateMinuteSeries('2032-06-15T09:00', RUN_MINUTES);
  const timings: BenchmarkTiming[] = [];
  const instrumentProfiles = buildInstrumentProfiles(context.instrumentCount);
  const expectedRowsPerMinute =
    OBSERVATORY_ROWS_PER_INSTRUMENT * context.instrumentCount;
  const metastoreConfig = context.config.metastore;

  await ensureEmptyDirectories(context.config.paths);

  for (const minute of minutes) {
    const start = performance.now();
    await runWorkflow(app, GENERATOR_WORKFLOW_SLUG, minute, {
      minute,
      rowsPerInstrument: OBSERVATORY_ROWS_PER_INSTRUMENT,
      intervalMinutes: OBSERVATORY_INTERVAL_MINUTES,
      instrumentCount: context.instrumentCount,
      instrumentProfiles: instrumentProfiles.map((profile) => ({ ...profile })),
      filestoreBaseUrl: context.config.filestore.baseUrl,
      filestoreBackendId: context.config.filestore.backendMountId,
      filestoreToken: context.config.filestore.token ?? undefined,
      inboxPrefix: context.config.filestore.inboxPrefix,
      stagingPrefix: context.config.filestore.stagingPrefix,
      archivePrefix: context.config.filestore.archivePrefix,
      filestorePrincipal: 'observatory-data-generator',
      metastoreBaseUrl: metastoreConfig?.baseUrl,
      metastoreNamespace: metastoreConfig?.namespace ?? 'observatory.ingest',
      metastoreAuthToken: metastoreConfig?.authToken ?? undefined
    });
    const generatorDone = performance.now();

    const ingestRun = await waitForWorkflowRunMatching(
      app,
      context.config.workflows.ingestSlug,
      (run) => getRunParameter(run, 'minute') === minute,
      { description: `ingest minute ${minute}`, timeoutMs: 30_000 }
    );
    assert.equal(ingestRun.status, 'succeeded');
    assert.equal(ingestRun.triggeredBy, 'event-trigger');
    const ingestSteps = computeStepDurations(await fetchWorkflowRunSteps(app, ingestRun.id));
    const ingestDone = performance.now();

    const publicationRun = await waitForWorkflowRunMatching(
      app,
      context.config.workflows.publicationSlug,
      (run) =>
        getRunParameter(run, 'partitionKey') === minute || getRunParameter(run, 'minute') === minute,
      { description: `publication minute ${minute}`, timeoutMs: 30_000 }
    );
    assert.equal(publicationRun.status, 'succeeded');
    assert.equal(publicationRun.triggeredBy, 'event-trigger');
    const publicationSteps = computeStepDurations(await fetchWorkflowRunSteps(app, publicationRun.id));
    const publicationDone = performance.now();

    const { startIso, endIso } = computePartitionRange(
      minute,
      OBSERVATORY_ROWS_PER_INSTRUMENT,
      OBSERVATORY_INTERVAL_MINUTES
    );
    const rowCount = await waitForTimestoreRowCount(
      context.timestore.url,
      context.config.timestore.datasetSlug,
      startIso,
      endIso,
      minute,
      expectedRowsPerMinute
    );
    assert.equal(
      rowCount,
      expectedRowsPerMinute,
      `Expected ${expectedRowsPerMinute} timestore rows for ${minute} but received ${rowCount}`
    );

    const inboxEntries = await readdir(context.config.paths.inbox);
    assert.equal(inboxEntries.length, 0, `Inbox should be empty after processing ${minute}`);

    await verifyReports(context.config.paths, minute, context.instrumentCount);

    timings.push({
      minute,
      generatorMs: generatorDone - start,
      ingestLagMs: ingestDone - generatorDone,
      publicationLagMs: publicationDone - ingestDone,
      totalMs: publicationDone - start,
      ingestSteps,
      publicationSteps
    });

    console.log(
      `[benchmark] minute ${minute} → total ${Math.round(publicationDone - start)}ms ` +
        `(generator ${Math.round(generatorDone - start)}ms, ingest wait ${Math.round(ingestDone - generatorDone)}ms, publication wait ${Math.round(publicationDone - ingestDone)}ms)`
    );
    console.log('[benchmark] ingest step durations', ingestSteps);
    console.log('[benchmark] publication step durations', publicationSteps);
  }

  await drainBackgroundQueues();

  const totalRuntime = timings.reduce((sum, entry) => sum + entry.totalMs, 0);
  const avgRuntime = totalRuntime / timings.length;
  console.log(
    `[benchmark] Completed ${timings.length} minutes. avg ${Math.round(avgRuntime)}ms, total ${Math.round(totalRuntime)}ms`
  );
  const aggregateIngestSteps: Record<string, { total: number; count: number }> = {};
  const aggregatePublicationSteps: Record<string, { total: number; count: number }> = {};
  for (const timing of timings) {
    for (const [key, value] of Object.entries(timing.ingestSteps)) {
      const bucket = aggregateIngestSteps[key] ?? (aggregateIngestSteps[key] = { total: 0, count: 0 });
      bucket.total += value;
      bucket.count += 1;
    }
    for (const [key, value] of Object.entries(timing.publicationSteps)) {
      const bucket =
        aggregatePublicationSteps[key] ?? (aggregatePublicationSteps[key] = { total: 0, count: 0 });
      bucket.total += value;
      bucket.count += 1;
    }
  }
  const avgIngestSteps = Object.fromEntries(
    Object.entries(aggregateIngestSteps).map(([key, stats]) => [key, Math.round(stats.total / stats.count)])
  );
  const avgPublicationSteps = Object.fromEntries(
    Object.entries(aggregatePublicationSteps).map(([key, stats]) => [key, Math.round(stats.total / stats.count)])
  );
  console.log('[benchmark] average ingest step durations (ms)', avgIngestSteps);
  console.log('[benchmark] average publication step durations (ms)', avgPublicationSteps);
}

async function ensureEmptyDirectories(pathsConfig: EventDrivenObservatoryConfig['paths']): Promise<void> {
  const unique = new Set(Object.values(pathsConfig));
  for (const entry of unique) {
    await resetDirectory(entry);
  }
}

async function resetDirectory(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => runResourceCleanups());
  await setupExternalInfrastructure();

  const hardTimeout = setTimeout(() => {
    console.error(
      `[benchmark] Forcing exit after ${TEST_TIMEOUT_MS}ms without completing benchmark`
    );
    if (typeof process.exitCode !== 'number' || process.exitCode === 0) {
      process.exitCode = 1;
    }
    scheduleForcedExit({
      exitCode: process.exitCode,
      name: 'examples-environmentalObservatoryEventDrivenBenchmark.e2e',
      gracePeriodMs: 100
    });
  }, TEST_TIMEOUT_MS);
  hardTimeout.unref();
  registerCleanup(() => clearTimeout(hardTimeout));

  registerCleanup(() => shutdownEmbeddedPostgres());
  await withServer(async (app, context) => {
    await runBenchmarkScenario(app, context);
  });
  await runResourceCleanups();
}, { name: 'examples-environmentalObservatoryEventDrivenBenchmark.e2e' });
function resolveInstrumentCount(): number {
  const raw = process.env.OBSERVATORY_BENCH_INSTRUMENTS ?? process.env.OBSERVATORY_BENCH_INSTRUMENT_COUNT;
  if (!raw) {
    return DEFAULT_INSTRUMENT_COUNT;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[benchmark] ignoring invalid instrument count '${raw}', using default ${DEFAULT_INSTRUMENT_COUNT}`
    );
    return DEFAULT_INSTRUMENT_COUNT;
  }
  return Math.min(Math.floor(parsed), 10_000);
}
