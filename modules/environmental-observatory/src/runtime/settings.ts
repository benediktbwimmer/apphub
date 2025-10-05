import type { CalibrationPlanDownstreamWorkflow } from './plans';
import { loadObservatoryConfig } from './config';

export interface FilestoreSettings {
  baseUrl: string;
  backendKey: string;
  backendId: number | null;
  inboxPrefix: string;
  stagingPrefix: string;
  archivePrefix: string;
  visualizationsPrefix: string;
  reportsPrefix: string;
  overviewPrefix: string;
  calibrationsPrefix: string;
  plansPrefix: string;
}

export interface TimestoreSettings {
  baseUrl: string;
  datasetSlug: string;
  datasetName: string;
  tableName: string;
  storageTargetId: string | null;
  partitionNamespace: string;
  lookbackMinutes: number;
}

export interface MetastoreSettings {
  baseUrl: string;
  namespace: string;
}

export interface CalibrationMetastoreSettings {
  baseUrl: string | null;
  namespace: string;
}

export interface EventSettings {
  source: string;
}

export interface DashboardSettings {
  lookbackMinutes: number;
}

export interface CoreSettings {
  baseUrl: string;
}

export interface CalibrationReprocessSettings {
  ingestWorkflowSlug: string;
  ingestAssetId: string;
  downstreamWorkflows: CalibrationPlanDownstreamWorkflow[];
  metastoreNamespace: string;
  pollIntervalMs: number;
}

export interface IngestSettings {
  maxFiles: number;
  metastoreNamespace: string;
}

export interface PrincipalSettings {
  dataGenerator: string;
  inboxNormalizer: string;
  timestoreLoader: string;
  visualizationRunner: string;
  dashboardAggregator: string;
  calibrationImporter: string;
  calibrationPlanner: string;
  calibrationReprocessor: string;
}

export interface GeneratorInstrumentProfile {
  instrumentId: string;
  site: string;
  baselineTemperatureC: number;
  baselineHumidityPct: number;
  baselinePm25UgM3: number;
  baselineBatteryVoltage: number;
}

export interface GeneratorSettings {
  minute?: string | null;
  rowsPerInstrument: number;
  intervalMinutes: number;
  instrumentCount: number;
  seed: number;
  instrumentProfiles: GeneratorInstrumentProfile[];
}

export interface ObservatoryModuleSettings {
  filestore: FilestoreSettings;
  timestore: TimestoreSettings;
  metastore: MetastoreSettings;
  calibrations: CalibrationMetastoreSettings;
  events: EventSettings;
  dashboard: DashboardSettings;
  core: CoreSettings;
  reprocess: CalibrationReprocessSettings;
  ingest: IngestSettings;
  principals: PrincipalSettings;
  generator: GeneratorSettings;
}

export interface ObservatoryModuleSecrets {
  filestoreToken?: string;
  timestoreToken?: string;
  metastoreToken?: string;
  calibrationsToken?: string;
  eventsToken?: string;
  coreApiToken?: string;
}

const FALLBACK_OBSERVATORY_SETTINGS: ObservatoryModuleSettings = {
  filestore: {
    baseUrl: 'http://127.0.0.1:4300',
    backendKey: 'observatory-event-driven-s3',
    backendId: 1,
    inboxPrefix: 'datasets/observatory/inbox',
    stagingPrefix: 'datasets/observatory/staging',
    archivePrefix: 'datasets/observatory/archive',
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
    lookbackMinutes: 720
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
    inboxNormalizer: 'observatory-inbox-normalizer',
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

function cloneSettings(): ObservatoryModuleSettings {
  return JSON.parse(JSON.stringify(FALLBACK_OBSERVATORY_SETTINGS)) as ObservatoryModuleSettings;
}

function coerceInstrumentCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.trunc(value));
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const envMatch = value.match(/^env\.(.+)$/i);
    if (envMatch) {
      const envValue = process.env[envMatch[1]];
      return coerceInstrumentCount(envValue);
    }
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(1, parsed);
    }
  }
  return undefined;
}

export function resolveObservatorySettingsDefaults(): ObservatoryModuleSettings {
  const settings = cloneSettings();
  try {
    const config = loadObservatoryConfig();

    if (config.filestore) {
      settings.filestore.baseUrl = config.filestore.baseUrl ?? settings.filestore.baseUrl;
      if (typeof (config.filestore as { backendMountId?: number }).backendMountId === 'number') {
        const id = (config.filestore as { backendMountId?: number }).backendMountId;
        if (id && id > 0) {
          settings.filestore.backendId = id;
        }
      }
      if ((config.filestore as { backendMountKey?: string }).backendMountKey) {
        settings.filestore.backendKey = (config.filestore as { backendMountKey?: string }).backendMountKey ?? settings.filestore.backendKey;
      }
      settings.filestore.inboxPrefix = config.filestore.inboxPrefix ?? settings.filestore.inboxPrefix;
      settings.filestore.stagingPrefix = config.filestore.stagingPrefix ?? settings.filestore.stagingPrefix;
      settings.filestore.archivePrefix = config.filestore.archivePrefix ?? settings.filestore.archivePrefix;
      settings.filestore.visualizationsPrefix = config.filestore.visualizationsPrefix ?? settings.filestore.visualizationsPrefix;
      settings.filestore.reportsPrefix = config.filestore.reportsPrefix ?? settings.filestore.reportsPrefix;
      if ('calibrationsPrefix' in config.filestore && config.filestore.calibrationsPrefix) {
        settings.filestore.calibrationsPrefix = config.filestore.calibrationsPrefix;
      }
      if ('plansPrefix' in config.filestore && config.filestore.plansPrefix) {
        settings.filestore.plansPrefix = config.filestore.plansPrefix ?? settings.filestore.plansPrefix;
      }
    }

    if (config.timestore) {
      settings.timestore.baseUrl = config.timestore.baseUrl ?? settings.timestore.baseUrl;
      settings.timestore.datasetSlug = config.timestore.datasetSlug ?? settings.timestore.datasetSlug;
      settings.timestore.datasetName = config.timestore.datasetName ?? settings.timestore.datasetName;
      settings.timestore.tableName = config.timestore.tableName ?? settings.timestore.tableName;
      settings.timestore.storageTargetId = config.timestore.storageTargetId ?? settings.timestore.storageTargetId;
    }

    if (config.metastore) {
      settings.metastore.baseUrl = config.metastore.baseUrl ?? settings.metastore.baseUrl;
      settings.metastore.namespace = config.metastore.namespace ?? settings.metastore.namespace;
      if (config.metastore.baseUrl) {
        settings.calibrations.baseUrl = config.metastore.baseUrl;
      }
      if (config.metastore.namespace) {
        settings.calibrations.namespace = config.metastore.namespace;
      }
    }

    if (config.core?.baseUrl) {
      settings.core.baseUrl = config.core.baseUrl;
    }

    if (config.workflows?.dashboard?.lookbackMinutes !== undefined) {
      const lookback = Number(config.workflows.dashboard.lookbackMinutes);
      if (Number.isFinite(lookback) && lookback > 0) {
        settings.dashboard.lookbackMinutes = Math.trunc(lookback);
      }
    }

    const instrumentCount = coerceInstrumentCount(config.workflows?.generator?.instrumentCount);
    if (instrumentCount) {
      settings.generator.instrumentCount = instrumentCount;
    }
  } catch (error) {
    // Fallback to baked settings when config is unavailable; avoid noisy logging.
  }

  return settings;
}

export function resolveObservatorySecretsDefaults(): ObservatoryModuleSecrets {
  const secrets: ObservatoryModuleSecrets = {};
  try {
    const config = loadObservatoryConfig();
    if (config.filestore?.token) {
      secrets.filestoreToken = config.filestore.token;
    }
    if (config.timestore?.authToken) {
      secrets.timestoreToken = config.timestore.authToken;
    }
    if (config.metastore?.authToken) {
      secrets.metastoreToken = config.metastore.authToken;
      secrets.calibrationsToken = config.metastore.authToken;
    }
    if (config.core?.apiToken) {
      secrets.coreApiToken = config.core.apiToken;
      secrets.eventsToken = secrets.eventsToken ?? config.core.apiToken;
    }
  } catch (error) {
    // Ignore; fall back to empty secrets when config missing.
  }
  return secrets;
}

export const defaultObservatorySettings = resolveObservatorySettingsDefaults();
export const defaultObservatorySecrets = resolveObservatorySecretsDefaults();
