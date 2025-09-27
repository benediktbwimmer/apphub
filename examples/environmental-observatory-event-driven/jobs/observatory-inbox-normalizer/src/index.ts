import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  FilestoreClient,
  FilestoreClientError,
  FilestoreNodeResponse
} from '@apphub/filestore-client';

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
      'http://127.0.0.1:4200'
    ) || 'http://127.0.0.1:4200';

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
    commandPath: commandPath || undefined
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
  const limit = Math.max(parameters.maxFiles * 2, 50);
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
      const filename = node.path.split('/').pop() ?? '';
      const metadataMinute =
        node.metadata && typeof node.metadata === 'object'
          ? (node.metadata as Record<string, unknown>).minute
          : null;
      const matchesMinuteMetadata = typeof metadataMinute === 'string' && metadataMinute === parameters.minute;
      const matchesSuffix = minuteSuffixes.some((suffix) => filename.endsWith(suffix));
      if (matchesMinuteMetadata || matchesSuffix) {
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

  const inboxNodes = await collectInboxNodes(filestoreClient, parameters, minuteSuffixes);
  if (inboxNodes.length === 0) {
    throw new Error(
      `No inbox files matching minute ${parameters.minute} under ${parameters.inboxPrefix}`
    );
  }

  const sourceFiles: SourceFileMetadata[] = [];
  let recordCount = 0;
  const instrumentIds = new Set<string>();
  const archiveOperations: Array<{ sourcePath: string; archiveDestination: string; localDestination: string }>
    = [];

  for (const node of inboxNodes) {
    const filename = node.path.split('/').pop() ?? '';
    const stagingRelativePath = path.join(stagingSubdir, filename);
    const stagingRelativePosix = stagingRelativePath.split(path.sep).join('/');
    const stagingTargetPath = `${stagingMinutePrefix}/${filename}`;

    await filestoreClient.copyNode({
      backendMountId: parameters.filestoreBackendId,
      path: node.path,
      targetPath: stagingTargetPath,
      overwrite: true,
      principal: parameters.principal
    });

    const metadata =
      node.metadata && typeof node.metadata === 'object'
        ? (node.metadata as Record<string, unknown>)
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

    await filestoreClient.moveNode({
      backendMountId: parameters.filestoreBackendId,
      path: node.path,
      targetPath: archiveTargetPath,
      overwrite: true,
      principal: parameters.principal
    });

    archiveOperations.push({
      sourcePath: node.path,
      archiveDestination: archiveTargetPath,
      localDestination: archivePlacement.destination
    });

    const stagingAbsolutePath = path.resolve(parameters.stagingDir, stagingRelativePath);
    const content = await readFile(stagingAbsolutePath, 'utf8');
    const { rows, site } = parseCsv(content);

    const rowCount = rows || (typeof metadata.rows === 'number' ? metadata.rows : 0);
    recordCount += rowCount;

    if (inferredInstrumentId) {
      instrumentIds.add(inferredInstrumentId);
    }

    sourceFiles.push({
      relativePath: stagingRelativePosix,
      site: site || ensureString(metadata.site ?? metadata.location ?? ''),
      instrumentId: inferredInstrumentId,
      rows: rowCount
    });
  }

  const normalizedAt = new Date().toISOString();
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

  await context.update({
    filesProcessed: sourceFiles.length,
    recordCount,
    filesArchived: archiveOperations.length
  });

  context.logger('Normalized observatory inbox files', {
    minute: parameters.minute,
    filesProcessed: sourceFiles.length,
    recordCount,
    stagingPrefix: stagingMinutePrefix,
    archivePrefix: parameters.archivePrefix
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

export default handler;
