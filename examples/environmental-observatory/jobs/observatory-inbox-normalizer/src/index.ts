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
  hour: string;
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
  hour: string;
  instrumentCount: number;
  recordCount: number;
  sourceFiles: SourceFileMetadata[];
  stagingDir: string;
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
  const hour = ensureString(raw.hour ?? raw.partitionKey ?? raw.partition_key);
  if (!hour) {
    throw new Error('hour parameter is required');
  }
  const maxFiles = Math.max(1, ensureNumber(raw.maxFiles ?? raw.max_files, 64));
  return { inboxDir, stagingDir, hour, maxFiles } satisfies ObservatoryNormalizerParameters;
}

function parseInstrumentId(filename: string): string {
  const match = filename.match(/instrument_(.+?)_\d{10}\.csv$/i);
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
  const hourSuffix = `${parameters.hour}.csv`;

  let entries: string[] = [];
  try {
    entries = (await readdir(parameters.inboxDir)).filter((file) => file.endsWith(hourSuffix));
  } catch (error) {
    throw new Error(
      `Failed to read inbox directory at ${parameters.inboxDir}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (entries.length === 0) {
    throw new Error(`No CSV files matching *${hourSuffix} found in ${parameters.inboxDir}`);
  }

  const selectedEntries = entries.slice(0, parameters.maxFiles);
  const stagingHourDir = path.resolve(parameters.stagingDir, parameters.hour);
  await mkdir(stagingHourDir, { recursive: true });

  const sourceFiles: SourceFileMetadata[] = [];
  let recordCount = 0;
  const instrumentIds = new Set<string>();

  for (const filename of selectedEntries) {
    const inboxPath = path.resolve(parameters.inboxDir, filename);
    const stagingPath = path.resolve(stagingHourDir, filename);
    await copyFile(inboxPath, stagingPath);

    const content = await readFile(stagingPath, 'utf8');
    const { rows, site } = parseCsv(content);
    const instrumentId = parseInstrumentId(filename);

    recordCount += rows;
    if (instrumentId) {
      instrumentIds.add(instrumentId);
    }

    sourceFiles.push({
      relativePath: path.join(parameters.hour, filename),
      site,
      instrumentId,
      rows
    });
  }

  const normalizedAt = new Date().toISOString();
  const payload: RawAssetPayload = {
    partitionKey: parameters.hour,
    hour: parameters.hour,
    instrumentCount: instrumentIds.size,
    recordCount,
    sourceFiles,
    stagingDir: stagingHourDir,
    normalizedAt
  } satisfies RawAssetPayload;

  await context.update({
    filesProcessed: sourceFiles.length,
    recordCount
  });

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.hour,
      normalized: payload,
      assets: [
        {
          assetId: 'observatory.timeseries.raw',
          partitionKey: parameters.hour,
          producedAt: normalizedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
