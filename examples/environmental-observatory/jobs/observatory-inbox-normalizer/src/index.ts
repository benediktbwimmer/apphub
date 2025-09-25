import { mkdir, readdir, readFile, copyFile } from 'node:fs/promises';
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
  const minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute) {
    throw new Error('minute parameter is required');
  }
  const maxFiles = Math.max(1, ensureNumber(raw.maxFiles ?? raw.max_files, 64));
  return { inboxDir, stagingDir, minute, maxFiles } satisfies ObservatoryNormalizerParameters;
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

    sourceFiles.push({
      relativePath: path.join(stagingSubdir, filename),
      site,
      instrumentId,
      rows
    });
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
    recordCount
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
