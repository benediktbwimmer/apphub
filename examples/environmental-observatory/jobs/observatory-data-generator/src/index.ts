import { mkdir, writeFile } from 'node:fs/promises';
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

type InstrumentProfile = {
  instrumentId: string;
  site: string;
  baselineTemperatureC: number;
  baselineHumidityPct: number;
  baselinePm25UgM3: number;
  baselineBatteryVoltage: number;
};

type ObservatoryGeneratorParameters = {
  inboxDir: string;
  hour: string;
  rowsPerInstrument: number;
  intervalMinutes: number;
  seed: number;
  instrumentProfiles: InstrumentProfile[];
};

type GeneratedFileSummary = {
  instrumentId: string;
  site: string;
  relativePath: string;
  absolutePath: string;
  rows: number;
  firstTimestamp: string;
  lastTimestamp: string;
};

type GeneratorAssetPayload = {
  generatedAt: string;
  partitionKey: string;
  inboxDir: string;
  seed: number;
  files: GeneratedFileSummary[];
  rowsGenerated: number;
  instrumentCount: number;
};

const DEFAULT_PROFILES: InstrumentProfile[] = [
  {
    instrumentId: 'instrument_alpha',
    site: 'west-basin',
    baselineTemperatureC: 24.2,
    baselineHumidityPct: 57.5,
    baselinePm25UgM3: 12.3,
    baselineBatteryVoltage: 3.94
  },
  {
    instrumentId: 'instrument_bravo',
    site: 'east-ridge',
    baselineTemperatureC: 22.6,
    baselineHumidityPct: 60.4,
    baselinePm25UgM3: 14.1,
    baselineBatteryVoltage: 3.92
  },
  {
    instrumentId: 'instrument_charlie',
    site: 'north-forest',
    baselineTemperatureC: 21.8,
    baselineHumidityPct: 62.1,
    baselinePm25UgM3: 10.2,
    baselineBatteryVoltage: 3.9
  }
];

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sliceIsoHour(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2})/);
  return match?.[1] ?? null;
}

function parseHour(hour: string): { isoHour: string; stamp: string; startDate: Date } {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hour)) {
    throw new Error(`hour must be formatted as YYYY-MM-DDTHH, received '${hour}'`);
  }
  const isoHour = `${hour}:00:00Z`;
  const startDate = new Date(isoHour);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`hour '${hour}' could not be parsed as a valid UTC timestamp`);
  }
  const stamp = hour.replace(/[-:T]/g, '');
  return { isoHour, stamp, startDate };
}

function computeSeed(hour: string, providedSeed: number | null | undefined): number {
  if (typeof providedSeed === 'number' && Number.isFinite(providedSeed) && providedSeed !== 0) {
    return Math.trunc(providedSeed) >>> 0 || 1;
  }
  let hash = 2166136261;
  for (let index = 0; index < hour.length; index += 1) {
    hash ^= hour.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
    hash >>>= 0;
  }
  return (hash || 1) >>> 0;
}

function createRng(seed: number): () => number {
  let state = Math.trunc(seed) % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function normalizeProfile(entry: Record<string, unknown>, index: number): InstrumentProfile {
  const instrumentId = ensureString(entry.instrumentId ?? entry.instrument_id);
  if (!instrumentId) {
    throw new Error(`instrumentProfiles[${index}].instrumentId is required`);
  }
  const site = ensureString(entry.site ?? entry.location ?? '');
  if (!site) {
    throw new Error(`instrumentProfiles[${index}].site is required`);
  }
  const fallback = DEFAULT_PROFILES.find((profile) => profile.instrumentId === instrumentId);
  const template = fallback ?? DEFAULT_PROFILES[index % DEFAULT_PROFILES.length];
  return {
    instrumentId,
    site,
    baselineTemperatureC: ensureNumber(
      entry.baselineTemperatureC ?? entry.baseline_temperature_c,
      template.baselineTemperatureC
    ),
    baselineHumidityPct: ensureNumber(
      entry.baselineHumidityPct ?? entry.baseline_humidity_pct,
      template.baselineHumidityPct
    ),
    baselinePm25UgM3: ensureNumber(
      entry.baselinePm25UgM3 ?? entry.baseline_pm25_ug_m3,
      template.baselinePm25UgM3
    ),
    baselineBatteryVoltage: ensureNumber(
      entry.baselineBatteryVoltage ?? entry.baseline_battery_voltage,
      template.baselineBatteryVoltage
    )
  } satisfies InstrumentProfile;
}

function parseInstrumentProfiles(raw: unknown): InstrumentProfile[] {
  if (raw === undefined || raw === null) {
    return DEFAULT_PROFILES.map((profile) => ({ ...profile }));
  }
  if (!Array.isArray(raw)) {
    throw new Error('instrumentProfiles must be an array when provided');
  }
  if (raw.length === 0) {
    throw new Error('instrumentProfiles must contain at least one profile');
  }
  return raw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`instrumentProfiles[${index}] must be an object`);
    }
    return normalizeProfile(entry, index);
  });
}

function parseParameters(raw: unknown): ObservatoryGeneratorParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }
  const inboxDir = ensureString(raw.inboxDir ?? raw.inbox_dir);
  if (!inboxDir) {
    throw new Error('inboxDir parameter is required');
  }
  const scheduledFor = ensureString(
    raw.scheduledFor ?? raw.scheduled_for ?? raw.scheduledAt ?? raw.scheduled_at
  );
  let hour = ensureString(raw.hour ?? raw.partitionKey ?? raw.partition_key);
  if (!hour && scheduledFor) {
    const sliced = sliceIsoHour(scheduledFor);
    if (sliced) {
      hour = sliced;
    }
  }
  if (!hour) {
    throw new Error('hour parameter is required');
  }
  const rowsPerInstrument = clamp(Math.trunc(ensureNumber(raw.rowsPerInstrument ?? raw.rows_per_instrument, 6)), 1, 360);
  const intervalMinutes = clamp(Math.trunc(ensureNumber(raw.intervalMinutes ?? raw.interval_minutes, 10)), 1, 120);
  const instrumentProfiles = parseInstrumentProfiles(raw.instrumentProfiles ?? raw.instrument_profiles);
  const seed = computeSeed(hour, raw.seed as number | null | undefined);
  return {
    inboxDir,
    hour,
    rowsPerInstrument,
    intervalMinutes,
    seed,
    instrumentProfiles
  } satisfies ObservatoryGeneratorParameters;
}

type CsvMetrics = {
  rows: number;
  firstTimestamp: string;
  lastTimestamp: string;
};

function buildCsvContent(
  profile: InstrumentProfile,
  startDate: Date,
  rows: number,
  intervalMinutes: number,
  rng: () => number
): { content: string; metrics: CsvMetrics } {
  const lines = [
    'timestamp,instrument_id,site,temperature_c,relative_humidity_pct,pm2_5_ug_m3,battery_voltage'
  ];
  let firstTimestamp = '';
  let lastTimestamp = '';
  for (let index = 0; index < rows; index += 1) {
    const timestamp = new Date(startDate.getTime() + index * intervalMinutes * 60_000);
    const iso = timestamp.toISOString().replace('.000Z', 'Z');
    if (!firstTimestamp) {
      firstTimestamp = iso;
    }
    lastTimestamp = iso;

    const temp = profile.baselineTemperatureC + (rng() - 0.5) * 1.8;
    const humidity = clamp(profile.baselineHumidityPct + (rng() - 0.5) * 6, 0, 100);
    const pm25 = Math.max(0, profile.baselinePm25UgM3 + (rng() - 0.5) * 4.5);
    const battery = clamp(profile.baselineBatteryVoltage - rng() * 0.02, 3.6, 4.1);

    lines.push(
      [
        iso,
        profile.instrumentId,
        profile.site,
        temp.toFixed(2),
        humidity.toFixed(1),
        pm25.toFixed(1),
        battery.toFixed(2)
      ].join(',')
    );
  }

  return {
    content: `${lines.join('\n')}\n`,
    metrics: {
      rows,
      firstTimestamp,
      lastTimestamp
    }
  } satisfies { content: string; metrics: CsvMetrics };
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const parameters = parseParameters(context.parameters);
  const { stamp, startDate } = parseHour(parameters.hour);
  await mkdir(parameters.inboxDir, { recursive: true });

  const summaries: GeneratedFileSummary[] = [];
  let totalRows = 0;
  let seedOffset = parameters.seed;

  for (const profile of parameters.instrumentProfiles) {
    seedOffset += 1;
    const rng = createRng(seedOffset);
    const fileName = `${profile.instrumentId}_${stamp}.csv`;
    const absolutePath = path.resolve(parameters.inboxDir, fileName);
    const { content, metrics } = buildCsvContent(
      profile,
      startDate,
      parameters.rowsPerInstrument,
      parameters.intervalMinutes,
      rng
    );
    await writeFile(absolutePath, content, 'utf8');
    totalRows += metrics.rows;
    summaries.push({
      instrumentId: profile.instrumentId,
      site: profile.site,
      relativePath: fileName,
      absolutePath,
      rows: metrics.rows,
      firstTimestamp: metrics.firstTimestamp,
      lastTimestamp: metrics.lastTimestamp
    });
  }

  const generatedAt = new Date().toISOString();

  await context.update({
    filesCreated: summaries.length,
    rowsGenerated: totalRows
  });

  const payload: GeneratorAssetPayload = {
    generatedAt,
    partitionKey: parameters.hour,
    inboxDir: parameters.inboxDir,
    seed: parameters.seed,
    files: summaries,
    rowsGenerated: totalRows,
    instrumentCount: summaries.length
  } satisfies GeneratorAssetPayload;

  context.logger('Generated observatory inbox CSV files', {
    hour: parameters.hour,
    filesCreated: summaries.length,
    rowsGenerated: totalRows
  });

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.hour,
      generated: payload,
      assets: [
        {
          assetId: 'observatory.inbox.synthetic',
          partitionKey: parameters.hour,
          producedAt: generatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
