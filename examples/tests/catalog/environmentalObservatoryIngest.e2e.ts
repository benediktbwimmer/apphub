import '@apphub/catalog-tests/setupTestEnv';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readdir, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import duckdb from 'duckdb';
import { loadExampleWorkflowDefinition } from '../helpers/examples';
import type { ExampleJobSlug, ExampleWorkflowSlug } from '@apphub/examples-registry';
import { runE2E } from '@apphub/test-helpers';

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
process.env.APPHUB_EVENTS_MODE = 'inline';
process.env.APPHUB_DISABLE_ANALYTICS = '1';

const OBSERVATORY_BUNDLE_SLUGS: ExampleJobSlug[] = [
  'observatory-data-generator',
  'observatory-inbox-normalizer',
  'observatory-duckdb-loader',
  'observatory-visualization-runner',
  'observatory-report-publisher'
];

const OBSERVATORY_WORKFLOW_SLUGS: ExampleWorkflowSlug[] = [
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication'
];

const OBSERVATORY_WORKFLOW_DEFINITIONS = OBSERVATORY_WORKFLOW_SLUGS.map(
  loadExampleWorkflowDefinition
);

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
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

  process.env.DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/apphub`;
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

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  const previousRedisUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = 'inline';

  const storageDir = await mkdtemp(path.join(tmpdir(), 'apphub-observatory-bundles-'));
  const previousStorageDir = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageDir;

  const serviceConfigDir = await mkdtemp(path.join(tmpdir(), 'apphub-observatory-services-'));
  const serviceConfigPath = path.join(serviceConfigDir, 'service-config.json');
  await writeFile(serviceConfigPath, `${JSON.stringify({ module: 'local/test', services: [], networks: [] }, null, 2)}\n`, 'utf8');
  const previousServiceConfig = process.env.SERVICE_CONFIG_PATH;
  process.env.SERVICE_CONFIG_PATH = `!${serviceConfigPath}`;

  const { buildServer } = await import('@apphub/catalog/server');
  const app = await buildServer();
  await app.ready();

  try {
    await fn(app);
  } finally {
    await app.close();
    if (previousRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousRedisUrl;
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

async function importExampleWorkflows(app: FastifyInstance): Promise<void> {
  for (const workflow of OBSERVATORY_WORKFLOW_DEFINITIONS) {
    const response = await app.inject({
      method: 'POST',
      url: '/workflows',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`,
        'Content-Type': 'application/json'
      },
      payload: workflow
    });
    assert.equal(
      response.statusCode,
      201,
      `Failed to import workflow ${workflow.slug}: ${response.payload}`
    );
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
  if (body.data.status !== 'succeeded') {
    const runDetails = await fetchWorkflowRun(app, body.data.id);
    const detailSnippet = runDetails ? JSON.stringify(runDetails.data, null, 2) : 'unavailable';
    assert.fail(`Workflow ${slug} did not succeed (status=${body.data.status}). Details: ${detailSnippet}`);
  }
  return body.data.id;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const contents = await readFile(filePath, 'utf8');
  return JSON.parse(contents) as T;
}

async function queryDuckDbRowCount(dbPath: string): Promise<number> {
  const database = new duckdb.Database(dbPath);
  const connection = database.connect();
  try {
    const rows = await new Promise<Array<{ value: number }>>((resolve, reject) => {
      connection.all("SELECT COUNT(*) AS value FROM readings", (err, result) => {
        if (err) {
          reject(err);
        } else {
          resolve((result ?? []) as Array<{ value: number }>);
        }
      });
    });
    const value = rows[0]?.value ?? 0;
    return Number(value);
  } finally {
    connection.close();
    database.close();
  }
}

async function assertWorkflowAsset(
  app: FastifyInstance,
  slug: string,
  assetId: string,
  partitionKey: string
): Promise<void> {
  const assetsResponse = await app.inject({ method: 'GET', url: `/workflows/${slug}/assets` });
  assert.equal(assetsResponse.statusCode, 200, `Failed to fetch assets for ${slug}`);
  const body = JSON.parse(assetsResponse.payload) as {
    data: { assets: Array<{ assetId: string; latest: { partitionKey: string | null } | null }> };
  };
  const entry = body.data.assets.find((candidate) => candidate.assetId === assetId);
  assert(entry, `Asset ${assetId} not registered under ${slug}`);
  assert.equal(entry?.latest?.partitionKey, partitionKey);
}

async function runObservatoryScenario(app: FastifyInstance): Promise<void> {
  await enqueueExampleBundles(app, OBSERVATORY_BUNDLE_SLUGS);
  await waitForExampleBundles(app, OBSERVATORY_BUNDLE_SLUGS);
  for (const slug of OBSERVATORY_BUNDLE_SLUGS) {
    await importExampleBundle(app, slug);
  }
  await importExampleWorkflows(app);

  const tempRoot = await mkdtemp(path.join(tmpdir(), 'observatory-e2e-'));
  const inboxDir = path.join(tempRoot, 'inbox');
  const stagingDir = path.join(tempRoot, 'staging');
  const plotsDir = path.join(tempRoot, 'plots');
  const reportsDir = path.join(tempRoot, 'reports');
  const minute = '2030-01-01T03:30';
  const minuteKey = minute.replace(':', '-');
  const warehousePath = path.join(tempRoot, 'warehouse', 'observatory.duckdb');

  await Promise.all(
    [inboxDir, stagingDir, plotsDir, reportsDir, path.dirname(warehousePath)].map((dir) =>
      mkdir(dir, { recursive: true })
    )
  );

  try {
    await runWorkflow(app, 'observatory-minute-data-generator', minute, {
      inboxDir,
      minute,
      rowsPerInstrument: 6,
      intervalMinutes: 1,
      seed: 42
    });

    const inboxEntries = await readdir(inboxDir);
    assert.equal(inboxEntries.length, 3, 'Synthetic generator should create one CSV per instrument');

    await runWorkflow(app, 'observatory-minute-ingest', minute, {
      inboxDir,
      stagingDir,
      warehousePath,
      minute,
      maxFiles: 64,
      vacuum: false
    });

    const stagingMinuteDir = path.join(stagingDir, minuteKey);
    const stagingEntries = await readdir(stagingMinuteDir);
    assert.equal(stagingEntries.length, 3, 'Normalizer should copy all CSVs into staging');

    const rowCount = await queryDuckDbRowCount(warehousePath);
    assert.equal(rowCount, 18, 'DuckDB loader should append 18 rows (3 instruments × 6 rows)');

    await assertWorkflowAsset(
      app,
      'observatory-minute-ingest',
      'observatory.timeseries.duckdb',
      minute
    );

    await runWorkflow(app, 'observatory-daily-publication', minute, {
      warehousePath,
      plotsDir,
      reportsDir,
      partitionKey: minute,
      lookbackMinutes: 180
    });

    const plotsMinuteDir = path.join(plotsDir, minuteKey);
    const plotEntries = await readdir(plotsMinuteDir);
    assert.equal(plotEntries.sort().join(','), 'metrics.json,pm25_trend.svg,temperature_trend.svg');

    const reportsMinuteDir = path.join(reportsDir, minuteKey);
    const reportEntries = await readdir(reportsMinuteDir);
    assert.equal(reportEntries.sort().join(','), 'status.html,status.json,status.md');
    for (const entry of reportEntries) {
      const statsResult = await stat(path.join(reportsMinuteDir, entry));
      assert(statsResult.size > 0, `Report artifact ${entry} should not be empty`);
    }

    await assertWorkflowAsset(
      app,
      'observatory-daily-publication',
      'observatory.reports.status',
      minute
    );

    const reportJson = await readJsonFile<{ summary?: { instrumentCount?: number } }>(
      path.join(reportsMinuteDir, 'status.json')
    );
    assert.equal(reportJson.summary?.instrumentCount, 3);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

runE2E(async ({ registerCleanup }) => {
  registerCleanup(() => shutdownEmbeddedPostgres());
  await withServer(runObservatoryScenario);
}, { name: 'examples-environmentalObservatoryIngest.e2e' });
