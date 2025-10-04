import { mkdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
  type S3ServiceException
} from '@aws-sdk/client-s3';
import { resolveContainerPath as resolveSharedContainerPath } from './containerPaths';
import { createEventDrivenObservatoryConfig } from './observatoryEventDrivenConfig';
import type { JsonObject, JsonValue, WorkflowDefinitionTemplate } from './types';

export type EventDrivenObservatoryConfig = ReturnType<typeof createEventDrivenObservatoryConfig>['config'];

const OBSERVATORY_MODULE_ID = 'github.com/apphub/modules/environmental-observatory/resources';
const DEFAULT_OBSERVATORY_BACKEND_MOUNT_KEY = process.env.OBSERVATORY_FILESTORE_MOUNT_KEY
  ? process.env.OBSERVATORY_FILESTORE_MOUNT_KEY.trim()
  : 'observatory-event-driven-s3';
const OBSERVATORY_WORKFLOW_SLUGS = new Set([
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication',
  'observatory-dashboard-aggregate',
  'observatory-calibration-import'
]);

const DEFAULT_CALIBRATION_NAMESPACE = 'observatory.calibrations';

function resolveContainerPath(targetPath: string): string {
  return resolveSharedContainerPath(targetPath);
}

function isWithinDirectory(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureJsonObject(value: JsonValue | undefined): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  const empty: JsonObject = {};
  return empty;
}

function ensureEventTriggers(definition: WorkflowDefinitionTemplate): JsonObject[] {
  const metadata = ensureJsonObject(definition.metadata as JsonValue | undefined);
  definition.metadata = metadata;
  const provisioning = ensureJsonObject(metadata.provisioning as JsonValue | undefined);
  metadata.provisioning = provisioning;
  const triggers = Array.isArray(provisioning.eventTriggers)
    ? (provisioning.eventTriggers as JsonValue[])
    : [];
  provisioning.eventTriggers = triggers;
  return triggers.map((trigger, index) => {
    if (trigger && typeof trigger === 'object' && !Array.isArray(trigger)) {
      return trigger as JsonObject;
    }
    const replacement: JsonObject = {};
    triggers[index] = replacement;
    return replacement;
  });
}

function applyFilestoreBackendReference(target: JsonObject, config: EventDrivenObservatoryConfig): void {
  if (target.filestoreBackendKey === undefined) {
    target.filestoreBackendKey = config.filestore.backendMountKey;
  }
  if (target.backendMountKey === undefined) {
    target.backendMountKey = config.filestore.backendMountKey;
  }
  const backendId = config.filestore.backendMountId;
  if (typeof backendId === 'number' && Number.isFinite(backendId)) {
    target.filestoreBackendId = backendId;
    target.backendMountId = backendId;
  } else if (target.filestoreBackendId === undefined) {
    target.filestoreBackendId = null;
    if (target.backendMountId === undefined) {
      target.backendMountId = null;
    }
  } else if (target.backendMountId === undefined) {
    target.backendMountId = target.filestoreBackendId;
  }
}

export type ObservatoryBootstrapLogger = {
  debug?: (meta: unknown, message?: string) => void;
  error?: (meta: unknown, message?: string) => void;
};

export function resolveObservatoryRepoRoot(): string {
  const envRoot = process.env.APPHUB_REPO_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot.trim());
  }
  return path.resolve(__dirname, '..', '..', '..');
}

export function isObservatoryModule(moduleId: string): boolean {
  return moduleId === OBSERVATORY_MODULE_ID;
}

export function resolveGeneratedObservatoryConfigPath(repoRoot: string): string {
  const dataRoot = process.env.OBSERVATORY_DATA_ROOT?.trim();
  const scratchRoot = process.env.APPHUB_SCRATCH_ROOT?.trim();
  if (dataRoot && dataRoot.length > 0) {
    return path.resolve(dataRoot, 'config', 'observatory-config.json');
  }
  if (scratchRoot && scratchRoot.length > 0) {
    return path.resolve(scratchRoot, 'observatory', 'config', 'observatory-config.json');
  }
  return path.resolve(os.tmpdir(), 'observatory', 'config', 'observatory-config.json');
}

export function isObservatoryWorkflowSlug(slug: string): boolean {
  return OBSERVATORY_WORKFLOW_SLUGS.has(slug);
}

export function applyObservatoryWorkflowDefaults(
  definition: WorkflowDefinitionTemplate,
  config: EventDrivenObservatoryConfig
): void {
  if (!OBSERVATORY_WORKFLOW_SLUGS.has(definition.slug)) {
    return;
  }

  const defaults = ensureJsonObject(definition.defaultParameters);
  definition.defaultParameters = defaults;

  switch (definition.slug) {
    case 'observatory-minute-data-generator':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.inboxPrefix = config.filestore.inboxPrefix;
      defaults.stagingPrefix = config.filestore.stagingPrefix;
      defaults.archivePrefix = config.filestore.archivePrefix;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-data-generator';
      defaults.filestoreToken = config.filestore.token ?? null;
      if (defaults.seed === undefined || defaults.seed === null) {
        defaults.seed = 1337;
      }
      if (config.workflows.generator?.instrumentCount !== undefined) {
        defaults.instrumentCount = config.workflows.generator.instrumentCount;
      }
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace =
        defaults.metastoreNamespace ?? config.metastore?.namespace ?? 'observatory.ingest';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;

      const metadata = ensureJsonObject(definition.metadata as JsonValue | undefined);
      definition.metadata = metadata;
      const provisioning = ensureJsonObject(metadata.provisioning as JsonValue | undefined);
      metadata.provisioning = provisioning;
      const schedules = Array.isArray(provisioning.schedules)
        ? (provisioning.schedules as JsonValue[])
        : [];
      provisioning.schedules = schedules;
      for (let index = 0; index < schedules.length; index += 1) {
        const scheduleEntry = schedules[index];
        if (!scheduleEntry || typeof scheduleEntry !== 'object' || Array.isArray(scheduleEntry)) {
          continue;
        }
        const scheduleObject = scheduleEntry as JsonObject;
        const parameters = ensureJsonObject(scheduleObject.parameters as JsonValue | undefined);
        if (parameters.seed === undefined) {
          parameters.seed = '{{ defaultParameters.seed }}';
        }
        scheduleObject.parameters = parameters;
      }

      const steps = Array.isArray(definition.steps) ? definition.steps : [];
      if (steps.length > 0) {
        const stepEntry = steps[0];
        if (stepEntry && typeof stepEntry === 'object' && !Array.isArray(stepEntry)) {
          const stepObject = stepEntry as JsonObject;
          const parameters = ensureJsonObject(stepObject.parameters as JsonValue | undefined);
          const defaultMinute =
            '{{ parameters.minute | default: run.trigger.schedule.occurrence | slice: 0, 16 }}';
          if (
            typeof parameters.minute !== 'string' ||
            parameters.minute.trim().length === 0 ||
            parameters.minute.trim() === '{{ parameters.minute }}'
          ) {
            parameters.minute = defaultMinute;
          }

          if (
            typeof parameters.seed !== 'string' ||
            parameters.seed.trim().length === 0 ||
            parameters.seed.trim() === '{{ parameters.seed }}'
          ) {
            parameters.seed = '{{ parameters.seed | default: 1337 }}';
          }

          stepObject.parameters = parameters;
        }
      }
      break;
    case 'observatory-minute-ingest':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.inboxPrefix = config.filestore.inboxPrefix;
      defaults.stagingPrefix = config.filestore.stagingPrefix;
      defaults.archivePrefix = config.filestore.archivePrefix;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-inbox-normalizer';
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreDatasetName = config.timestore.datasetName ?? null;
      defaults.timestoreTableName = config.timestore.tableName ?? null;
      defaults.timestoreStorageTargetId = config.timestore.storageTargetId ?? null;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace =
        defaults.metastoreNamespace ?? config.metastore?.namespace ?? 'observatory.ingest';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      defaults.calibrationsBaseUrl =
        defaults.calibrationsBaseUrl ?? config.metastore?.baseUrl ?? null;
      defaults.calibrationsNamespace =
        defaults.calibrationsNamespace ?? 'observatory.calibrations';
      defaults.calibrationsAuthToken =
        config.metastore?.authToken ?? defaults.calibrationsAuthToken ?? null;
      break;
    case 'observatory-daily-publication':
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-visualization-runner';
      defaults.visualizationsPrefix = config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations';
      defaults.reportsPrefix = config.filestore.reportsPrefix ?? 'datasets/observatory/reports';
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? null;
      defaults.metastoreNamespace = config.metastore?.namespace ?? null;
      defaults.metastoreAuthToken = config.metastore?.authToken ?? null;

      for (const trigger of ensureEventTriggers(definition)) {
        const triggerMetadata = ensureJsonObject(trigger.metadata as JsonValue | undefined);
        trigger.metadata = triggerMetadata;

        const filestoreMetadata = ensureJsonObject(triggerMetadata.filestore as JsonValue | undefined);
        filestoreMetadata.baseUrl = config.filestore.baseUrl;
        applyFilestoreBackendReference(filestoreMetadata, config);
        filestoreMetadata.token = config.filestore.token ?? null;
        filestoreMetadata.principal = defaults.filestorePrincipal ?? null;
        triggerMetadata.filestore = filestoreMetadata;

        const pathsMetadata = ensureJsonObject(triggerMetadata.paths as JsonValue | undefined);
        pathsMetadata.visualizationsPrefix =
          config.filestore.visualizationsPrefix ?? defaults.visualizationsPrefix;
        pathsMetadata.reportsPrefix = config.filestore.reportsPrefix ?? defaults.reportsPrefix;
        triggerMetadata.paths = pathsMetadata;

        const timestoreMetadata = ensureJsonObject(triggerMetadata.timestore as JsonValue | undefined);
        timestoreMetadata.baseUrl = config.timestore.baseUrl;
        timestoreMetadata.datasetSlug = config.timestore.datasetSlug;
        timestoreMetadata.authToken = config.timestore.authToken ?? null;
        triggerMetadata.timestore = timestoreMetadata;

        const metastoreMetadata = ensureJsonObject(triggerMetadata.metastore as JsonValue | undefined);
        metastoreMetadata.baseUrl = config.metastore?.baseUrl ?? null;
        metastoreMetadata.namespace = config.metastore?.namespace ?? null;
        metastoreMetadata.authToken = config.metastore?.authToken ?? null;
        triggerMetadata.metastore = metastoreMetadata;
      }
      break;
    case 'observatory-dashboard-aggregate':
      defaults.partitionKey = defaults.partitionKey ?? null;
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-dashboard-aggregator';
      defaults.reportsPrefix = config.filestore.reportsPrefix ?? 'datasets/observatory/reports';
      defaults.overviewPrefix =
        defaults.overviewPrefix ?? config.workflows.dashboard?.overviewPrefix ?? `${config.filestore.reportsPrefix ?? 'datasets/observatory/reports'}/overview`;
      defaults.lookbackMinutes =
        defaults.lookbackMinutes ?? config.workflows.dashboard?.lookbackMinutes ?? 720;
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;

      for (const trigger of ensureEventTriggers(definition)) {
        const triggerMetadata = ensureJsonObject(trigger.metadata as JsonValue | undefined);
        trigger.metadata = triggerMetadata;

        const filestoreMetadata = ensureJsonObject(triggerMetadata.filestore as JsonValue | undefined);
        filestoreMetadata.baseUrl = config.filestore.baseUrl;
        applyFilestoreBackendReference(filestoreMetadata, config);
        filestoreMetadata.token = config.filestore.token ?? null;
        triggerMetadata.filestore = filestoreMetadata;

        const dashboardMetadata = ensureJsonObject(triggerMetadata.dashboard as JsonValue | undefined);
        dashboardMetadata.overviewPrefix =
          config.workflows.dashboard?.overviewPrefix ?? defaults.overviewPrefix;
        dashboardMetadata.lookbackMinutes =
          config.workflows.dashboard?.lookbackMinutes ?? defaults.lookbackMinutes;
        triggerMetadata.dashboard = dashboardMetadata;

        const timestoreMetadata = ensureJsonObject(triggerMetadata.timestore as JsonValue | undefined);
        timestoreMetadata.baseUrl = config.timestore.baseUrl;
        timestoreMetadata.datasetSlug = config.timestore.datasetSlug;
        timestoreMetadata.authToken = config.timestore.authToken ?? null;
        triggerMetadata.timestore = timestoreMetadata;

        const pathsMetadata = ensureJsonObject(triggerMetadata.paths as JsonValue | undefined);
        pathsMetadata.reportsPrefix = defaults.reportsPrefix;
        triggerMetadata.paths = pathsMetadata;
      }
      break;
    case 'observatory-calibration-import':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-calibration-importer';
      defaults.calibrationsPrefix =
        defaults.calibrationsPrefix ?? config.filestore.calibrationsPrefix ?? 'datasets/observatory/calibrations';
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace =
        defaults.metastoreNamespace ?? config.metastore?.namespace ?? DEFAULT_CALIBRATION_NAMESPACE;
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      break;
    case 'observatory-calibration-reprocess':
      defaults.mode = defaults.mode ?? 'all';
      defaults.selectedPartitions = Array.isArray(defaults.selectedPartitions)
        ? defaults.selectedPartitions
        : [];
      defaults.pollIntervalMs = defaults.pollIntervalMs ?? 1500;
      defaults.coreBaseUrl = config.core?.baseUrl ?? defaults.coreBaseUrl ?? null;
      defaults.coreApiToken = config.core?.apiToken ?? defaults.coreApiToken ?? null;
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-calibration-reprocessor';
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      const planNamespace =
        (config.metastore as { planNamespace?: string } | undefined)?.planNamespace ??
        config.metastore?.namespace ??
        'observatory.reprocess.plans';
      defaults.metastoreNamespace = defaults.metastoreNamespace ?? planNamespace;
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      break;
    default:
      break;
  }
}

async function ensurePaths(config: EventDrivenObservatoryConfig): Promise<void> {
  const uniquePaths = new Set<string>([
    config.paths.inbox,
    config.paths.staging,
    config.paths.archive,
    config.paths.plots,
    config.paths.reports,
    config.timestore.storageRoot ?? '',
    config.timestore.cacheDir ?? ''
  ]);

  for (const entry of uniquePaths) {
    if (!entry) {
      continue;
    }
    const containerPath = resolveContainerPath(entry);
    await mkdir(containerPath, { recursive: true });
  }
}

export type EnsureObservatoryBackendOptions = {
  logger?: ObservatoryBootstrapLogger;
};

type BackendMountRecordPayload = {
  id: number;
  mountKey: string;
  backendKind: string;
  bucket: string | null;
  prefix?: string | null;
  config?: Record<string, unknown> | null;
};

type BackendMountListEnvelope = {
  data: {
    mounts: BackendMountRecordPayload[];
    pagination: {
      nextOffset: number | null;
    };
  };
};

type BackendMountEnvelope = {
  data: BackendMountRecordPayload;
};

function stripUndefined<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || entry === null) {
      continue;
    }
    if (typeof entry === 'string' && entry.trim().length === 0) {
      continue;
    }
    result[key] = entry;
  }
  return result;
}

async function requestFilestore(
  method: 'GET' | 'POST' | 'PATCH',
  baseUrl: string,
  pathSegment: string,
  headers: Headers,
  body?: Record<string, unknown>
): Promise<unknown> {
  const requestHeaders = new Headers(headers);
  const hasBody = body !== undefined && Object.keys(body ?? {}).length > 0;
  if (hasBody) {
    requestHeaders.set('content-type', 'application/json');
  }
  const url = new URL(pathSegment, baseUrl);
  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: hasBody ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Filestore request ${method} ${url.toString()} failed: ${response.status} ${errorText}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function extractS3ErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { Code?: string }).Code;
  if (typeof code === 'string' && code.length > 0) {
    return code;
  }
  const lowerCode = (error as { code?: string }).code;
  if (typeof lowerCode === 'string' && lowerCode.length > 0) {
    return lowerCode;
  }
  const name = (error as { name?: string }).name;
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  return undefined;
}

function isMissingBucketError(error: unknown): boolean {
  const status = (error as S3ServiceException | undefined)?.$metadata?.httpStatusCode;
  if (status === 404) {
    return true;
  }
  const code = extractS3ErrorCode(error);
  if (!code) {
    return false;
  }
  const normalized = code.toLowerCase();
  return normalized === 'nosuchbucket' || normalized === 'notfound';
}

function isBucketAlreadyOwnedError(error: unknown): boolean {
  const status = (error as S3ServiceException | undefined)?.$metadata?.httpStatusCode;
  if (status === 409) {
    return true;
  }
  const code = extractS3ErrorCode(error);
  if (!code) {
    return false;
  }
  const normalized = code.toLowerCase();
  return normalized === 'bucketalreadyownedbyyou' || normalized === 'bucketalreadyexists';
}

export type S3BucketOptions = {
  bucket: string;
  endpoint?: string | null;
  region?: string | null;
  forcePathStyle?: boolean | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
};

export async function ensureS3Bucket(
  s3Config: S3BucketOptions,
  logger?: ObservatoryBootstrapLogger
): Promise<void> {
  const bucket = s3Config.bucket.trim();
  if (bucket.length === 0) {
    return;
  }

  const region = (s3Config.region ?? process.env.AWS_REGION ?? 'us-east-1').trim();
  const endpoint = s3Config.endpoint ?? process.env.AWS_S3_ENDPOINT ?? undefined;
  const accessKeyId = s3Config.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? undefined;
  const secretAccessKey = s3Config.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? undefined;
  const sessionToken = s3Config.sessionToken ?? process.env.AWS_SESSION_TOKEN ?? undefined;
  const forcePathStyle = s3Config.forcePathStyle ?? true;

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            sessionToken: sessionToken ?? undefined
          }
        : undefined
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger?.debug?.({ bucket, region, endpoint }, 'Observatory filestore bucket present');
    return;
  } catch (error) {
    if (!isMissingBucketError(error)) {
      client.destroy();
      throw error;
    }
  }

  try {
    const createInput: CreateBucketCommandInput = { Bucket: bucket };
    if (region && region.toLowerCase() !== 'us-east-1') {
      createInput.CreateBucketConfiguration = {
        LocationConstraint: region as BucketLocationConstraint
      };
    }
    await client.send(new CreateBucketCommand(createInput));
    logger?.debug?.({ bucket, region, endpoint }, 'Created observatory filestore bucket');
  } catch (error) {
    if (isBucketAlreadyOwnedError(error)) {
      logger?.debug?.({ bucket, region, endpoint }, 'Observed existing filestore bucket during creation');
    } else {
      throw error;
    }
  } finally {
    client.destroy();
  }
}

async function ensureFilestoreBucketExists(
  s3Config: S3BucketOptions,
  logger?: ObservatoryBootstrapLogger
): Promise<void> {
  await ensureS3Bucket(s3Config, logger);
}

async function findMountByKey(
  baseUrl: string,
  headers: Headers,
  mountKey: string
): Promise<BackendMountRecordPayload | null> {
  let offset = 0;
  const limit = 100;
  for (;;) {
    const response = (await requestFilestore(
      'GET',
      baseUrl,
      `/v1/backend-mounts?limit=${limit}&offset=${offset}`,
      headers
    )) as BackendMountListEnvelope;
    const envelope = response;
    const match = envelope.data.mounts.find((mount) => mount.mountKey === mountKey);
    if (match) {
      return match;
    }
    const nextOffset = envelope.data.pagination.nextOffset;
    if (nextOffset === null || nextOffset === undefined) {
      break;
    }
    offset = nextOffset;
  }
  return null;
}

export async function ensureObservatoryBackend(
  config: EventDrivenObservatoryConfig,
  options?: EnsureObservatoryBackendOptions
): Promise<number | null> {
  if (process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP === '1') {
    options?.logger?.debug?.({ reason: 'disabled' }, 'Observatory bootstrap disabled via env flag');
    return null;
  }

  await ensurePaths(config);
  const baseUrl = config.filestore.baseUrl;
  const desiredBucket = config.filestore.bucket ?? 'apphub-filestore';
  const backendMountKey = config.filestore.backendMountKey?.trim() || DEFAULT_OBSERVATORY_BACKEND_MOUNT_KEY;
  const desiredConfig = stripUndefined({
    endpoint: config.filestore.endpoint ?? 'http://127.0.0.1:9000',
    region: config.filestore.region ?? 'us-east-1',
    force_path_style: config.filestore.forcePathStyle !== false,
    accessKeyId: config.filestore.accessKeyId ?? 'apphub',
    secretAccessKey: config.filestore.secretAccessKey ?? 'apphub123',
    sessionToken: config.filestore.sessionToken ?? undefined
  });

  const headers = new Headers({
    'content-type': 'application/json',
    'x-iam-scopes': 'filestore:admin'
  });
  const token = config.filestore.token?.trim();
  if (token) {
    headers.set('authorization', `Bearer ${token}`);
  }

  const existing = await findMountByKey(baseUrl, headers, backendMountKey);
  let backendId: number;

  if (existing) {
    if (existing.backendKind !== 's3') {
      throw new Error(
        `Expected observatory filestore backend ${existing.id} to use s3, found ${existing.backendKind}`
      );
    }

    await requestFilestore('PATCH', baseUrl, `/v1/backend-mounts/${existing.id}`, headers, stripUndefined({
      bucket: desiredBucket,
      prefix: null,
      accessMode: 'rw',
      state: 'active',
      config: desiredConfig
    }));

    options?.logger?.debug?.({ backendId: existing.id }, 'Reused existing observatory filestore backend');
    backendId = existing.id;
  }
  else {
    const created = (await requestFilestore('POST', baseUrl, '/v1/backend-mounts', headers, {
      mountKey: backendMountKey,
      backendKind: 's3',
      bucket: desiredBucket,
      prefix: null,
      accessMode: 'rw',
      state: 'active',
      config: desiredConfig,
      displayName: 'Observatory (event-driven)'
    })) as BackendMountEnvelope;
    backendId = created.data.id;
    options?.logger?.debug?.({ backendId }, 'Created observatory filestore backend');
  }

  await ensureFilestoreBucketExists(
    {
      bucket: desiredBucket,
      endpoint: typeof config.filestore.endpoint === 'string' ? config.filestore.endpoint : null,
      region: typeof config.filestore.region === 'string' ? config.filestore.region : null,
      forcePathStyle:
        config.filestore.forcePathStyle !== undefined ? Boolean(config.filestore.forcePathStyle) : null,
      accessKeyId: config.filestore.accessKeyId ?? null,
      secretAccessKey: config.filestore.secretAccessKey ?? null,
      sessionToken: config.filestore.sessionToken ?? null
    },
    options?.logger
  );

  return backendId;
}

export async function loadObservatoryConfig(): Promise<EventDrivenObservatoryConfig> {
  const repoRoot = resolveObservatoryRepoRoot();
  const explicitPath = process.env.OBSERVATORY_CONFIG_PATH?.trim();
  const candidates: string[] = [];
  if (explicitPath) {
    candidates.push(path.resolve(explicitPath));
  }
  candidates.push(resolveGeneratedObservatoryConfigPath(repoRoot));

  for (const candidate of candidates) {
    try {
      const contents = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(contents) as EventDrivenObservatoryConfig;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Continue searching; fall through to generated materialization.
    }
  }

  const { config } = createEventDrivenObservatoryConfig({
    repoRoot,
    variables: process.env
  });
  return config;
}
