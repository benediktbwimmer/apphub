import { z } from 'zod';
import { createSettingsLoader } from '@apphub/module-toolkit';
import { loadObservatoryConfig } from '../runtime/config';

const instrumentProfileSchema = z.object({
  instrumentId: z.string(),
  site: z.string(),
  baselineTemperatureC: z.number(),
  baselineHumidityPct: z.number(),
  baselinePm25UgM3: z.number(),
  baselineBatteryVoltage: z.number()
});

export type GeneratorInstrumentProfile = z.infer<typeof instrumentProfileSchema>;

const calibrationDownstreamWorkflowSchema = z.object({
  workflowSlug: z.string(),
  runKeyTemplate: z.string().optional()
});

export const ObservatorySettingsSchema = z.object({
  filestore: z.object({
    baseUrl: z.string().url(),
    backendKey: z.string(),
    backendId: z.number().nullable(),
    inboxPrefix: z.string(),
    stagingPrefix: z.string(),
    archivePrefix: z.string(),
    visualizationsPrefix: z.string(),
    reportsPrefix: z.string(),
    overviewPrefix: z.string(),
    calibrationsPrefix: z.string(),
    plansPrefix: z.string()
  }),
  timestore: z.object({
    baseUrl: z.string().url(),
    datasetSlug: z.string(),
    datasetName: z.string(),
    tableName: z.string(),
    storageTargetId: z.string().nullable(),
    partitionNamespace: z.string(),
    lookbackMinutes: z.number().int()
  }),
  metastore: z.object({
    baseUrl: z.string().url(),
    namespace: z.string()
  }),
  calibrations: z.object({
    baseUrl: z.string().url().nullable(),
    namespace: z.string()
  }),
  events: z.object({
    source: z.string()
  }),
  dashboard: z.object({
    lookbackMinutes: z.number().int(),
    burstQuietMs: z.number().int(),
    snapshotFreshnessMs: z.number().int().nullable()
  }),
  core: z.object({
    baseUrl: z.string().url()
  }),
  reprocess: z.object({
    ingestWorkflowSlug: z.string(),
    ingestAssetId: z.string(),
    downstreamWorkflows: z.array(calibrationDownstreamWorkflowSchema),
    metastoreNamespace: z.string(),
    pollIntervalMs: z.number().int()
  }),
  ingest: z.object({
    maxFiles: z.number().int(),
    metastoreNamespace: z.string()
  }),
  principals: z.object({
    dataGenerator: z.string(),
    minutePreprocessor: z.string(),
    timestoreLoader: z.string(),
    visualizationRunner: z.string(),
    dashboardAggregator: z.string(),
    calibrationImporter: z.string(),
    calibrationPlanner: z.string(),
    calibrationReprocessor: z.string()
  }),
  generator: z.object({
    minute: z.string().nullable().optional(),
    rowsPerInstrument: z.number().int(),
    intervalMinutes: z.number().int(),
    instrumentCount: z.number().int(),
    seed: z.number().int(),
    instrumentProfiles: z.array(instrumentProfileSchema)
  })
});

export const ObservatorySecretsSchema = z.object({
  filestoreToken: z.string().optional(),
  timestoreToken: z.string().optional(),
  metastoreToken: z.string().optional(),
  calibrationsToken: z.string().optional(),
  eventsToken: z.string().optional(),
  coreApiToken: z.string().optional()
});

export type ObservatorySettings = z.infer<typeof ObservatorySettingsSchema>;
export type ObservatorySecrets = z.infer<typeof ObservatorySecretsSchema>;

const FALLBACK_SETTINGS: ObservatorySettings = {
  filestore: {
    baseUrl: 'http://127.0.0.1:4300',
    backendKey: 'observatory-event-driven-s3',
    backendId: 1,
    inboxPrefix: 'datasets/observatory/raw',
    stagingPrefix: 'datasets/observatory/raw',
    archivePrefix: 'datasets/observatory/raw',
    visualizationsPrefix: 'datasets/observatory/visualizations',
    reportsPrefix: 'datasets/observatory/reports',
    overviewPrefix: 'datasets/observatory/reports/overview',
    calibrationsPrefix: 'datasets/observatory/calibrations',
    plansPrefix: 'datasets/observatory/calibrations/plans'
  },
  timestore: {
    baseUrl: 'http://127.0.0.1:4200',
    datasetSlug: 'observatory-timeseries',
    datasetName: 'Observatory Time Series',
    tableName: 'observations',
    storageTargetId: null,
    partitionNamespace: 'observatory',
    lookbackMinutes: 720
  },
  metastore: {
    baseUrl: 'http://127.0.0.1:4100',
    namespace: 'observatory.reports'
  },
  calibrations: {
    baseUrl: 'http://127.0.0.1:4100',
    namespace: 'observatory.calibrations'
  },
  events: {
    source: 'observatory.events'
  },
  dashboard: {
    lookbackMinutes: 720,
    burstQuietMs: 5_000,
    snapshotFreshnessMs: 60_000
  },
  core: {
    baseUrl: 'http://127.0.0.1:4000'
  },
  reprocess: {
    ingestWorkflowSlug: 'observatory-minute-ingest',
    ingestAssetId: 'observatory.timeseries.timestore',
    downstreamWorkflows: [],
    metastoreNamespace: 'observatory.reprocess.plans',
    pollIntervalMs: 1_500
  },
  ingest: {
    maxFiles: 16,
    metastoreNamespace: 'observatory.ingest'
  },
  principals: {
    dataGenerator: 'observatory-data-generator',
    minutePreprocessor: 'observatory-minute-preprocessor',
    timestoreLoader: 'observatory-timestore-loader',
    visualizationRunner: 'observatory-visualization-runner',
    dashboardAggregator: 'observatory-dashboard-aggregator',
    calibrationImporter: 'observatory-calibration-importer',
    calibrationPlanner: 'observatory-calibration-planner',
    calibrationReprocessor: 'observatory-calibration-reprocessor'
  },
  generator: {
    minute: undefined,
    rowsPerInstrument: 120,
    intervalMinutes: 1,
    instrumentCount: 3,
    seed: 1337,
    instrumentProfiles: []
  }
};

function coerceNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coerceNullableNumber(value: string | undefined, fallback: number | null): number | null {
  if (value === undefined || value === null || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coerceBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function cloneDefaults(): ObservatorySettings {
  return JSON.parse(JSON.stringify(FALLBACK_SETTINGS)) as ObservatorySettings;
}

export const loadSettings = createSettingsLoader({
  settingsSchema: ObservatorySettingsSchema,
  secretsSchema: ObservatorySecretsSchema,
  readSettings: (env) => {
    const settings = cloneDefaults();

    settings.filestore.baseUrl = env.OBSERVATORY_FILESTORE_BASE_URL ?? settings.filestore.baseUrl;
    settings.filestore.backendKey = env.OBSERVATORY_FILESTORE_BACKEND_KEY ?? settings.filestore.backendKey;
    settings.filestore.backendId = env.OBSERVATORY_FILESTORE_BACKEND_ID
      ? Number(env.OBSERVATORY_FILESTORE_BACKEND_ID)
      : settings.filestore.backendId;
    settings.filestore.inboxPrefix = env.OBSERVATORY_FILESTORE_INBOX_PREFIX ?? settings.filestore.inboxPrefix;
    settings.filestore.stagingPrefix = env.OBSERVATORY_FILESTORE_STAGING_PREFIX ?? settings.filestore.stagingPrefix;
    settings.filestore.archivePrefix = env.OBSERVATORY_FILESTORE_ARCHIVE_PREFIX ?? settings.filestore.archivePrefix;
    settings.filestore.visualizationsPrefix = env.OBSERVATORY_FILESTORE_VISUALIZATIONS_PREFIX ?? settings.filestore.visualizationsPrefix;
    settings.filestore.reportsPrefix = env.OBSERVATORY_FILESTORE_REPORTS_PREFIX ?? settings.filestore.reportsPrefix;
    settings.filestore.overviewPrefix = env.OBSERVATORY_FILESTORE_OVERVIEW_PREFIX ?? settings.filestore.overviewPrefix;
    settings.filestore.calibrationsPrefix = env.OBSERVATORY_FILESTORE_CALIBRATIONS_PREFIX ?? settings.filestore.calibrationsPrefix;
    settings.filestore.plansPrefix = env.OBSERVATORY_FILESTORE_PLANS_PREFIX ?? settings.filestore.plansPrefix;

    settings.timestore.baseUrl = env.OBSERVATORY_TIMESTORE_BASE_URL ?? settings.timestore.baseUrl;
    settings.timestore.datasetSlug = env.OBSERVATORY_TIMESTORE_DATASET_SLUG ?? settings.timestore.datasetSlug;
    settings.timestore.datasetName = env.OBSERVATORY_TIMESTORE_DATASET_NAME ?? settings.timestore.datasetName;
    settings.timestore.tableName = env.OBSERVATORY_TIMESTORE_TABLE_NAME ?? settings.timestore.tableName;
    settings.timestore.storageTargetId = env.OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID
      ? env.OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID
      : settings.timestore.storageTargetId;
    settings.timestore.partitionNamespace = env.OBSERVATORY_TIMESTORE_PARTITION_NAMESPACE ?? settings.timestore.partitionNamespace;
    settings.timestore.lookbackMinutes = coerceNumber(
      env.OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES,
      settings.timestore.lookbackMinutes
    );

    settings.metastore.baseUrl = env.OBSERVATORY_METASTORE_BASE_URL ?? settings.metastore.baseUrl;
    settings.metastore.namespace = env.OBSERVATORY_METASTORE_NAMESPACE ?? settings.metastore.namespace;

    settings.calibrations.baseUrl = env.OBSERVATORY_CALIBRATIONS_BASE_URL ?? settings.calibrations.baseUrl;
    settings.calibrations.namespace = env.OBSERVATORY_CALIBRATIONS_NAMESPACE ?? settings.calibrations.namespace;

    settings.events.source = env.OBSERVATORY_EVENTS_SOURCE ?? settings.events.source;

    settings.dashboard.lookbackMinutes = coerceNumber(
      env.OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES,
      settings.dashboard.lookbackMinutes
    );
    settings.dashboard.burstQuietMs = coerceNumber(
      env.OBSERVATORY_DASHBOARD_BURST_QUIET_MS,
      settings.dashboard.burstQuietMs
    );
    settings.dashboard.snapshotFreshnessMs = coerceNullableNumber(
      env.OBSERVATORY_DASHBOARD_SNAPSHOT_FRESHNESS_MS,
      settings.dashboard.snapshotFreshnessMs
    );

    settings.core.baseUrl = env.OBSERVATORY_CORE_BASE_URL ?? settings.core.baseUrl;

    settings.reprocess.ingestWorkflowSlug = env.OBSERVATORY_REPROCESS_WORKFLOW_SLUG ?? settings.reprocess.ingestWorkflowSlug;
    settings.reprocess.ingestAssetId = env.OBSERVATORY_REPROCESS_INGEST_ASSET_ID ?? settings.reprocess.ingestAssetId;
    settings.reprocess.metastoreNamespace = env.OBSERVATORY_REPROCESS_METASTORE_NAMESPACE ?? settings.reprocess.metastoreNamespace;
    settings.reprocess.pollIntervalMs = coerceNumber(
      env.OBSERVATORY_REPROCESS_POLL_INTERVAL_MS,
      settings.reprocess.pollIntervalMs
    );

    settings.ingest.maxFiles = coerceNumber(env.OBSERVATORY_INGEST_MAX_FILES, settings.ingest.maxFiles);
    settings.ingest.metastoreNamespace = env.OBSERVATORY_INGEST_METASTORE_NAMESPACE ?? settings.ingest.metastoreNamespace;

    settings.generator.minute = env.OBSERVATORY_GENERATOR_MINUTE ?? settings.generator.minute ?? undefined;
    settings.generator.rowsPerInstrument = coerceNumber(
      env.OBSERVATORY_GENERATOR_ROWS_PER_INSTRUMENT,
      settings.generator.rowsPerInstrument
    );
    settings.generator.intervalMinutes = coerceNumber(
      env.OBSERVATORY_GENERATOR_INTERVAL_MINUTES,
      settings.generator.intervalMinutes
    );
    settings.generator.instrumentCount = coerceNumber(
      env.OBSERVATORY_GENERATOR_INSTRUMENT_COUNT,
      settings.generator.instrumentCount
    );
    settings.generator.seed = coerceNumber(env.OBSERVATORY_GENERATOR_SEED, settings.generator.seed);

    return settings;
  },
  readSecrets: (env) => ({
    filestoreToken: env.OBSERVATORY_FILESTORE_TOKEN,
    timestoreToken: env.OBSERVATORY_TIMESTORE_TOKEN,
    metastoreToken: env.OBSERVATORY_METASTORE_TOKEN,
    calibrationsToken: env.OBSERVATORY_CALIBRATIONS_TOKEN,
    eventsToken: env.OBSERVATORY_EVENTS_TOKEN,
    coreApiToken: env.OBSERVATORY_CORE_TOKEN
  })
});

export const DEFAULT_SETTINGS: ObservatorySettings = FALLBACK_SETTINGS;

const DEFAULT_SECRETS: ObservatorySecrets = {
  filestoreToken: undefined,
  timestoreToken: undefined,
  metastoreToken: undefined,
  calibrationsToken: undefined,
  eventsToken: undefined,
  coreApiToken: undefined
};

export function defaultSecrets(): ObservatorySecrets {
  const env = resolveRuntimeEnv();
  const result = loadSettings({ env });
  return result.secrets ?? { ...DEFAULT_SECRETS };
}

function resolveRuntimeEnv(): Record<string, string | undefined> {
  const mergedEnv: Record<string, string | undefined> = { ...process.env };
  try {
    const config = loadObservatoryConfig();
    const configEnv = buildEnvFromConfig(config);
    for (const [key, value] of Object.entries(configEnv)) {
      if (value !== undefined) {
        const current = mergedEnv[key];
        const hasCurrent = typeof current === 'string' && current.trim().length > 0;
        if (!hasCurrent) {
          mergedEnv[key] = value;
        }
      }
    }
  } catch {
    // Ignore missing runtime config; fall back to process.env defaults.
  }
  return mergedEnv;
}

function buildEnvFromConfig(config: import('../runtime/config').ObservatoryConfig): Record<string, string> {
  const env: Record<string, string> = {};

  const filestore = config.filestore;
  if (filestore.baseUrl) env.OBSERVATORY_FILESTORE_BASE_URL = filestore.baseUrl;
  if (filestore.backendMountKey) env.OBSERVATORY_FILESTORE_BACKEND_KEY = filestore.backendMountKey;
  if (typeof filestore.backendMountId === 'number') {
    env.OBSERVATORY_FILESTORE_BACKEND_ID = String(filestore.backendMountId);
  }
  if (filestore.inboxPrefix) env.OBSERVATORY_FILESTORE_INBOX_PREFIX = filestore.inboxPrefix;
  if (filestore.stagingPrefix) env.OBSERVATORY_FILESTORE_STAGING_PREFIX = filestore.stagingPrefix;
  if (filestore.archivePrefix) env.OBSERVATORY_FILESTORE_ARCHIVE_PREFIX = filestore.archivePrefix;
  if (filestore.visualizationsPrefix) env.OBSERVATORY_FILESTORE_VISUALIZATIONS_PREFIX = filestore.visualizationsPrefix;
  if (filestore.reportsPrefix) env.OBSERVATORY_FILESTORE_REPORTS_PREFIX = filestore.reportsPrefix;
  if (filestore.calibrationsPrefix) env.OBSERVATORY_FILESTORE_CALIBRATIONS_PREFIX = filestore.calibrationsPrefix;
  if (filestore.plansPrefix) env.OBSERVATORY_FILESTORE_PLANS_PREFIX = filestore.plansPrefix;

  const timestore = config.timestore;
  if (timestore.baseUrl) env.OBSERVATORY_TIMESTORE_BASE_URL = timestore.baseUrl;
  if (timestore.datasetSlug) env.OBSERVATORY_TIMESTORE_DATASET_SLUG = timestore.datasetSlug;
  if (timestore.datasetName) env.OBSERVATORY_TIMESTORE_DATASET_NAME = timestore.datasetName;
  if (timestore.tableName) env.OBSERVATORY_TIMESTORE_TABLE_NAME = timestore.tableName;
  if (timestore.storageTargetId) env.OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID = timestore.storageTargetId;
  if (timestore.partitionNamespace) env.OBSERVATORY_TIMESTORE_PARTITION_NAMESPACE = timestore.partitionNamespace;

  const metastore = config.metastore ?? {};
  if (metastore.baseUrl) env.OBSERVATORY_METASTORE_BASE_URL = metastore.baseUrl;
  if (metastore.namespace) env.OBSERVATORY_METASTORE_NAMESPACE = metastore.namespace;
  if (metastore.authToken) env.OBSERVATORY_METASTORE_TOKEN = metastore.authToken;

  const core = config.core ?? {};
  if (core.baseUrl) env.OBSERVATORY_CORE_BASE_URL = core.baseUrl;
  if (core.apiToken) env.OBSERVATORY_CORE_TOKEN = core.apiToken;

  const workflows = config.workflows;
  if (workflows.ingestSlug) env.OBSERVATORY_INGEST_WORKFLOW_SLUG = workflows.ingestSlug;
  if (workflows.publicationSlug) env.OBSERVATORY_PUBLICATION_WORKFLOW_SLUG = workflows.publicationSlug;
  if (workflows.aggregateSlug) env.OBSERVATORY_DASHBOARD_WORKFLOW_SLUG = workflows.aggregateSlug;
  if (workflows.calibrationImportSlug) env.OBSERVATORY_CALIBRATION_WORKFLOW_SLUG = workflows.calibrationImportSlug;
  if (workflows.visualizationAssetId) env.OBSERVATORY_VISUALIZATION_ASSET_ID = workflows.visualizationAssetId;

  const dashboard = workflows.dashboard ?? {};
  if (dashboard.lookbackMinutes !== undefined) {
    env.OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES = String(dashboard.lookbackMinutes);
  }
  if (dashboard.burstQuietMillis !== undefined) {
    env.OBSERVATORY_DASHBOARD_BURST_QUIET_MS = String(dashboard.burstQuietMillis);
  }
  if (dashboard.snapshotFreshnessMillis !== undefined && dashboard.snapshotFreshnessMillis !== null) {
    env.OBSERVATORY_DASHBOARD_SNAPSHOT_FRESHNESS_MS = String(dashboard.snapshotFreshnessMillis);
  }

  const generator = workflows.generator ?? {};
  if (generator.instrumentCount !== undefined) {
    env.OBSERVATORY_GENERATOR_INSTRUMENT_COUNT = String(generator.instrumentCount);
  }

  return env;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function applyOverrides(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    if (isPlainRecord(value)) {
      const existing = target[key];
      if (isPlainRecord(existing)) {
        applyOverrides(existing, value);
      } else {
        const next: Record<string, unknown> = {};
        target[key] = next;
        applyOverrides(next, value);
      }
      continue;
    }
    target[key] = value as unknown;
  }
}

export function defaultSettings(): ObservatorySettings {
  const env = resolveRuntimeEnv();
  return loadSettings({ env }).settings;
}

function mergeObservatorySettings(
  base: ObservatorySettings,
  overrides: Record<string, unknown>
): ObservatorySettings {
  applyOverrides(base as unknown as Record<string, unknown>, overrides);
  return base;
}

function mergeObservatorySecrets(
  base: ObservatorySecrets,
  overrides: Record<string, unknown>
): ObservatorySecrets {
  const target = base as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete target[key];
      continue;
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      delete target[key];
      continue;
    }
    target[key] = value;
  }
  return base;
}

export function resolveSettingsFromRaw(raw: unknown): ObservatorySettings {
  if (!isPlainRecord(raw)) {
    return defaultSettings();
  }
  const merged = mergeObservatorySettings(defaultSettings(), raw);
  return ObservatorySettingsSchema.parse(merged);
}

export function resolveSecretsFromRaw(raw: unknown): ObservatorySecrets {
  if (!isPlainRecord(raw)) {
    return defaultSecrets();
  }
  const merged = mergeObservatorySecrets(defaultSecrets(), raw);
  return ObservatorySecretsSchema.parse(merged);
}
