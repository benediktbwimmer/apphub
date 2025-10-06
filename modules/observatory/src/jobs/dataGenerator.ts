import {
  createJobHandler,
  enforceScratchOnlyWrites,
  inheritModuleSettings,
  inheritModuleSecrets,
  sanitizeIdentifier,
  selectFilestore,
  selectMetastore,
  toTemporalKey,
  type FilestoreCapability,
  type JobContext
} from '@apphub/module-sdk';
import { ensureFilestoreHierarchy, ensureResolvedBackendId, uploadTextFile } from '@apphub/module-sdk';
import { DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../runtime';
import {
  type GeneratorInstrumentProfile,
  type ObservatorySecrets,
  type ObservatorySettings
} from '../config/settings';

enforceScratchOnlyWrites();

const INGEST_RECORD_TYPE = 'observatory.ingest.file';

export interface GeneratorJobResult {
  partitions: Array<{
    instrumentId: string;
    relativePath: string;
    rows: number;
  }>;
  generatedAt: string;
  seed: number;
}

const DEFAULT_PROFILES: GeneratorInstrumentProfile[] = [
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

type GeneratorContext = JobContext<ObservatorySettings, ObservatorySecrets, void>;

function resolveMinute(settings: ObservatorySettings): string {
  const explicit = settings.generator.minute?.trim();
  if (explicit) {
    return explicit;
  }
  const now = new Date();
  now.setUTCSeconds(0, 0);
  return now.toISOString().slice(0, 16);
}

function createProfiles(settings: ObservatorySettings): GeneratorInstrumentProfile[] {
  if (settings.generator.instrumentProfiles?.length) {
    return settings.generator.instrumentProfiles;
  }
  const count = Math.max(1, settings.generator.instrumentCount);
  return DEFAULT_PROFILES.slice(0, count);
}

function createSeed(baseSeed: number, index: number): number {
  return baseSeed + index + 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function buildCsv(
  profile: GeneratorInstrumentProfile,
  minute: string,
  rows: number,
  intervalMinutes: number,
  rng: () => number
): {
  content: string;
  metrics: {
    firstTimestamp: string;
    lastTimestamp: string;
    rows: number;
  };
} {
  const header = [
    'timestamp',
    'instrument_id',
    'site',
    'temperature_c',
    'relative_humidity_pct',
    'pm2_5_ug_m3',
    'battery_voltage'
  ].join(',');
  const lines: string[] = [header];
  const minuteDate = new Date(`${minute}:00Z`);
  const intervalMs = Math.max(1, intervalMinutes) * 60_000;
  const firstTimestamp = new Date(minuteDate.getTime() - intervalMs * (rows - 1));
  for (let index = 0; index < rows; index += 1) {
    const timestamp = new Date(firstTimestamp.getTime() + index * intervalMs).toISOString();
    const temp = profile.baselineTemperatureC + rng() * 1.5 - 0.5;
    const humidity = clamp(profile.baselineHumidityPct + rng() * 2 - 1, 30, 100);
    const pm25 = clamp(profile.baselinePm25UgM3 + rng() * 4 - 1.5, 0, 150);
    const battery = clamp(profile.baselineBatteryVoltage - rng() * 0.05, 3.6, 4.1);
    lines.push(
      [
        timestamp,
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
      firstTimestamp: firstTimestamp.toISOString(),
      lastTimestamp: new Date(firstTimestamp.getTime() + intervalMs * (rows - 1)).toISOString(),
      rows
    }
  };
}

async function upsertIngestionRecord(
  context: GeneratorContext,
  recordKey: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const metastore = selectMetastore(context.capabilities, 'reports');
  if (!metastore) {
    return;
  }
  const key = sanitizeIdentifier(recordKey);
  if (!key) {
    return;
  }
  await metastore.upsertRecord({
    key,
    metadata: {
      ...metadata,
      type: INGEST_RECORD_TYPE,
      status: 'pending'
    },
    principal: undefined
  });
}

async function handler(context: GeneratorContext): Promise<GeneratorJobResult> {
  const moduleSettings = context.settings;
  const minute = resolveMinute(moduleSettings);
  const minuteKey = toTemporalKey(minute);
  const profiles = createProfiles(moduleSettings);
  const rowsPerInstrument = Math.max(1, moduleSettings.generator.rowsPerInstrument);
  const intervalMinutes = Math.max(1, moduleSettings.generator.intervalMinutes);
  const filestoreCapability = selectFilestore(context.capabilities);
  if (!filestoreCapability) {
    throw new Error('Filestore capability is required for the data generator job');
  }
  const filestore: FilestoreCapability = filestoreCapability;
  const principal = moduleSettings.principals.dataGenerator;

  const backendMountId = await ensureResolvedBackendId(filestore, {
    filestoreBackendId: moduleSettings.filestore.backendId,
    filestoreBackendKey: moduleSettings.filestore.backendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
  });

  await ensureFilestoreHierarchy(
    filestore,
    backendMountId,
    moduleSettings.filestore.inboxPrefix,
    principal
  );

  const seed = moduleSettings.generator.seed;
  const rng = createRandom(seed);
  const summaries: Array<{ instrumentId: string; site: string; relativePath: string; rows: number } & {
    filestorePath: string;
    firstTimestamp: string;
    lastTimestamp: string;
  }> = [];
  let totalRows = 0;

  const normalizedInbox = moduleSettings.filestore.inboxPrefix.replace(/\/+$/g, '');
  const generatedAt = new Date().toISOString();

  for (let index = 0; index < profiles.length; index += 1) {
    const profile = profiles[index];
    const profileSeed = createSeed(seed, index);
    const profileRng = createRandom(profileSeed);
    const { content, metrics } = buildCsv(profile, minute, rowsPerInstrument, intervalMinutes, profileRng);
    const fileName = `${profile.instrumentId}_${minuteKey}.csv`;
    const filestorePath = `${normalizedInbox}/${fileName}`;

    const result = await uploadTextFile({
      filestore,
      backendMountId,
      backendMountKey: moduleSettings.filestore.backendKey ?? undefined,
      defaultBackendKey: DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
      path: filestorePath,
      content,
      contentType: 'text/csv',
      principal,
      metadata: {
        minute,
        minuteKey,
        instrumentId: profile.instrumentId,
        site: profile.site,
        rows: metrics.rows,
        firstTimestamp: metrics.firstTimestamp,
        lastTimestamp: metrics.lastTimestamp
      }
    });

    const node = result.node;
    await upsertIngestionRecord(context, filestorePath, {
      minute,
      minuteKey,
      instrumentId: profile.instrumentId,
      site: profile.site,
      rows: metrics.rows,
      filestorePath,
      nodeId: node?.id ?? result.nodeId ?? null,
      createdAt: generatedAt
    });

    totalRows += metrics.rows;
    summaries.push({
      instrumentId: profile.instrumentId,
      site: profile.site,
      relativePath: fileName,
      filestorePath,
      rows: metrics.rows,
      firstTimestamp: metrics.firstTimestamp,
      lastTimestamp: metrics.lastTimestamp
    });
  }

  return {
    partitions: summaries.map((summary) => ({
      instrumentId: summary.instrumentId,
      relativePath: summary.relativePath,
      rows: summary.rows
    })),
    generatedAt,
    seed
  } satisfies GeneratorJobResult;
}

export const dataGeneratorJob = createJobHandler<
  ObservatorySettings,
  ObservatorySecrets,
  GeneratorJobResult,
  void,
  ['filestore', 'metastore.reports']
>({
  name: 'observatory-data-generator',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'metastore.reports'] as const,
  handler
});
