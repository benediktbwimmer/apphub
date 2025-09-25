import '@apphub/catalog-tests/setupTestEnv';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { FastifyInstance } from 'fastify';
import { loadExampleWorkflowDefinition } from '../helpers/examples';
import type { ExampleJobSlug, ExampleWorkflowSlug } from '@apphub/examples-registry';

type JobSummary = {
  slug: string;
  entryPoint: string;
};

type WorkflowSummary = {
  slug: string;
};

type ServiceSummary = {
  slug: string;
  metadata: Record<string, unknown> | null;
};

let embeddedPostgres: EmbeddedPostgres | null = null;
let embeddedPostgresCleanup: (() => Promise<void>) | null = null;

const OPERATOR_TOKEN = 'load-all-examples-operator-token';

process.env.APPHUB_OPERATOR_TOKENS = JSON.stringify([
  {
    subject: 'load-all-examples',
    token: OPERATOR_TOKEN,
    scopes: ['job-bundles:write', 'job-bundles:read', 'workflows:write', 'workflows:read']
  }
]);

process.env.APPHUB_DISABLE_ANALYTICS = '1';

const EXAMPLE_BUNDLE_SLUGS: ExampleJobSlug[] = [
  'file-relocator',
  'retail-sales-csv-loader',
  'retail-sales-parquet-builder',
  'retail-sales-visualizer',
  'fleet-telemetry-metrics',
  'greenhouse-alerts-runner',
  'observatory-data-generator',
  'observatory-inbox-normalizer',
  'observatory-duckdb-loader',
  'observatory-visualization-runner',
  'observatory-report-publisher'
];

const WORKFLOW_DEFINITION_SLUGS: ExampleWorkflowSlug[] = [
  'observatory-hourly-data-generator',
  'observatory-hourly-ingest',
  'observatory-daily-publication',
  'fleet-telemetry-daily-rollup',
  'fleet-telemetry-alerts'
];

const WORKFLOW_DEFINITIONS = WORKFLOW_DEFINITION_SLUGS.map(loadExampleWorkflowDefinition);

async function findAvailablePort(): Promise<number> {
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

async function ensureEmbeddedPostgres(): Promise<void> {
  if (embeddedPostgres) {
    return;
  }

  const dataRoot = await mkdtemp(path.join(tmpdir(), 'apphub-load-examples-pg-'));
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

async function withServer(fn: (app: FastifyInstance) => Promise<void>): Promise<void> {
  await ensureEmbeddedPostgres();
  process.env.REDIS_URL = 'inline';
  const storageDir = await mkdtemp(path.join(tmpdir(), 'apphub-load-examples-bundles-'));
  const previousStorageDir = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
  process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR = storageDir;
  const { buildServer } = await import('@apphub/catalog/server');
  const app = await buildServer();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
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
    payload: {
      slugs
    }
  });
  assert.equal(response.statusCode, 202, `Failed to enqueue example bundles: ${response.payload}`);
  const body = JSON.parse(response.payload) as {
    data: {
      jobs: Array<{ slug: string; jobId: string }>;
    };
  };
  assert.equal(body.data.jobs.length, slugs.length, 'Expected one job per example slug');
}

async function waitForExampleBundles(app: FastifyInstance, slugs: readonly string[]): Promise<void> {
  const remaining = new Set(slugs.map((slug) => slug.toLowerCase()));
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const statusResponse = await app.inject({
      method: 'GET',
      url: '/examples/bundles/status',
      headers: {
        Authorization: `Bearer ${OPERATOR_TOKEN}`
      }
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

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for example bundles: ${Array.from(remaining).join(', ')}`);
}

async function importExampleBundle(app: FastifyInstance, slug: string): Promise<void> {
  const previewResponse = await app.inject({
    method: 'POST',
    url: '/job-imports/preview',
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`
    },
    payload: {
      source: 'example',
      slug
    }
  });
  assert.equal(previewResponse.statusCode, 200, `Preview failed for ${slug}: ${previewResponse.payload}`);
  const previewBody = JSON.parse(previewResponse.payload) as {
    data: {
      bundle: {
        slug: string;
        version: string;
      };
    };
  };
  const reference = `${previewBody.data.bundle.slug}@${previewBody.data.bundle.version}`;

  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/job-imports',
    headers: {
      Authorization: `Bearer ${OPERATOR_TOKEN}`
    },
    payload: {
      source: 'example',
      slug,
      reference
    }
  });
  assert.equal(confirmResponse.statusCode, 201, `Import failed for ${slug}: ${confirmResponse.payload}`);
}

async function importExampleWorkflows(app: FastifyInstance): Promise<void> {
  for (const workflow of WORKFLOW_DEFINITIONS) {
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
      `Failed to create workflow ${workflow.slug}: ${response.payload}`
    );
  }
}

async function importServiceManifest(app: FastifyInstance): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const serviceVariables = {
    FILE_WATCH_ROOT: path.join(repoRoot, 'examples/environmental-observatory/data/inbox'),
    FILE_WATCH_STAGING_DIR: path.join(repoRoot, 'examples/environmental-observatory/data/staging'),
    FILE_WATCH_WAREHOUSE_PATH: path.join(
      repoRoot,
      'examples/environmental-observatory/data/warehouse/observatory.duckdb'
    ),
    CATALOG_API_TOKEN: OPERATOR_TOKEN
  };

  const importResponse = await app.inject({
    method: 'POST',
    url: '/service-networks/import',
    headers: {
      'Content-Type': 'application/json'
    },
    payload: {
      path: repoRoot,
      configPath: 'examples/environmental-observatory/service-manifests/service-config.json',
      module: 'github.com/apphub/examples/environmental-observatory',
      variables: serviceVariables
    }
  });
  assert.equal(
    importResponse.statusCode,
    201,
    `Service manifest import failed: ${importResponse.payload}`
  );
}

async function testLoadAllExamples(): Promise<void> {
  await withServer(async (app) => {
    const initialServicesRes = await app.inject({ method: 'GET', url: '/services' });
    assert.equal(initialServicesRes.statusCode, 200);
    const initialServicesBody = JSON.parse(initialServicesRes.payload) as { data: ServiceSummary[] };
    const initialServiceSlugs = new Set(initialServicesBody.data.map((service) => service.slug));

    const initialJobsRes = await app.inject({ method: 'GET', url: '/jobs' });
    assert.equal(initialJobsRes.statusCode, 200);
    const initialJobsBody = JSON.parse(initialJobsRes.payload) as { data: JobSummary[] };
    const initialJobSlugs = new Set(initialJobsBody.data.map((job) => job.slug));

    await importServiceManifest(app);

    await enqueueExampleBundles(app, EXAMPLE_BUNDLE_SLUGS);
    await waitForExampleBundles(app, EXAMPLE_BUNDLE_SLUGS);

    for (const slug of EXAMPLE_BUNDLE_SLUGS) {
      await importExampleBundle(app, slug);
    }

    await importExampleWorkflows(app);

    const servicesRes = await app.inject({ method: 'GET', url: '/services' });
    assert.equal(servicesRes.statusCode, 200);
    const servicesBody = JSON.parse(servicesRes.payload) as { data: ServiceSummary[] };
    const serviceSlugs = new Set(servicesBody.data.map((service) => service.slug));
    assert(serviceSlugs.has('observatory-file-watcher'), 'Service import should register observatory-file-watcher');
    assert.equal(initialServiceSlugs.has('observatory-file-watcher'), false);

    const jobsRes = await app.inject({ method: 'GET', url: '/jobs' });
    assert.equal(jobsRes.statusCode, 200);
    const jobsBody = JSON.parse(jobsRes.payload) as { data: JobSummary[] };
    const jobSlugs = new Map(jobsBody.data.map((job) => [job.slug, job.entryPoint] as const));

    for (const slug of EXAMPLE_BUNDLE_SLUGS) {
      assert(jobSlugs.has(slug), `Example job ${slug} was not registered`);
      const entryPoint = jobSlugs.get(slug)!;
      assert.match(entryPoint, new RegExp(`^bundle:${slug}@`), `Job ${slug} entry point incorrect`);
      assert.equal(initialJobSlugs.has(slug), false, `Job ${slug} unexpectedly present before import`);
    }

    const bundlesRes = await app.inject({ method: 'GET', url: '/job-bundles' });
    assert.equal(bundlesRes.statusCode, 200);
    const bundlesBody = JSON.parse(bundlesRes.payload) as {
      data: Array<{ slug: string; latestVersion: string | null }>;
    };
    const bundleSlugs = new Set(bundlesBody.data.map((bundle) => bundle.slug));
    for (const slug of EXAMPLE_BUNDLE_SLUGS) {
      assert(bundleSlugs.has(slug), `Bundle ${slug} missing from registry`);
    }

    const workflowsRes = await app.inject({ method: 'GET', url: '/workflows' });
    assert.equal(workflowsRes.statusCode, 200);
    const workflowsBody = JSON.parse(workflowsRes.payload) as { data: WorkflowSummary[] };
    const workflowSlugs = new Set(workflowsBody.data.map((workflow) => workflow.slug));
    for (const workflow of WORKFLOW_DEFINITIONS) {
      assert(workflowSlugs.has(workflow.slug), `Workflow ${workflow.slug} was not registered`);
    }
  });
}

(async function run() {
  try {
    await testLoadAllExamples();
  } finally {
    await shutdownEmbeddedPostgres();
  }
})();
