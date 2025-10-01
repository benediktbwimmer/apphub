import type { CalibrationPlanDownstreamWorkflow } from './plans';

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

export const defaultObservatorySettings: ObservatoryModuleSettings = {
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
