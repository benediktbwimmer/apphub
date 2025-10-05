import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetch } from 'undici';

import { startStack } from './lib/stack';
import { waitForEndpoint } from './lib/http';
import {
  CORE_BASE_URL,
  METASTORE_BASE_URL,
  TIMESTORE_BASE_URL,
  FILESTORE_BASE_URL,
  MINIO_BASE_URL,
  MINIO_PORT,
  OPERATOR_TOKEN
} from './lib/env';
import { CoreClient, waitForRunStatus, waitForLatestRun } from './lib/coreClient';
import { createFilestoreClient } from './lib/filestoreClient';
import { TimestoreClient } from './lib/timestoreClient';
import { analyzeLogs } from './lib/logs';
import { runCommand } from './lib/process';

const SKIP_STACK = process.env.APPHUB_E2E_SKIP_STACK === '1';
const DEFAULT_BUCKET = 'apphub-filestore';
const DEFAULT_JOB_BUNDLE_BUCKET = 'apphub-example-bundles';
const DEFAULT_TIMESTORE_BUCKET = 'apphub-timestore';
const DATASET_SLUG = process.env.OBSERVATORY_TIMESTORE_DATASET_SLUG ?? 'observatory-timeseries';
const repoRoot = path.resolve(__dirname, '..', '..');

const MINIO_HOST_ENDPOINT =
  process.env.APPHUB_E2E_MINIO_HOST_ENDPOINT?.trim() || `http://host.docker.internal:${MINIO_PORT}`;

if (!process.env.APPHUB_E2E_REPO_ROOT) {
  process.env.APPHUB_E2E_REPO_ROOT = repoRoot;
}

function toIsoMinute(minute: string): string {
  const trimmed = minute.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00Z`;
  }
  if (/^\d{12}$/.test(trimmed)) {
    const year = trimmed.slice(0, 4);
    const month = trimmed.slice(4, 6);
    const day = trimmed.slice(6, 8);
    const hour = trimmed.slice(8, 10);
    const minutePart = trimmed.slice(10, 12);
    return `${year}-${month}-${day}T${hour}:${minutePart}:00Z`;
  }
  throw new Error(`Unable to interpret minute string '${minute}'`);
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  await pipeline(
    stream,
    new Transform({
      transform(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      }
    })
  );
  return Buffer.concat(chunks).toString('utf8');
}

async function ensureLogsDirectory(): Promise<string> {
  const logsDir = path.resolve('logs');
  await fs.mkdir(logsDir, { recursive: true });
  return logsDir;
}

test('environmental observatory end-to-end pipeline', async (t) => {
  const stack = await startStack({ skipUp: SKIP_STACK });
  if (!SKIP_STACK) {
    t.after(async () => {
      await stack.stop();
    });
  }

  const healthHeaders = { Authorization: `Bearer ${OPERATOR_TOKEN}` };
  await waitForEndpoint(`${CORE_BASE_URL}/health`, { headers: healthHeaders });
  await waitForEndpoint(`${METASTORE_BASE_URL}/health`, { headers: healthHeaders });
  await waitForEndpoint(`${TIMESTORE_BASE_URL}/health`, { headers: healthHeaders });
  await waitForEndpoint(`${FILESTORE_BASE_URL}/health`, { headers: healthHeaders });

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-observatory-e2e-'));
  const scratchRoot = path.join(tempRoot, 'scratch');
  const configOutputPath = path.join(tempRoot, 'config', 'observatory-config.json');
  const dataRoot = path.join(tempRoot, 'data');
  await fs.mkdir(scratchRoot, { recursive: true });
  await fs.mkdir(path.dirname(configOutputPath), { recursive: true });
  await fs.mkdir(dataRoot, { recursive: true });

  const hostDeploymentEnv = {
    APPHUB_CORE_URL: CORE_BASE_URL,
    APPHUB_FILESTORE_BASE_URL: FILESTORE_BASE_URL,
    APPHUB_METASTORE_BASE_URL: METASTORE_BASE_URL,
    APPHUB_TIMESTORE_BASE_URL: TIMESTORE_BASE_URL,
    APPHUB_BUNDLE_STORAGE_ENDPOINT: MINIO_HOST_ENDPOINT,
    APPHUB_BUNDLE_STORAGE_BUCKET: DEFAULT_JOB_BUNDLE_BUCKET,
    APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID: 'apphub',
    APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY: 'apphub123',
    APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE: 'true',
    APPHUB_JOB_BUNDLE_S3_BUCKET: DEFAULT_JOB_BUNDLE_BUCKET,
    APPHUB_JOB_BUNDLE_S3_ENDPOINT: MINIO_HOST_ENDPOINT,
    APPHUB_JOB_BUNDLE_S3_REGION: 'us-east-1',
    APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE: 'true',
    APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID: 'apphub',
    APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY: 'apphub123',
    TIMESTORE_S3_BUCKET: DEFAULT_TIMESTORE_BUCKET,
    TIMESTORE_S3_ENDPOINT: MINIO_HOST_ENDPOINT,
    TIMESTORE_S3_REGION: 'us-east-1',
    TIMESTORE_S3_FORCE_PATH_STYLE: 'true',
    TIMESTORE_S3_ACCESS_KEY_ID: 'apphub',
    TIMESTORE_S3_SECRET_ACCESS_KEY: 'apphub123',
    OBSERVATORY_DATA_ROOT: dataRoot,
    OBSERVATORY_CONFIG_OUTPUT: configOutputPath,
    OBSERVATORY_CORE_BASE_URL: CORE_BASE_URL,
    OBSERVATORY_CORE_TOKEN: OPERATOR_TOKEN,
    OBSERVATORY_FILESTORE_BASE_URL: FILESTORE_BASE_URL,
    OBSERVATORY_FILESTORE_BACKEND_KEY: 'observatory-event-driven-s3',
    OBSERVATORY_FILESTORE_S3_BUCKET: DEFAULT_BUCKET,
    OBSERVATORY_FILESTORE_S3_ENDPOINT: MINIO_HOST_ENDPOINT,
    OBSERVATORY_FILESTORE_S3_REGION: 'us-east-1',
    OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE: 'true',
    OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID: 'apphub',
    OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY: 'apphub123',
    OBSERVATORY_TIMESTORE_BASE_URL: TIMESTORE_BASE_URL,
    OBSERVATORY_TIMESTORE_DATASET_SLUG: DATASET_SLUG,
    OBSERVATORY_TIMESTORE_TABLE_NAME: 'observations',
    OBSERVATORY_SKIP_GENERATOR_SCHEDULE: '1',
    SERVICE_REGISTRY_TOKEN: OPERATOR_TOKEN,
    AWS_ACCESS_KEY_ID: 'apphub',
    AWS_SECRET_ACCESS_KEY: 'apphub123',
    AWS_REGION: 'us-east-1',
    APPHUB_SCRATCH_ROOT: scratchRoot,
    APPHUB_E2E_OPERATOR_TOKEN: OPERATOR_TOKEN
  } satisfies NodeJS.ProcessEnv;

  const containerScratchRoot = '/tmp/apphub-observatory/scratch';

  const containerDeploymentEnv: NodeJS.ProcessEnv = {
    APPHUB_CORE_URL: 'http://core-api:4000',
    APPHUB_FILESTORE_BASE_URL: 'http://filestore:4300',
    APPHUB_METASTORE_BASE_URL: 'http://metastore:4100',
    APPHUB_TIMESTORE_BASE_URL: 'http://timestore:4200',
    APPHUB_BUNDLE_STORAGE_ENDPOINT: 'http://minio:9000',
    APPHUB_BUNDLE_STORAGE_BUCKET: DEFAULT_JOB_BUNDLE_BUCKET,
    APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID: 'apphub',
    APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY: 'apphub123',
    APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE: 'true',
    APPHUB_JOB_BUNDLE_S3_BUCKET: DEFAULT_JOB_BUNDLE_BUCKET,
    APPHUB_JOB_BUNDLE_S3_ENDPOINT: 'http://minio:9000',
    APPHUB_JOB_BUNDLE_S3_REGION: 'us-east-1',
    APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE: 'true',
    APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID: 'apphub',
    APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY: 'apphub123',
    TIMESTORE_S3_BUCKET: DEFAULT_TIMESTORE_BUCKET,
    TIMESTORE_S3_ENDPOINT: 'http://minio:9000',
    TIMESTORE_S3_REGION: 'us-east-1',
    TIMESTORE_S3_FORCE_PATH_STYLE: 'true',
    TIMESTORE_S3_ACCESS_KEY_ID: 'apphub',
    TIMESTORE_S3_SECRET_ACCESS_KEY: 'apphub123',
    OBSERVATORY_DATA_ROOT: `${containerScratchRoot}/data`,
    OBSERVATORY_CONFIG_OUTPUT: `${containerScratchRoot}/config/observatory-config.json`,
    OBSERVATORY_CORE_BASE_URL: 'http://core-api:4000',
    OBSERVATORY_CORE_TOKEN: OPERATOR_TOKEN,
    OBSERVATORY_FILESTORE_BASE_URL: 'http://filestore:4300',
    OBSERVATORY_FILESTORE_BACKEND_KEY: 'observatory-event-driven-s3',
    OBSERVATORY_FILESTORE_TOKEN: '',
    OBSERVATORY_FILESTORE_S3_BUCKET: DEFAULT_BUCKET,
    OBSERVATORY_FILESTORE_S3_ENDPOINT: 'http://minio:9000',
    OBSERVATORY_FILESTORE_S3_REGION: 'us-east-1',
    OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE: 'true',
    OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID: 'apphub',
    OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY: 'apphub123',
    OBSERVATORY_TIMESTORE_BASE_URL: 'http://timestore:4200',
    OBSERVATORY_TIMESTORE_DATASET_SLUG: DATASET_SLUG,
    OBSERVATORY_TIMESTORE_TABLE_NAME: 'observations',
    OBSERVATORY_TIMESTORE_DATASET_NAME: 'Observatory Time Series',
    OBSERVATORY_SKIP_GENERATOR_SCHEDULE: '1',
    SERVICE_REGISTRY_TOKEN: OPERATOR_TOKEN,
    AWS_ACCESS_KEY_ID: 'apphub',
    AWS_SECRET_ACCESS_KEY: 'apphub123',
    AWS_REGION: 'us-east-1',
    APPHUB_SCRATCH_ROOT: containerScratchRoot,
    APPHUB_E2E_OPERATOR_TOKEN: OPERATOR_TOKEN
  };

  await runCommand(['npm', 'run', 'build', '--workspace', '@apphub/cli'], {
    env: hostDeploymentEnv
  });
  await runCommand(['npm', 'run', 'build', '--workspace', '@apphub/environmental-observatory-module'], {
    env: hostDeploymentEnv
  });

  const dockerEnvEntries = Object.entries({
    ...(stack.environment ?? {}),
    ...containerDeploymentEnv
  })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);

  await runCommand(
    [
      'docker',
      'compose',
      '-p',
      stack.project,
      '-f',
      stack.composeFile,
      'exec',
      '-T',
      'core-api',
      'env',
      ...dockerEnvEntries,
      'node',
      path.join(repoRoot, 'apps/cli/dist/index.js'),
      'module',
      'deploy',
      '--module',
      path.join(repoRoot, 'modules/environmental-observatory'),
      '--core-url',
      'http://core-api:4000',
      '--core-token',
      OPERATOR_TOKEN
    ]
  );

  const filestoreClient = createFilestoreClient();
  const backendMounts = await filestoreClient.listBackendMounts({ limit: 20 });
  const backend = backendMounts.mounts.find((mount) => mount.mountKey === 'observatory-event-driven-s3');
  if (!backend) {
    throw new Error('Observatory filestore backend not registered');
  }
  const backendMountId = backend.id;

  const coreClient = new CoreClient();
  const generatorRun = await coreClient.runWorkflow('observatory-minute-data-generator');
  const generatorCompleted = await waitForRunStatus(coreClient, generatorRun.id);
  const generatorOutput = (generatorCompleted.output ?? {}) as {
    partitions?: Array<{ instrumentId: string; relativePath: string; rows: number }>;
    generatedAt?: string;
  };

  assert.ok(generatorOutput.partitions?.length, 'generator produced partitions');

  const generatorCreatedAt = new Date(generatorCompleted.createdAt ?? generatorCompleted.startedAt ?? Date.now());
  const ingestRun = await waitForLatestRun(coreClient, 'observatory-minute-ingest', {
    after: generatorCreatedAt
  });
  const ingestOutput = (ingestRun.output ?? {}) as {
    normalized?: {
      minute?: string;
      partitionKey?: string;
      recordCount?: number;
      files?: Array<{ path: string; rows: number }>;
    };
    assets?: unknown;
  };

  assert.equal(ingestRun.status, 'succeeded', 'ingest workflow succeeded');
  assert.ok(ingestOutput.normalized?.files?.length, 'ingest normalized files');
  assert.ok((ingestOutput.normalized?.recordCount ?? 0) > 0, 'ingest recorded rows');

  const minuteIso = toIsoMinute(
    ingestOutput.normalized?.minute ?? generatorOutput.partitions?.[0]?.relativePath?.match(/_(\d{12})/i)?.[1] ?? ''
  );
  assert.ok(minuteIso, 'resolved ingest minute');
  const minuteDate = new Date(minuteIso);
  const queryStart = new Date(minuteDate.getTime() - 120 * 60_000);
  const queryEnd = new Date(minuteDate.getTime() + 5 * 60_000);

  const dashboardRun = await waitForLatestRun(coreClient, 'observatory-dashboard-aggregate', {
    after: generatorCreatedAt
  });
  assert.equal(dashboardRun.status, 'succeeded', 'dashboard aggregation succeeded');

  const publicationRun = await waitForLatestRun(coreClient, 'observatory-daily-publication', {
    after: generatorCreatedAt
  });
  assert.equal(publicationRun.status, 'succeeded', 'daily publication succeeded');

  assert.ok(dashboardRun.trigger, 'dashboard run was triggered');
  const dashboardEventType =
    (dashboardRun.trigger as { event?: { type?: string } })?.event?.type ??
    (dashboardRun.trigger as { eventType?: string })?.eventType ??
    '';
  assert.ok(
    /observatory|timestore/.test(dashboardEventType),
    `dashboard run carried unexpected event type: ${dashboardEventType || 'unknown'}`
  );

  const publicationOutput = (publicationRun.output ?? {}) as {
    report?: {
      storagePrefix?: string;
      reportFiles?: Array<{ path: string; nodeId: number | null; mediaType?: string }>;
      plotsReferenced?: Array<{ path: string }>;
    };
  };

  assert.ok(publicationOutput.report?.reportFiles?.length, 'report publisher emitted files');
  assert.ok(publicationOutput.report?.plotsReferenced?.length, 'plots were referenced');

  const reportFile = publicationOutput.report.reportFiles?.find((file) =>
    file.mediaType?.includes('html')
  ) ?? publicationOutput.report?.reportFiles?.[0];
  assert.ok(reportFile, 'located report file');

  let reportNodeId = reportFile.nodeId;
  if (!reportNodeId) {
    const node = await filestoreClient.getNodeByPath({
      backendMountId,
      path: reportFile.path
    });
    reportNodeId = node.id;
  }

  const downloaded = await filestoreClient.downloadFile(reportNodeId);
  const reportBody = await streamToString(downloaded.stream);
  assert.ok(reportBody.includes('Observatory Status Report'), 'report HTML includes headline');

  const timestoreClient = new TimestoreClient();
  const queryResult = await timestoreClient.queryDataset(DATASET_SLUG, {
    timeRange: {
      start: queryStart.toISOString(),
      end: queryEnd.toISOString()
    },
    limit: 500
  });
  assert.ok(queryResult.rows.length > 0, 'timestore returned observations');

  const servicesResponse = await coreClient.listWorkflowRuns('observatory-dashboard-aggregate', 1);
  assert.ok(servicesResponse.length > 0, 'workflow run history accessible');

  const serviceList = await fetch(`${CORE_BASE_URL}/services`, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
  });
  assert.equal(serviceList.status, 200, 'service list request succeeded');
  const servicePayload = (await serviceList.json()) as {
    data?: Array<{ slug: string; status?: string }>;
  };
  const dashboardService = servicePayload.data?.find((service) => service.slug === 'observatory-dashboard');
  const adminService = servicePayload.data?.find((service) => service.slug === 'observatory-admin');
  assert.ok(dashboardService, 'dashboard service registered');
  assert.ok(adminService, 'admin service registered');

  const dashboardHealth = await fetch(`${CORE_BASE_URL}/services/observatory-dashboard/preview/healthz`, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
  });
  assert.equal(dashboardHealth.status, 200, 'dashboard service health reachable');

  const adminHealth = await fetch(`${CORE_BASE_URL}/services/observatory-admin/preview/healthz`, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
  });
  assert.equal(adminHealth.status, 200, 'admin service health reachable');

  const logs = await stack.collectLogs();
  const logsDir = await ensureLogsDirectory();
  const logPath = path.join(logsDir, 'observatory-e2e.log');
  await fs.writeFile(logPath, logs, 'utf8');
  const logAnalysis = analyzeLogs(logs);
  assert.equal(
    logAnalysis.errors.length,
    0,
    `expected no errors in service logs, found: ${logAnalysis.errors.join('\n')}`
  );
});
