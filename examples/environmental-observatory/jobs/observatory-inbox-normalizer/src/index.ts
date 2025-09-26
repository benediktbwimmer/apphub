import { mkdir, readdir, readFile, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';

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
  inboxDir: string;
  stagingDir: string;
  archiveDir: string;
  minute: string;
  maxFiles: number;
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
  const inboxDir = ensureString(raw.inboxDir ?? raw.inbox_dir);
  if (!inboxDir) {
    throw new Error('inboxDir parameter is required');
  }
  const stagingDir = ensureString(raw.stagingDir ?? raw.staging_dir);
  if (!stagingDir) {
    throw new Error('stagingDir parameter is required');
  }
  const archiveDir = ensureString(raw.archiveDir ?? raw.archive_dir);
  if (!archiveDir) {
    throw new Error('archiveDir parameter is required');
  }
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute) {
    throw new Error('minute parameter is required');
  }
  const maxFiles = Math.max(1, ensureNumber(raw.maxFiles ?? raw.max_files, 64));
  return { inboxDir, stagingDir, archiveDir, minute, maxFiles } satisfies ObservatoryNormalizerParameters;
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

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return Boolean(value && typeof value === 'object' && 'code' in (value as Record<string, unknown>));
}

async function moveFileToArchive(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (error) {
    if (isErrnoException(error) && error.code === 'EEXIST') {
      const uniqueDestination = destination.replace(
        /(\.csv)?$/i,
        (extension) => `-${Date.now()}${extension || ''}`
      );
      await rename(source, uniqueDestination);
      return;
    }
    throw error instanceof Error ? error : new Error(String(error));
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
  const minuteSuffixes = deriveMinuteSuffixes(parameters.minute);

  let entries: string[] = [];
  try {
    const candidates = await readdir(parameters.inboxDir);
    entries = candidates.filter((file) => minuteSuffixes.some((suffix) => file.endsWith(suffix)));
  } catch (error) {
    throw new Error(
      `Failed to read inbox directory at ${parameters.inboxDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (entries.length === 0) {
    throw new Error(
      `No CSV files matching minute ${parameters.minute} (suffixes: ${minuteSuffixes.join(', ')}) found in ${parameters.inboxDir}`
    );
  }

  const selectedEntries = entries.slice(0, parameters.maxFiles);
  const minuteKey = parameters.minute;
  const stagingSubdir = minuteKey.replace(':', '-');
  const stagingMinuteDir = path.resolve(parameters.stagingDir, stagingSubdir);
  await mkdir(stagingMinuteDir, { recursive: true });

  const sourceFiles: SourceFileMetadata[] = [];
  let recordCount = 0;
  const instrumentIds = new Set<string>();
  const archiveMoves: Array<ArchivePlacement & { source: string }> = [];

  for (const filename of selectedEntries) {
    const inboxPath = path.resolve(parameters.inboxDir, filename);
    const stagingPath = path.resolve(stagingMinuteDir, filename);
    await copyFile(inboxPath, stagingPath);

    const content = await readFile(stagingPath, 'utf8');
    const { rows, site } = parseCsv(content);
    const instrumentId = parseInstrumentId(filename);

    recordCount += rows;
    if (instrumentId) {
      instrumentIds.add(instrumentId);
    }

    const archivePlacement = deriveArchivePlacement(
      parameters.archiveDir,
      instrumentId,
      minuteKey,
      filename
    );
    archiveMoves.push({ ...archivePlacement, source: inboxPath });

    sourceFiles.push({
      relativePath: path.join(stagingSubdir, filename),
      site,
      instrumentId,
      rows
    });
  }

  for (const move of archiveMoves) {
    await mkdir(move.directory, { recursive: true });
    await moveFileToArchive(move.source, move.destination);
  }

  const normalizedAt = new Date().toISOString();
  const payload: RawAssetPayload = {
    partitionKey: minuteKey,
    minute: minuteKey,
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
    filesArchived: archiveMoves.length
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
