import { z } from 'zod';
import {
  createModuleSettingsDefinition,
  createEnvSource,
  COMMON_ENV_PRESET_KEYS
} from '@apphub/module-toolkit';
import { loadObservatoryConfig } from '../runtime/config';
import { PRINCIPAL_SUBJECTS, security } from './security';

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

const DEFAULT_SECRETS: ObservatorySecrets = {
  filestoreToken: undefined,
  timestoreToken: undefined,
  metastoreToken: undefined,
  calibrationsToken: undefined,
  eventsToken: undefined,
  coreApiToken: undefined
};

const FALLBACK_SETTINGS: ObservatorySettings = {
  filestore: {
    baseUrl: 'http://127.0.0.1:4300',
    backendKey: 'observatory-event-driven-s3',
    backendId: null,
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
  principals: { ...PRINCIPAL_SUBJECTS },
  generator: {
    minute: undefined,
    rowsPerInstrument: 120,
    intervalMinutes: 1,
    instrumentCount: 3,
    seed: 1337,
    instrumentProfiles: []
  }
};
 
export const DEFAULT_SETTINGS: ObservatorySettings = FALLBACK_SETTINGS;

const runtimeConfigEnvSource = createEnvSource(() => {
  try {
    const config = loadObservatoryConfig();
    return {
      values: buildEnvFromConfig(config),
      mode: 'fill'
    };
  } catch {
    return undefined;
  }
});

const settingsDefinition = createModuleSettingsDefinition({
  settingsSchema: ObservatorySettingsSchema,
  secretsSchema: ObservatorySecretsSchema,
  defaults: () => DEFAULT_SETTINGS,
  secretsDefaults: () => DEFAULT_SECRETS,
  security,
  envPresetKeys: [
    COMMON_ENV_PRESET_KEYS.filestore,
    COMMON_ENV_PRESET_KEYS.timestore,
    COMMON_ENV_PRESET_KEYS.metastore,
    COMMON_ENV_PRESET_KEYS.calibrations,
    COMMON_ENV_PRESET_KEYS.events,
    COMMON_ENV_PRESET_KEYS.dashboard,
    COMMON_ENV_PRESET_KEYS.core,
    COMMON_ENV_PRESET_KEYS.reprocess,
    COMMON_ENV_PRESET_KEYS.ingest,
    COMMON_ENV_PRESET_KEYS.generator
  ],
  secretsEnvPresetKeys: [COMMON_ENV_PRESET_KEYS.standardSecrets],
  envSources: [runtimeConfigEnvSource],
  secretsEnvSources: [runtimeConfigEnvSource]
});

export const loadSettings = settingsDefinition.load;

export function defaultSettings(): ObservatorySettings {
  return settingsDefinition.defaultSettings();
}

export function defaultSecrets(): ObservatorySecrets {
  return settingsDefinition.defaultSecrets();
}

export function resolveSettingsFromRaw(raw: unknown): ObservatorySettings {
  return settingsDefinition.resolveSettings(raw);
}

export function resolveSecretsFromRaw(raw: unknown): ObservatorySecrets {
  return settingsDefinition.resolveSecrets(raw);
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
