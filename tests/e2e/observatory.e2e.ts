import path from 'node:path';
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
import {
  CoreClient,
  waitForRunStatus,
  waitForLatestRun,
  type WaitForRunPollEvent
} from './lib/coreClient';
import { createFilestoreClient } from './lib/filestoreClient';
import { TimestoreClient } from './lib/timestoreClient';
import { analyzeLogs } from './lib/logs';
import { runCommand } from './lib/process';

const SKIP_STACK = process.env.APPHUB_E2E_SKIP_STACK === '1';
const BURST_QUIET_MS = 5_000;
const SNAPSHOT_FRESHNESS_MS = 60_000;
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

type AssetHistoryEntry = {
  producedAt?: string;
  partitionKey?: string | null;
  freshness?: {
    ttlMs?: number | null;
  } | null;
  payload?: Record<string, unknown> | null;
};

async function fetchAssetHistory(
  workflowSlug: string,
  assetId: string,
  options: { partitionKey?: string; limit?: number } = {}
): Promise<AssetHistoryEntry[]> {
  const { partitionKey, limit } = options;
  const search = new URLSearchParams();
  if (limit !== undefined) {
    search.set('limit', String(limit));
  }
  if (partitionKey) {
    search.set('partitionKey', partitionKey);
  }
  const url = `${CORE_BASE_URL}/workflows/${encodeURIComponent(workflowSlug)}/assets/${encodeURIComponent(assetId)}/history${search.size ? `?${search.toString()}` : ''}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${OPERATOR_TOKEN}` }
  });
  assert.equal(response.status, 200, `failed to fetch asset history for ${assetId} (${response.status})`);
  const body = (await response.json()) as {
    data?: { history?: AssetHistoryEntry[] };
  };
  return body.data?.history ?? [];
}

test('environmental observatory end-to-end pipeline', async (t) => {
  const skipStack = SKIP_STACK;
  console.log(`[observatory-e2e] invoking startStack (skipUp=${skipStack})`);
  const stack = await startStack({ skipUp: SKIP_STACK });
  const log = (message: string) => {
    const line = `[observatory-e2e] ${message}`;
    console.log(line);
    t.diagnostic(line);
  };
  const createWaitLogger = (label: string) => {
    return (event: WaitForRunPollEvent) => {
      if (event.phase === 'sleep' && event.attempt % 5 !== 0) {
        return;
      }
      const parts = [
        `[wait:${label}] phase=${event.phase}`,
        `attempt=${event.attempt}`,
        `remaining=${Math.ceil(event.remainingMs / 1000)}s`
      ];
      if (event.status) {
        parts.push(`status=${event.status}`);
      }
      if (event.note) {
        parts.push(event.note);
      }
      if (event.slug) {
        parts.push(`slug=${event.slug}`);
      }
      if (event.runId) {
        parts.push(`runId=${event.runId}`);
      }
      const line = parts.join(' ');
      console.log(line);
      t.diagnostic(line);
    };
  };

  log('stack started');
  const logStart = new Date();
  if (!SKIP_STACK) {
    t.after(async () => {
      await stack.stop();
    });
  }

  const healthHeaders = { Authorization: `Bearer ${OPERATOR_TOKEN}` };
  log('waiting for core /health');
  await waitForEndpoint(`${CORE_BASE_URL}/health`, { headers: healthHeaders });
  log('waiting for metastore /health');
  await waitForEndpoint(`${METASTORE_BASE_URL}/health`, { headers: healthHeaders });
  log('waiting for timestore /health');
  await waitForEndpoint(`${TIMESTORE_BASE_URL}/health`, { headers: healthHeaders });
  log('waiting for filestore /health');
  await waitForEndpoint(`${FILESTORE_BASE_URL}/health`, { headers: healthHeaders });
  log('service health checks succeeded');

  const scratchRoot = '/tmp/apphub';
  const configOutputPath = path.join(scratchRoot, 'config', 'observatory-config.json');
  const dataRoot = path.join(scratchRoot, 'data');
  await fs.rm(scratchRoot, { recursive: true, force: true });
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
    OBSERVATORY_METASTORE_BASE_URL: METASTORE_BASE_URL,
    OBSERVATORY_TIMESTORE_DATASET_SLUG: DATASET_SLUG,
    OBSERVATORY_TIMESTORE_TABLE_NAME: 'observations',
    OBSERVATORY_SKIP_GENERATOR_SCHEDULE: '1',
    APPHUB_RUNTIME_SCRATCH_ROOT: '/tmp/apphub',
    APPHUB_RUNTIME_SCRATCH_ROOT: '/tmp/apphub',
    OBSERVATORY_DASHBOARD_BURST_QUIET_MS: String(BURST_QUIET_MS),
    OBSERVATORY_DASHBOARD_SNAPSHOT_FRESHNESS_MS: String(SNAPSHOT_FRESHNESS_MS),
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
    OBSERVATORY_METASTORE_BASE_URL: 'http://metastore:4100',
    OBSERVATORY_TIMESTORE_DATASET_SLUG: DATASET_SLUG,
    OBSERVATORY_TIMESTORE_TABLE_NAME: 'observations',
    OBSERVATORY_TIMESTORE_DATASET_NAME: 'Observatory Time Series',
    OBSERVATORY_SKIP_GENERATOR_SCHEDULE: '1',
    OBSERVATORY_DASHBOARD_BURST_QUIET_MS: String(BURST_QUIET_MS),
    OBSERVATORY_DASHBOARD_SNAPSHOT_FRESHNESS_MS: String(SNAPSHOT_FRESHNESS_MS),
    SERVICE_REGISTRY_TOKEN: OPERATOR_TOKEN,
    AWS_ACCESS_KEY_ID: 'apphub',
    AWS_SECRET_ACCESS_KEY: 'apphub123',
    AWS_REGION: 'us-east-1',
    APPHUB_SCRATCH_ROOT: containerScratchRoot,
    APPHUB_E2E_OPERATOR_TOKEN: OPERATOR_TOKEN
  };

  log('building CLI workspace');
  await runCommand(['npm', 'run', 'build', '--workspace', '@apphub/cli'], {
    env: hostDeploymentEnv
  });
  log('building module workspace');
  await runCommand(['npm', 'run', 'build', '--workspace', '@apphub/environmental-observatory-module'], {
    env: hostDeploymentEnv
  });

  const dockerEnvEntries = Object.entries({
    ...(stack.environment ?? {}),
    ...containerDeploymentEnv
  })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`);

  log('deploying module via docker exec');
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
  log('listing filestore backend mounts');
  const backendMounts = await filestoreClient.listBackendMounts({ limit: 20 });
  const backend = backendMounts.mounts.find((mount) => mount.mountKey === 'observatory-event-driven-s3');
  if (!backend) {
    throw new Error('Observatory filestore backend not registered');
  }
  const backendMountId = backend.id;
  log(`observatory filestore backend ready (id=${backendMountId})`);

  const coreClient = new CoreClient();
  log('triggering observatory-minute-data-generator workflow');
  const generatorRun = await coreClient.runWorkflow('observatory-minute-data-generator');
  log(`generator run started (id=${generatorRun.id})`);
  const generatorCompleted = await waitForRunStatus(coreClient, generatorRun.id, ['succeeded'], {
    slug: 'observatory-minute-data-generator',
    onPoll: createWaitLogger('generator')
  });
  log(`generator run completed with status ${generatorCompleted.status}`);
  const generatorStepContext = (generatorCompleted.context ?? {}) as {
    steps?: Record<string, { result?: { partitions?: Array<{ instrumentId: string; relativePath: string; rows: number }>; generatedAt?: string } }>;
  };
  const generatorStepResult = generatorStepContext.steps?.['generate-drop']?.result;
  const generatorOutput = (generatorCompleted.output ?? generatorStepResult ?? {}) as {
    partitions?: Array<{ instrumentId: string; relativePath: string; rows: number }>;
    generatedAt?: string;
  };

  assert.ok(generatorOutput.partitions?.length, 'generator produced partitions');
  log(`generator produced ${generatorOutput.partitions?.length ?? 0} partitions`);

  const generatorCreatedAt = new Date(
    generatorCompleted.createdAt ?? generatorCompleted.startedAt ?? Date.now()
  );
  const ingestSearchStart = new Date(generatorCreatedAt.getTime() - 60_000);
  const ingestWaitLogger = createWaitLogger('ingest');

  function extractNormalized(run: WorkflowRun) {
    const outputNormalized = ((run.output ?? {}) as { normalized?: unknown }).normalized;
    const normalizedFromOutput =
      (outputNormalized as { normalized?: unknown })?.normalized ?? outputNormalized;
    const contextSteps = (run as unknown as { context?: { steps?: Record<string, any>; shared?: any } }).context;
    const normalizedFromSteps = contextSteps?.steps?.['normalize-inbox']?.result?.normalized;
    const normalizedFromShared = contextSteps?.shared?.normalized?.normalized ?? contextSteps?.shared?.normalized;
    return (normalizedFromOutput ?? normalizedFromSteps ?? normalizedFromShared ?? null) as
      | {
          minute?: string;
          partitionKey?: string;
          recordCount?: number;
          files?: Array<{ path: string; rows: number }>;
        }
      | null;
  }

  async function waitForIngestEventRuns(expectedCount: number): Promise<WorkflowRun[]> {
    const deadline = Date.now() + 240_000;
    const seen = new Map<string, WorkflowRun>();
    let attempt = 0;

    while (Date.now() <= deadline) {
      attempt += 1;
      const runs = await coreClient.listWorkflowRuns('observatory-minute-ingest', expectedCount * 3);
      ingestWaitLogger({
        attempt,
        phase: 'list',
        slug: 'observatory-minute-ingest',
        remainingMs: Math.max(0, deadline - Date.now()),
        note: `fetched ${runs.length} runs`
      });

      for (const run of runs) {
        if (new Date(run.createdAt) < ingestSearchStart) {
          continue;
        }
        const triggerType = (run.trigger as { type?: string } | null)?.type ?? null;
        if (triggerType !== 'event') {
          continue;
        }
        if (run.status !== 'succeeded') {
          continue;
        }
        seen.set(run.id, run);
      }

      if (seen.size >= expectedCount) {
        ingestWaitLogger({
          attempt,
          phase: 'found',
          slug: 'observatory-minute-ingest',
          remainingMs: Math.max(0, deadline - Date.now()),
          note: `collected ${seen.size} event runs`
        });
        return Array.from(seen.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      }

      ingestWaitLogger({
        attempt,
        phase: 'sleep',
        slug: 'observatory-minute-ingest',
        remainingMs: Math.max(0, deadline - Date.now()),
        note: `waiting for ${expectedCount - seen.size} additional event runs`
      });
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }

    ingestWaitLogger({
      attempt,
      phase: 'timeout',
      slug: 'observatory-minute-ingest',
      remainingMs: 0,
      note: `only observed ${seen.size} event runs (expected ${expectedCount})`
    });
    throw new Error(`Timed out waiting for ${expectedCount} ingest event runs`);
  }

  const expectedIngestRuns = Math.max(1, generatorOutput.partitions?.length ?? 1);
  log(`waiting for ${expectedIngestRuns} observatory-minute-ingest event runs`);
  const ingestRuns = await waitForIngestEventRuns(expectedIngestRuns);
  log(`observed ${ingestRuns.length} ingest event runs`);

  const normalizedResults = ingestRuns.map(extractNormalized);

  normalizedResults.forEach((result, index) => {
    assert.ok(result, `ingest run ${index + 1} produced normalization payload`);
    assert.ok((result?.files?.length ?? 0) === 1, `ingest run ${index + 1} normalized a single file`);
    assert.ok((result?.recordCount ?? 0) > 0, `ingest run ${index + 1} recorded rows`);
  });

  const totalRecords = normalizedResults.reduce((sum, result) => sum + (result?.recordCount ?? 0), 0);
  assert.ok(totalRecords > 0, 'ingest recorded rows across the burst');

  const primaryNormalized = normalizedResults[0];
  const ingestRun = ingestRuns[0];

  const minuteIso = toIsoMinute(
    primaryNormalized?.minute ?? generatorOutput.partitions?.[0]?.relativePath?.match(/_(\d{12})/i)?.[1] ?? ''
  );
  assert.ok(minuteIso, 'resolved ingest minute');
  const minuteDate = new Date(minuteIso);
  const queryStart = new Date(minuteDate.getTime() - 120 * 60_000);
  const queryEnd = new Date(minuteDate.getTime() + 5 * 60_000);

  const ingestPartitionKey =
    primaryNormalized?.partitionKey ??
    primaryNormalized?.minute ??
    minuteIso.slice(0, 16);
  assert.ok(ingestPartitionKey, 'resolved ingest partition key');

  const burstWindowHistory = await fetchAssetHistory('observatory-minute-ingest', 'observatory.burst.window', {
    partitionKey: ingestPartitionKey
  });
  assert.ok(burstWindowHistory.length > 0, 'burst window asset history available');
  assert.equal(
    burstWindowHistory[0]?.freshness?.ttlMs,
    BURST_QUIET_MS,
    'burst window asset carries quiet-window TTL'
  );

  log('waiting for observatory-dashboard-aggregate workflow run');
  const dashboardRun = await waitForLatestRun(coreClient, 'observatory-dashboard-aggregate', {
    after: ingestSearchStart,
    onPoll: createWaitLogger('dashboard')
  });
  log(`dashboard workflow completed with status ${dashboardRun.status}`);
  assert.equal(dashboardRun.status, 'succeeded', 'dashboard aggregation succeeded');

  log('waiting for observatory-daily-publication workflow run');
  const publicationRun = await waitForLatestRun(coreClient, 'observatory-daily-publication', {
    after: ingestSearchStart,
    onPoll: createWaitLogger('publication')
  });
  log(`publication workflow completed with status ${publicationRun.status}`);
  assert.equal(publicationRun.status, 'succeeded', 'daily publication succeeded');

  assert.ok(dashboardRun.trigger, 'dashboard run was triggered');
  const dashboardTrigger = (dashboardRun.trigger as { event?: { type?: string; payload?: Record<string, unknown> } } | null)
    ?.event ?? null;
  assert.ok(dashboardTrigger, 'dashboard trigger captured upstream event');
  assert.equal(
    dashboardTrigger?.type,
    'asset.expired',
    `dashboard run expected asset.expired trigger, received ${dashboardTrigger?.type ?? 'unknown'}`
  );
  const dashboardTriggerPayload = dashboardTrigger?.payload as
    | { assetId?: string; reason?: string; partitionKey?: string }
    | undefined;
  assert.equal(
    dashboardTriggerPayload?.assetId,
    'observatory.burst.window',
    'dashboard trigger payload references burst window asset'
  );
  assert.equal(
    dashboardTriggerPayload?.reason,
    'ttl',
    'dashboard trigger payload includes ttl reason'
  );

  const dashboardParameters = (dashboardRun.parameters ?? {}) as {
    burstReason?: string;
    burstFinishedAt?: string;
  };
  assert.equal(dashboardParameters.burstReason, 'ttl', 'dashboard parameters include burst reason');
  assert.ok(dashboardParameters.burstFinishedAt, 'dashboard parameters include burst finished timestamp');

  const dashboardOutput = (dashboardRun.output ?? {}) as {
    burst?: { reason?: string | null; finishedAt?: string | null };
    assets?: Array<{ assetId: string }>;
  };
  assert.equal(dashboardOutput.burst?.reason, 'ttl', 'dashboard output echoes burst reason');
  assert.ok(dashboardOutput.burst?.finishedAt, 'dashboard output includes burst finish timestamp');
  assert.ok(
    dashboardOutput.assets?.some((asset) => asset.assetId === 'observatory.dashboard.snapshot'),
    'dashboard aggregation produced snapshot asset'
  );

  const snapshotHistory = await fetchAssetHistory(
    'observatory-dashboard-aggregate',
    'observatory.dashboard.snapshot',
    {
      partitionKey: ingestPartitionKey
    }
  );
  assert.ok(snapshotHistory.length > 0, 'dashboard snapshot asset history available');
  assert.equal(
    snapshotHistory[0]?.freshness?.ttlMs,
    SNAPSHOT_FRESHNESS_MS,
    'dashboard snapshot asset records freshness TTL'
  );

  const publicationOutput = (publicationRun.output ?? {}) as {
    report?: {
      storagePrefix?: string;
      reportFiles?: Array<{ path: string; nodeId: number | null; mediaType?: string }>;
      plotsReferenced?: Array<{ path: string }>;
    };
    visualizations?: unknown;
  };

  const publicationContext = (publicationRun.context ?? {}) as {
    steps?: Record<
      string,
      {
        result?: {
          report?: {
            storagePrefix?: string;
            reportFiles?: Array<{ path: string; nodeId: number | null; mediaType?: string }>;
            plotsReferenced?: Array<{ path: string }>;
          };
        };
      }
    >;
  };

  const publicationReport =
    publicationOutput.report ?? publicationContext.steps?.['publish-reports']?.result?.report ?? null;

  assert.ok(publicationReport?.reportFiles?.length, 'report publisher emitted files');
  assert.ok(publicationReport?.plotsReferenced?.length, 'plots were referenced');

  const reportFile = publicationReport?.reportFiles?.find((file) =>
    file.mediaType?.includes('html')
  ) ?? publicationReport?.reportFiles?.[0];
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
  log('downloaded observatory status report');

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

  const logs = await stack.collectLogs({ since: logStart });
  const logsDir = await ensureLogsDirectory();
  const logPath = path.join(logsDir, 'observatory-e2e.log');
  await fs.writeFile(logPath, logs, 'utf8');
  log(`collected compose logs at ${logPath}`);
  const logAnalysis = analyzeLogs(logs);
  assert.equal(
    logAnalysis.errors.length,
    0,
    `expected no errors in service logs, found: ${logAnalysis.errors.join('\n')}`
  );
  log('observatory e2e validation complete');
});
