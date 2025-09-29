import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FilestoreClient,
  FilestoreClientError,
  FilestoreNodeResponse
} from '@apphub/filestore-client';
import { createObservatoryEventPublisher, toJsonRecord } from '../../shared/events';
import { pipeline } from 'node:stream/promises';

type JobRunStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

type JobRunResult = {
  status?: JobRunStatus;
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

type ObservatoryNormalizerParameters = {
  stagingDir: string;
  archiveDir: string;
  minute: string;
  maxFiles: number;
  filestoreBaseUrl: string;
  filestoreBackendId: number;
  filestoreToken?: string;
  inboxPrefix: string;
  stagingPrefix: string;
  archivePrefix: string;
  principal?: string;
  commandPath?: string;
  metastoreBaseUrl?: string;
  metastoreNamespace?: string;
  metastoreAuthToken?: string;
};

type SourceFileMetadata = {
  relativePath: string;
  site: string;
  instrumentId: string;
  rows: number;
};

type RawAssetPayload = {
  partitionKey: string;
  minute: string;
  instrumentCount: number;
  recordCount: number;
  sourceFiles: SourceFileMetadata[];
  stagingDir: string;
  stagingMinuteDir: string;
  normalizedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function ensureNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function parseParameters(raw: unknown): ObservatoryNormalizerParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const stagingDir = ensureString(
    raw.stagingDir ??
      raw.staging_dir ??
      process.env.OBSERVATORY_STAGING_PATH ??
      process.env.FILE_WATCH_STAGING_DIR,
    path.resolve(process.cwd(), 'data', 'staging')
  );
  if (!stagingDir) {
    throw new Error('stagingDir parameter is required');
  }
  const archiveDir = ensureString(
    raw.archiveDir ??
      raw.archive_dir ??
      process.env.OBSERVATORY_ARCHIVE_PATH ??
      process.env.FILE_ARCHIVE_DIR,
    path.resolve(process.cwd(), 'data', 'archive')
  );
  if (!archiveDir) {
    throw new Error('archiveDir parameter is required');
  }
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute) {
    throw new Error('minute parameter is required');
  }
  const maxFiles = Math.max(1, ensureNumber(raw.maxFiles ?? raw.max_files, 64));
  const filestoreBaseUrl =
    ensureString(
      raw.filestoreBaseUrl ??
        raw.filestore_base_url ??
        process.env.OBSERVATORY_FILESTORE_BASE_URL ??
        process.env.FILESTORE_BASE_URL,
      'http://127.0.0.1:4300'
    ) || 'http://127.0.0.1:4300';

  const backendRaw =
    raw.filestoreBackendId ??
    raw.filestore_backend_id ??
    raw.backendMountId ??
    raw.backend_mount_id ??
    process.env.OBSERVATORY_FILESTORE_BACKEND_ID ??
    process.env.FILESTORE_BACKEND_ID;
  const filestoreBackendId = ensureNumber(backendRaw, 1);

  const filestoreToken = ensureString(
    raw.filestoreToken ??
      raw.filestore_token ??
      process.env.OBSERVATORY_FILESTORE_TOKEN ??
      process.env.FILESTORE_TOKEN,
    ''
  );

  const inboxPrefix = ensureString(
    raw.inboxPrefix ??
      raw.inbox_prefix ??
      raw.filestoreInboxPrefix ??
      raw.filestore_inbox_prefix ??
      process.env.OBSERVATORY_FILESTORE_INBOX_PREFIX ??
      process.env.FILESTORE_INBOX_PREFIX,
    'datasets/observatory/inbox'
  );

  const stagingPrefix = ensureString(
    raw.stagingPrefix ??
      raw.staging_prefix ??
      raw.filestoreStagingPrefix ??
      raw.filestore_staging_prefix ??
      process.env.OBSERVATORY_FILESTORE_STAGING_PREFIX ??
      process.env.FILESTORE_STAGING_PREFIX,
    'datasets/observatory/staging'
  );

  const archivePrefix = ensureString(
    raw.archivePrefix ??
      raw.archive_prefix ??
      raw.filestoreArchivePrefix ??
      raw.filestore_archive_prefix ??
      process.env.OBSERVATORY_FILESTORE_ARCHIVE_PREFIX ??
      process.env.FILESTORE_ARCHIVE_PREFIX,
    'datasets/observatory/archive'
  );

  const principal = ensureString(
    raw.principal ?? raw.actor ?? process.env.OBSERVATORY_FILESTORE_PRINCIPAL,
    'observatory-inbox-normalizer'
  );

  const commandPath = ensureString(raw.commandPath ?? raw.command_path ?? '');

  const metastoreBaseUrl = ensureString(
    raw.metastoreBaseUrl ??
      raw.metastore_base_url ??
      process.env.OBSERVATORY_METASTORE_BASE_URL ??
      process.env.METASTORE_BASE_URL,
    ''
  );

  const metastoreNamespace = ensureString(
    raw.metastoreNamespace ??
      raw.metastore_namespace ??
      process.env.OBSERVATORY_METASTORE_INGEST_NAMESPACE ??
      process.env.OBSERVATORY_METASTORE_NAMESPACE ??
      'observatory.ingest'
  );

  const metastoreAuthToken = ensureString(
    raw.metastoreAuthToken ??
      raw.metastore_auth_token ??
      process.env.OBSERVATORY_METASTORE_TOKEN ??
      process.env.METASTORE_AUTH_TOKEN,
    ''
  );

  return {
    stagingDir,
    archiveDir,
    minute,
    maxFiles,
    filestoreBaseUrl,
    filestoreBackendId,
    filestoreToken: filestoreToken || undefined,
    inboxPrefix,
    stagingPrefix,
    archivePrefix,
    principal: principal || undefined,
    commandPath: commandPath || undefined,
    metastoreBaseUrl: metastoreBaseUrl ? normalizeBaseUrl(metastoreBaseUrl) : undefined,
    metastoreNamespace: (metastoreNamespace || 'observatory.ingest').trim() || 'observatory.ingest',
    metastoreAuthToken: metastoreAuthToken || undefined
  } satisfies ObservatoryNormalizerParameters;
}

async function ensureFilestoreHierarchy(
  client: FilestoreClient,
  backendMountId: number,
  prefix: string,
  principal?: string
): Promise<void> {
  const trimmed = prefix.replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    return;
  }
  const segments = trimmed.split('/');
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    try {
      await client.createDirectory({
        backendMountId,
        path: current,
        principal,
        idempotencyKey: `ensure-${backendMountId}-${current}`
      });
    } catch (err) {
      if (err instanceof FilestoreClientError && err.code === 'NODE_EXISTS') {
        continue;
      }
      throw err;
    }
  }
}

async function collectInboxNodes(
  client: FilestoreClient,
  parameters: ObservatoryNormalizerParameters,
  minuteSuffixes: string[]
): Promise<FilestoreNodeResponse[]> {
  const matches: FilestoreNodeResponse[] = [];
  let offset: number | undefined = 0;
  const limit = Math.min(Math.max(parameters.maxFiles * 2, 50), 200);
  const normalizedPrefix = parameters.inboxPrefix.replace(/\/+$/g, '');

  while (matches.length < parameters.maxFiles) {
    const result = await client.listNodes({
      backendMountId: parameters.filestoreBackendId,
      path: normalizedPrefix,
      limit,
      offset,
      depth: 1,
      kinds: ['file']
    });

    for (const node of result.nodes) {
      if (nodeMatchesMinute(node, parameters.minute, minuteSuffixes)) {
        matches.push(node);
      }
      if (matches.length >= parameters.maxFiles) {
        break;
      }
    }

    if (!result.nextOffset || matches.length >= parameters.maxFiles) {
      break;
    }
    offset = result.nextOffset ?? undefined;
    if (offset === undefined) {
      break;
    }
  }

  return matches.slice(0, parameters.maxFiles);
}

function deriveMinuteSuffixes(minute: string): string[] {
  const trimmed = minute.trim();
  const suffixes = new Set<string>();
  if (trimmed) {
    suffixes.add(`${trimmed}.csv`);
  }
  const digitsOnly = trimmed.replace(/[^0-9]/g, '');
  if (digitsOnly.length >= 10) {
    suffixes.add(`${digitsOnly}.csv`);
  }
  return Array.from(suffixes);
}

function parseInstrumentId(filename: string): string {
  const match = filename.match(/instrument_(.+?)_\d{12}\.csv$/i);
  if (match?.[1]) {
    return match[1];
  }
  const fallback = filename.replace(/\.csv$/i, '');
  return fallback;
}

function sanitizePathSegment(value: string, fallback: string): string {
  const trimmed = value.trim();
  const sanitized = trimmed.replace(/[^0-9A-Za-z._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return sanitized || fallback;
}

type ArchivePlacement = {
  directory: string;
  destination: string;
};

type MetastoreConfig = {
  baseUrl: string;
  namespace: string;
  authToken?: string;
};

type MetastoreRecord = {
  metadata: Record<string, unknown>;
  version: number;
};

const INGEST_RECORD_TYPE = 'observatory.ingest.file';

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeRecordKey(value: string): string {
  return value
    ? value.replace(/[^0-9A-Za-z._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
    : '';
}

function deriveArchivePlacement(
  archiveRoot: string,
  instrumentId: string,
  minuteKey: string,
  filename: string
): ArchivePlacement {
  const sanitizedInstrument = sanitizePathSegment(
    instrumentId || 'unknown-instrument',
    'unknown-instrument'
  );

  let hourSegment = '';
  let minuteFilename = '';
  const timestampDigits = filename.match(/_(\d{12})\.csv$/i)?.[1] ?? '';

  if (timestampDigits.length === 12) {
    const year = timestampDigits.slice(0, 4);
    const month = timestampDigits.slice(4, 6);
    const day = timestampDigits.slice(6, 8);
    const hour = timestampDigits.slice(8, 10);
    const minute = timestampDigits.slice(10, 12);
    hourSegment = `${year}-${month}-${day}T${hour}`;
    minuteFilename = `${minute}.csv`;
  } else {
    const isoMatch = minuteKey.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
    if (isoMatch) {
      const [, datePart, hourPart, minutePart] = isoMatch;
      hourSegment = `${datePart}T${hourPart}`;
      minuteFilename = `${minutePart}.csv`;
    } else {
      hourSegment = 'unknown-hour';
      minuteFilename = `${sanitizePathSegment(minuteKey || 'minute', 'minute')}.csv`;
    }
  }

  const directory = path.resolve(archiveRoot, sanitizedInstrument, hourSegment);
  const destination = path.resolve(directory, minuteFilename);
  return { directory, destination } satisfies ArchivePlacement;
}

function toMetastoreConfig(parameters: ObservatoryNormalizerParameters): MetastoreConfig | null {
  if (!parameters.metastoreBaseUrl) {
    return null;
  }
  const namespace = parameters.metastoreNamespace?.trim() || 'observatory.ingest';
  return {
    baseUrl: normalizeBaseUrl(parameters.metastoreBaseUrl),
    namespace,
    authToken: parameters.metastoreAuthToken?.trim() || undefined
  } satisfies MetastoreConfig;
}

function toRecordMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function getRecordStatus(metadata: Record<string, unknown>): string | null {
  const status = metadata.status;
  return typeof status === 'string' ? status : null;
}

async function fetchMetastoreRecord(
  config: MetastoreConfig,
  key: string
): Promise<MetastoreRecord | null> {
  const recordKey = sanitizeRecordKey(key);
  if (!recordKey) {
    return null;
  }

  const url = `${config.baseUrl}/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(recordKey)}`;
  const headers: Record<string, string> = {};
  if (config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch metastore record ${config.namespace}/${recordKey}: ${errorText}`);
  }

  const payload = (await response.json()) as {
    record?: { metadata?: unknown; version?: number } | null;
  };
  const metadata = toRecordMetadata(payload.record?.metadata);
  const versionRaw = payload.record?.version;
  const version = typeof versionRaw === 'number' && Number.isFinite(versionRaw) ? versionRaw : 0;
  return { metadata, version } satisfies MetastoreRecord;
}

async function upsertMetastoreRecord(
  config: MetastoreConfig,
  key: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const recordKey = sanitizeRecordKey(key);
  if (!recordKey) {
    throw new Error('Metastore record key must not be empty');
  }

  const url = `${config.baseUrl}/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(recordKey)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json'
  };
  if (config.authToken) {
    headers.authorization = `Bearer ${config.authToken}`;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ metadata })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to upsert metastore record ${config.namespace}/${recordKey}: ${errorText}`);
  }
}

function nodeMatchesMinute(
  node: FilestoreNodeResponse,
  minute: string,
  minuteSuffixes: string[]
): boolean {
  const filename = node.path.split('/').pop() ?? '';
  const metadata =
    node.metadata && typeof node.metadata === 'object'
      ? (node.metadata as Record<string, unknown>)
      : {};
  const metadataMinute = ensureString(
    metadata.minute ?? metadata.minuteKey ?? metadata.minute_key ?? metadata.minuteIso ?? metadata.minute_iso
  );
  const normalizedMinute = minute.replace(/:/g, '-');
  if (metadataMinute) {
    if (metadataMinute === minute || metadataMinute === normalizedMinute) {
      return true;
    }
  }
  const metadataIso = ensureString(metadata.minuteIso ?? metadata.minute_iso);
  if (metadataIso && metadataIso === minute) {
    return true;
  }
  return minuteSuffixes.some((suffix) => filename.endsWith(suffix));
}

async function loadNodeFromCommandPath(
  client: FilestoreClient,
  backendMountId: number,
  commandPath: string,
  minute: string,
  minuteSuffixes: string[]
): Promise<FilestoreNodeResponse | null> {
  try {
    const node = await client.getNodeByPath({ backendMountId, path: commandPath });
    if (nodeMatchesMinute(node, minute, minuteSuffixes)) {
      return node;
    }
    return null;
  } catch (err) {
    if (err instanceof FilestoreClientError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

type ParsedCsvMetadata = {
  rows: number;
  site: string;
};

function parseCsv(content: string): ParsedCsvMetadata {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) {
    return { rows: 0, site: '' };
  }
  const headers = lines[0]?.split(',').map((entry) => entry.trim()) ?? [];
  const siteIndex = headers.indexOf('site');
  const rows = lines.length - 1;
  let site = '';
  if (siteIndex !== -1) {
    for (let index = 1; index < lines.length; index += 1) {
      const parts = lines[index]?.split(',') ?? [];
      const candidate = parts[siteIndex]?.trim();
      if (candidate) {
        site = candidate;
        break;
      }
    }
  }
  return { rows, site } satisfies ParsedCsvMetadata;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const observatoryEvents = createObservatoryEventPublisher({
    source: 'observatory.inbox-normalizer'
  });

  try {
  const minuteSuffixes = deriveMinuteSuffixes(parameters.minute);
  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-inbox-normalizer/0.2.0'
  });

  if (
    parameters.commandPath &&
    !parameters.commandPath.startsWith(parameters.inboxPrefix.replace(/\/+$/g, '') + '/')
  ) {
    context.logger('Skipping filestore command outside inbox prefix', {
      commandPath: parameters.commandPath,
      inboxPrefix: parameters.inboxPrefix
    });
    return {
      status: 'succeeded',
      result: {
        skipped: true,
        reason: 'Command path outside inbox prefix'
      }
    } satisfies JobRunResult;
  }

  const metastoreConfig = toMetastoreConfig(parameters);
  const normalizedCommandPath = parameters.commandPath?.replace(/^\/+/, '') ?? null;
  const recordKeySource = normalizedCommandPath ?? parameters.minute;
  const existingRecord =
    metastoreConfig && normalizedCommandPath
      ? await fetchMetastoreRecord(metastoreConfig, normalizedCommandPath)
      : null;
  const existingMetadata = toRecordMetadata(existingRecord?.metadata);
  const existingStatus = getRecordStatus(existingMetadata);

  const stagingSubdir = parameters.minute.replace(':', '-');
  const stagingMinuteDir = path.resolve(parameters.stagingDir, stagingSubdir);
  await mkdir(parameters.stagingDir, { recursive: true });
  await mkdir(stagingMinuteDir, { recursive: true });

  const normalizedStagingPrefix = parameters.stagingPrefix.replace(/\/+$/g, '');
  const stagingMinutePrefix = `${normalizedStagingPrefix}/${stagingSubdir}`;
  await ensureFilestoreHierarchy(
    filestoreClient,
    parameters.filestoreBackendId,
    stagingMinutePrefix,
    parameters.principal
  );

  let inboxNode: FilestoreNodeResponse | null = null;
  if (normalizedCommandPath) {
    inboxNode = await loadNodeFromCommandPath(
      filestoreClient,
      parameters.filestoreBackendId,
      normalizedCommandPath,
      parameters.minute,
      minuteSuffixes
    );
  }

  if (!inboxNode) {
    const fallbackNodes = await collectInboxNodes(filestoreClient, parameters, minuteSuffixes);
    inboxNode = fallbackNodes[0] ?? null;
  }

  const sourceFiles: SourceFileMetadata[] = [];
  let recordCount = 0;
  const instrumentIds = new Set<string>();
  let normalizedAt = new Date().toISOString();

  if (!inboxNode) {
    if (normalizedCommandPath && existingStatus === 'processed') {
      const rows =
        typeof existingMetadata.rows === 'number' && Number.isFinite(existingMetadata.rows)
          ? existingMetadata.rows
          : 0;
      const instrumentId = ensureString(existingMetadata.instrumentId);
      const site = ensureString(existingMetadata.site);
      const stagingRelative = ensureString(existingMetadata.stagingRelativePath);
      if (!stagingRelative) {
        throw new Error(
          `Metastore record for ${normalizedCommandPath} is missing stagingRelativePath`
        );
      }
      const normalizedRelative = stagingRelative.split(path.sep).join('/');
      sourceFiles.push({
        relativePath: normalizedRelative,
        site,
        instrumentId,
        rows
      });
      if (instrumentId) {
        instrumentIds.add(instrumentId);
      }
      recordCount = rows;
      normalizedAt = ensureString(existingMetadata.processedAt) || normalizedAt;

      const payload: RawAssetPayload = {
        partitionKey: parameters.minute,
        minute: parameters.minute,
        instrumentCount: instrumentIds.size || (instrumentId ? 1 : 0),
        recordCount,
        sourceFiles,
        stagingDir: parameters.stagingDir,
        stagingMinuteDir,
        normalizedAt
      } satisfies RawAssetPayload;

      context.logger('Replaying normalization from metastore record', {
        minute: parameters.minute,
        commandPath: normalizedCommandPath,
        recordCount,
        instrumentCount: payload.instrumentCount
      });

      await context.update({
        filesProcessed: sourceFiles.length,
        recordCount,
        filesArchived: sourceFiles.length,
        replayed: true
      });

      return {
        status: 'succeeded',
        result: {
          partitionKey: parameters.minute,
          normalized: payload,
          assets: [
            {
              assetId: 'observatory.timeseries.raw',
              partitionKey: parameters.minute,
              producedAt: normalizedAt,
              payload
            }
          ]
        }
      } satisfies JobRunResult;
    }

    const missingPath = normalizedCommandPath
      ? `Inbox file ${normalizedCommandPath} not found for minute ${parameters.minute}`
      : `No inbox files matching minute ${parameters.minute} under ${parameters.inboxPrefix}`;
    throw new Error(missingPath);
  }

  const filename = inboxNode.path.split('/').pop() ?? '';
  const stagingRelativePath = path.join(stagingSubdir, filename);
  const stagingRelativePosix = stagingRelativePath.split(path.sep).join('/');
  const stagingTargetPath = `${stagingMinutePrefix}/${filename}`;

  let stagingNode: FilestoreNodeResponse | null = null;
  try {
    const copyResponse = await filestoreClient.copyNode({
      backendMountId: parameters.filestoreBackendId,
      path: inboxNode.path,
      targetPath: stagingTargetPath,
      overwrite: true,
      principal: parameters.principal
    });
    stagingNode = copyResponse.node;
  } catch (err) {
    context.logger('Filestore copy failed', {
      error: err instanceof FilestoreClientError ? err.message : String(err),
      code: err instanceof FilestoreClientError ? err.code : undefined,
      statusCode: err instanceof FilestoreClientError ? err.statusCode : undefined,
      details: err instanceof FilestoreClientError ? err.details : undefined,
      path: inboxNode.path,
      targetPath: stagingTargetPath
    });
    throw err;
  }

  if (!stagingNode) {
    stagingNode = await filestoreClient.getNodeByPath({
      backendMountId: parameters.filestoreBackendId,
      path: stagingTargetPath
    });
  }

  const download = await filestoreClient.downloadFile(stagingNode.id, {
    principal: parameters.principal
  });
  const stagingAbsolutePath = path.resolve(parameters.stagingDir, stagingRelativePath);
  await pipeline(download.stream, createWriteStream(stagingAbsolutePath));

  const metadata =
    inboxNode.metadata && typeof inboxNode.metadata === 'object'
      ? (inboxNode.metadata as Record<string, unknown>)
      : {};

  const inferredInstrumentId = ensureString(metadata.instrumentId ?? metadata.instrument_id)
    || parseInstrumentId(filename);

  const archivePlacement = deriveArchivePlacement(
    parameters.archiveDir,
    inferredInstrumentId,
    parameters.minute,
    filename
  );

  const archiveRelative = path
    .relative(parameters.archiveDir, archivePlacement.destination)
    .split(path.sep)
    .join('/');
  const normalizedArchivePrefix = parameters.archivePrefix.replace(/\/+$/g, '');
  const archiveTargetPath = `${normalizedArchivePrefix}/${archiveRelative}`;
  const archiveTargetDir = archiveTargetPath.split('/').slice(0, -1).join('/');
  if (archiveTargetDir) {
    await ensureFilestoreHierarchy(
      filestoreClient,
      parameters.filestoreBackendId,
      archiveTargetDir,
      parameters.principal
    );
  }

  try {
    await filestoreClient.moveNode({
      backendMountId: parameters.filestoreBackendId,
      path: inboxNode.path,
      targetPath: archiveTargetPath,
      overwrite: true,
      principal: parameters.principal
    });
  } catch (err) {
    context.logger('Filestore move failed', {
      error: err instanceof FilestoreClientError ? err.message : String(err),
      code: err instanceof FilestoreClientError ? err.code : undefined,
      statusCode: err instanceof FilestoreClientError ? err.statusCode : undefined,
      details: err instanceof FilestoreClientError ? err.details : undefined,
      path: inboxNode.path,
      targetPath: archiveTargetPath
    });
    throw err;
  }

  const content = await readFile(stagingAbsolutePath, 'utf8');
  const { rows, site } = parseCsv(content);

  recordCount = rows;

  if (inferredInstrumentId) {
    instrumentIds.add(inferredInstrumentId);
  }

  const sourceSite = site || ensureString(metadata.site ?? metadata.location ?? '');
  sourceFiles.push({
    relativePath: stagingRelativePosix,
    site: sourceSite,
    instrumentId: inferredInstrumentId,
    rows
  });

  normalizedAt = new Date().toISOString();
  const payload: RawAssetPayload = {
    partitionKey: parameters.minute,
    minute: parameters.minute,
    instrumentCount: instrumentIds.size,
    recordCount,
    sourceFiles,
    stagingDir: parameters.stagingDir,
    stagingMinuteDir,
    normalizedAt
  } satisfies RawAssetPayload;

  if (metastoreConfig) {
    const primarySource = sourceFiles[0];
    const stagingFilestorePath = primarySource
      ? `${stagingMinutePrefix}/${primarySource.relativePath.split('/').pop() ?? ''}`
      : null;
    const updatedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      type: existingMetadata.type ?? INGEST_RECORD_TYPE,
      status: 'processed',
      processedAt: normalizedAt,
      minute: parameters.minute,
      minuteKey: stagingSubdir,
      instrumentId: primarySource?.instrumentId ?? existingMetadata.instrumentId ?? null,
      site: primarySource?.site ?? sourceSite ?? existingMetadata.site ?? null,
      rows: recordCount,
      instrumentCount: instrumentIds.size,
      filestorePath: normalizedCommandPath ?? existingMetadata.filestorePath ?? null,
      stagingPath: stagingFilestorePath ?? existingMetadata.stagingPath ?? null,
      stagingRelativePath: primarySource?.relativePath ?? existingMetadata.stagingRelativePath ?? null,
      archivePath: archiveTargetPath ?? existingMetadata.archivePath ?? null,
      archiveLocalPath: archivePlacement.destination ?? existingMetadata.archiveLocalPath ?? null
    };
    await upsertMetastoreRecord(metastoreConfig, recordKeySource, updatedMetadata);
  }

  await context.update({
    filesProcessed: sourceFiles.length,
    recordCount,
    filesArchived: sourceFiles.length,
    instrumentId: sourceFiles[0]?.instrumentId ?? null
  });

  context.logger('Normalized observatory inbox file', {
    minute: parameters.minute,
    filesProcessed: sourceFiles.length,
    recordCount,
    instrumentId: sourceFiles[0]?.instrumentId ?? null,
    stagingPrefix: stagingMinutePrefix,
    archivePrefix: parameters.archivePrefix
  });

  if (inboxNode) {
    const observedAt = inboxNode.observedAt ?? normalizedAt;
    const metadataRecord = toJsonRecord({
      minute: parameters.minute,
      commandPath: normalizedCommandPath,
      stagingPrefix: stagingMinutePrefix,
      archivePrefix: parameters.archivePrefix,
      files: sourceFiles
    });

    await observatoryEvents.publish({
      type: 'observatory.minute.raw-uploaded',
      payload: {
        minute: parameters.minute,
        observedAt,
        backendMountId: parameters.filestoreBackendId,
        nodeId: inboxNode.id ?? null,
        path: inboxNode.path,
        instrumentId: sourceFiles[0]?.instrumentId ?? null,
        site: sourceFiles[0]?.site ?? null,
        metadata: metadataRecord,
        principal: parameters.principal ?? null,
        sizeBytes: inboxNode.sizeBytes ?? null,
        checksum: inboxNode.checksum ?? null
      }
    });
  }

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.minute,
      normalized: payload,
      assets: [
        {
          assetId: 'observatory.timeseries.raw',
          partitionKey: parameters.minute,
          producedAt: normalizedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
  } finally {
    await observatoryEvents.close().catch(() => undefined);
  }
}

export default handler;
