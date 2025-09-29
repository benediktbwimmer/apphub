import { FilestoreClient, FilestoreClientError } from '@apphub/filestore-client';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();

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
  minute: string;
  rowsPerInstrument: number;
  intervalMinutes: number;
  instrumentCount: number;
  seed: number;
  instrumentProfiles: InstrumentProfile[];
  filestoreBaseUrl: string;
  filestoreBackendId: number;
  filestoreToken?: string;
  inboxPrefix: string;
  stagingPrefix: string;
  archivePrefix: string;
  principal?: string;
  metastoreBaseUrl?: string;
  metastoreNamespace?: string;
  metastoreAuthToken?: string;
};

type GeneratedFileSummary = {
  instrumentId: string;
  site: string;
  relativePath: string;
  filestorePath: string;
  rows: number;
  firstTimestamp: string;
  lastTimestamp: string;
};

type GeneratorAssetPayload = {
  generatedAt: string;
  partitionKey: string;
  seed: number;
  files: GeneratedFileSummary[];
  rowsGenerated: number;
  instrumentCount: number;
  filestoreInboxPrefix: string;
  filestoreBackendId: number;
  minuteKey: string;
};

type MetastoreConfig = {
  baseUrl: string;
  namespace: string;
  authToken?: string;
};

const INGEST_RECORD_TYPE = 'observatory.ingest.file';

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

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function sanitizeRecordKey(value: string): string {
  return value ? value.replace(/[^0-9A-Za-z._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') : '';
}

function toMetastoreConfig(parameters: ObservatoryGeneratorParameters): MetastoreConfig | null {
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

function sliceIsoMinute(value: string): string | null {
  const match = value.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return match?.[1] ?? null;
}

function fallbackMinute(): string {
  const now = new Date();
  now.setUTCSeconds(0, 0);
  return sliceIsoMinute(now.toISOString()) ?? now.toISOString().slice(0, 16);
}

function parseMinute(minute: string): { isoMinute: string; stamp: string; startDate: Date } {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(minute)) {
    throw new Error(`minute must be formatted as YYYY-MM-DDTHH:mm, received '${minute}'`);
  }
  const isoMinute = `${minute}:00Z`;
  const startDate = new Date(isoMinute);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error(`minute '${minute}' could not be parsed as a valid UTC timestamp`);
  }
  const stamp = minute.replace(/[-:T]/g, '');
  return { isoMinute, stamp, startDate };
}

function computeSeed(minute: string, providedSeed: number | null | undefined): number {
  if (typeof providedSeed === 'number' && Number.isFinite(providedSeed) && providedSeed !== 0) {
    return Math.trunc(providedSeed) >>> 0 || 1;
  }
  let hash = 2166136261;
  for (let index = 0; index < minute.length; index += 1) {
    hash ^= minute.charCodeAt(index);
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

  const scheduledFor = ensureString(
    raw.scheduledFor ?? raw.scheduled_for ?? raw.scheduledAt ?? raw.scheduled_at
  );
  let minute = ensureString(raw.minute ?? raw.partitionKey ?? raw.partition_key ?? raw.hour);
  if (!minute && scheduledFor) {
    const sliced = sliceIsoMinute(scheduledFor);
    if (sliced) {
      minute = sliced;
    }
  }
  if (!minute) {
    minute = fallbackMinute();
  }

  const rowsPerInstrument = clamp(
    Math.trunc(ensureNumber(raw.rowsPerInstrument ?? raw.rows_per_instrument, 6)),
    1,
    360
  );
  const intervalMinutes = clamp(
    Math.trunc(ensureNumber(raw.intervalMinutes ?? raw.interval_minutes, 10)),
    1,
    120
  );
  const instrumentProfiles = parseInstrumentProfiles(raw.instrumentProfiles ?? raw.instrument_profiles);
  const instrumentCount = clamp(
    Math.trunc(ensureNumber(raw.instrumentCount ?? raw.instrument_count, instrumentProfiles.length)),
    1,
    instrumentProfiles.length
  );
  const limitedProfiles = instrumentProfiles.slice(0, instrumentCount);
  const seed = computeSeed(minute, raw.seed as number | null | undefined);

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
    'observatory-data-generator'
  );

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
    minute,
    rowsPerInstrument,
    intervalMinutes,
    seed,
    instrumentCount,
    instrumentProfiles: limitedProfiles,
    filestoreBaseUrl,
    filestoreBackendId,
    filestoreToken: filestoreToken || undefined,
    inboxPrefix,
    stagingPrefix,
    archivePrefix,
    principal: principal || undefined,
    metastoreBaseUrl: metastoreBaseUrl ? normalizeBaseUrl(metastoreBaseUrl) : undefined,
    metastoreNamespace: (metastoreNamespace || 'observatory.ingest').trim() || 'observatory.ingest',
    metastoreAuthToken: metastoreAuthToken || undefined
  } satisfies ObservatoryGeneratorParameters;
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
  const { stamp, startDate } = parseMinute(parameters.minute);
  const metastoreConfig = toMetastoreConfig(parameters);

  const filestoreClient = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken,
    userAgent: 'observatory-data-generator/0.2.0'
  });

  await ensureFilestoreHierarchy(
    filestoreClient,
    parameters.filestoreBackendId,
    parameters.inboxPrefix,
    parameters.principal
  );
  await ensureFilestoreHierarchy(
    filestoreClient,
    parameters.filestoreBackendId,
    parameters.stagingPrefix,
    parameters.principal
  );
  await ensureFilestoreHierarchy(
    filestoreClient,
    parameters.filestoreBackendId,
    parameters.archivePrefix,
    parameters.principal
  );

  const summaries: GeneratedFileSummary[] = [];
  let totalRows = 0;
  let seedOffset = parameters.seed;

  const normalizedInboxPrefix = parameters.inboxPrefix.replace(/\/+$/g, '');
  const sanitizedMinuteKey = parameters.minute.replace(/:/g, '-');

  for (const profile of parameters.instrumentProfiles) {
    seedOffset += 1;
    const rng = createRng(seedOffset);
    const fileName = `${profile.instrumentId}_${stamp}.csv`;
    const firstSampleDate = new Date(
      startDate.getTime() - (parameters.rowsPerInstrument - 1) * parameters.intervalMinutes * 60_000
    );
    const { content, metrics } = buildCsvContent(
      profile,
      firstSampleDate,
      parameters.rowsPerInstrument,
      parameters.intervalMinutes,
      rng
    );
    const filestorePath = `${normalizedInboxPrefix}/${fileName}`;
    const uploadResult = await filestoreClient.uploadFile({
      backendMountId: parameters.filestoreBackendId,
      path: filestorePath,
      content,
      overwrite: true,
      contentType: 'text/csv',
      principal: parameters.principal,
      metadata: {
        minute: parameters.minute,
        minuteKey: sanitizedMinuteKey,
        instrumentId: profile.instrumentId,
        site: profile.site,
        rows: metrics.rows,
        firstTimestamp: metrics.firstTimestamp,
        lastTimestamp: metrics.lastTimestamp
      }
    });
    const nodeId = uploadResult.node?.id ?? null;
    const createdAt = new Date().toISOString();
    if (metastoreConfig) {
      const metadata: Record<string, unknown> = {
        type: INGEST_RECORD_TYPE,
        status: 'pending',
        minute: parameters.minute,
        minuteKey: sanitizedMinuteKey,
        instrumentId: profile.instrumentId,
        site: profile.site,
        rows: metrics.rows,
        filestorePath,
        nodeId,
        createdAt
      };
      await upsertMetastoreRecord(metastoreConfig, filestorePath, metadata);
    }
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

  const processedInstrumentCount = summaries.length;
  const generatedAt = new Date().toISOString();

  await context.update({
    filesCreated: summaries.length,
    rowsGenerated: totalRows,
    filestoreInboxPrefix: parameters.inboxPrefix,
    minuteKey: sanitizedMinuteKey
  });

  const payload: GeneratorAssetPayload = {
    generatedAt,
    partitionKey: parameters.minute,
    seed: parameters.seed,
    files: summaries,
    rowsGenerated: totalRows,
    instrumentCount: processedInstrumentCount,
    filestoreInboxPrefix: parameters.inboxPrefix,
    minuteKey: sanitizedMinuteKey,
    filestoreBackendId: parameters.filestoreBackendId
  } satisfies GeneratorAssetPayload;

  context.logger('Generated observatory inbox CSV files', {
    minute: parameters.minute,
    filesCreated: summaries.length,
    rowsGenerated: totalRows,
    filestoreInboxPrefix: parameters.inboxPrefix,
    instrumentCount: processedInstrumentCount
  });

  return {
    status: 'succeeded',
    result: {
      partitionKey: parameters.minute,
      generated: payload,
      assets: [
        {
          assetId: 'observatory.inbox.synthetic',
          partitionKey: parameters.minute,
          producedAt: generatedAt,
          payload
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
