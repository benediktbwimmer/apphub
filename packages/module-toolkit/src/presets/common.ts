import { createEnvBindingPreset, registerEnvBindingPreset } from '../config';

export const ENV_PRESET_FILESTORE = 'apphub.env.filestore';
export const ENV_PRESET_TIMESTORE = 'apphub.env.timestore';
export const ENV_PRESET_METASTORE = 'apphub.env.metastore';
export const ENV_PRESET_CALIBRATIONS = 'apphub.env.calibrations';
export const ENV_PRESET_EVENTS = 'apphub.env.events';
export const ENV_PRESET_DASHBOARD = 'apphub.env.dashboard';
export const ENV_PRESET_CORE = 'apphub.env.core';
export const ENV_PRESET_SECRETS_STANDARD = 'apphub.env.secrets.standard';
export const ENV_PRESET_REPROCESS = 'apphub.env.reprocess';
export const ENV_PRESET_INGEST = 'apphub.env.ingest';
export const ENV_PRESET_GENERATOR = 'apphub.env.generator';

registerEnvBindingPreset(
  ENV_PRESET_FILESTORE,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_FILESTORE_BASE_URL', path: 'filestore.baseUrl' },
    { key: 'OBSERVATORY_FILESTORE_BACKEND_KEY', path: 'filestore.backendKey' },
    {
      key: 'OBSERVATORY_FILESTORE_BACKEND_ID',
      path: 'filestore.backendId',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number | null);
      }
    },
    { key: 'OBSERVATORY_FILESTORE_INBOX_PREFIX', path: 'filestore.inboxPrefix' },
    { key: 'OBSERVATORY_FILESTORE_STAGING_PREFIX', path: 'filestore.stagingPrefix' },
    { key: 'OBSERVATORY_FILESTORE_ARCHIVE_PREFIX', path: 'filestore.archivePrefix' },
    { key: 'OBSERVATORY_FILESTORE_VISUALIZATIONS_PREFIX', path: 'filestore.visualizationsPrefix' },
    { key: 'OBSERVATORY_FILESTORE_REPORTS_PREFIX', path: 'filestore.reportsPrefix' },
    { key: 'OBSERVATORY_FILESTORE_OVERVIEW_PREFIX', path: 'filestore.overviewPrefix' },
    { key: 'OBSERVATORY_FILESTORE_CALIBRATIONS_PREFIX', path: 'filestore.calibrationsPrefix' },
    { key: 'OBSERVATORY_FILESTORE_PLANS_PREFIX', path: 'filestore.plansPrefix' }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_TIMESTORE,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_TIMESTORE_BASE_URL', path: 'timestore.baseUrl' },
    { key: 'OBSERVATORY_TIMESTORE_DATASET_SLUG', path: 'timestore.datasetSlug' },
    { key: 'OBSERVATORY_TIMESTORE_DATASET_NAME', path: 'timestore.datasetName' },
    { key: 'OBSERVATORY_TIMESTORE_TABLE_NAME', path: 'timestore.tableName' },
    { key: 'OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID', path: 'timestore.storageTargetId' },
    { key: 'OBSERVATORY_TIMESTORE_PARTITION_NAMESPACE', path: 'timestore.partitionNamespace' },
    {
      key: 'OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES',
      path: 'timestore.lookbackMinutes',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_METASTORE,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_METASTORE_BASE_URL', path: 'metastore.baseUrl' },
    { key: 'OBSERVATORY_METASTORE_NAMESPACE', path: 'metastore.namespace' }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_CALIBRATIONS,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_CALIBRATIONS_BASE_URL', path: 'calibrations.baseUrl' },
    { key: 'OBSERVATORY_CALIBRATIONS_NAMESPACE', path: 'calibrations.namespace' }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_EVENTS,
  createEnvBindingPreset([{ key: 'OBSERVATORY_EVENTS_SOURCE', path: 'events.source' }])
);

registerEnvBindingPreset(
  ENV_PRESET_DASHBOARD,
  createEnvBindingPreset([
    {
      key: 'OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES',
      path: 'dashboard.lookbackMinutes',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    },
    {
      key: 'OBSERVATORY_DASHBOARD_BURST_QUIET_MS',
      path: 'dashboard.burstQuietMs',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    },
    {
      key: 'OBSERVATORY_DASHBOARD_SNAPSHOT_FRESHNESS_MS',
      path: 'dashboard.snapshotFreshnessMs',
      map: ({ value, current }) => {
        if (value === undefined || value === null || value.trim().length === 0) {
          return current as number | null;
        }
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number | null);
      }
    }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_CORE,
  createEnvBindingPreset([{ key: 'OBSERVATORY_CORE_BASE_URL', path: 'core.baseUrl' }])
);

registerEnvBindingPreset(
  ENV_PRESET_SECRETS_STANDARD,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_FILESTORE_TOKEN', path: 'filestoreToken' },
    { key: 'OBSERVATORY_TIMESTORE_TOKEN', path: 'timestoreToken' },
    { key: 'OBSERVATORY_METASTORE_TOKEN', path: 'metastoreToken' },
    { key: 'OBSERVATORY_CALIBRATIONS_TOKEN', path: 'calibrationsToken' },
    { key: 'OBSERVATORY_EVENTS_TOKEN', path: 'eventsToken' },
    { key: 'OBSERVATORY_CORE_TOKEN', path: 'coreApiToken' }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_REPROCESS,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_REPROCESS_WORKFLOW_SLUG', path: 'reprocess.ingestWorkflowSlug' },
    { key: 'OBSERVATORY_REPROCESS_INGEST_ASSET_ID', path: 'reprocess.ingestAssetId' },
    { key: 'OBSERVATORY_REPROCESS_METASTORE_NAMESPACE', path: 'reprocess.metastoreNamespace' },
    {
      key: 'OBSERVATORY_REPROCESS_POLL_INTERVAL_MS',
      path: 'reprocess.pollIntervalMs',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_INGEST,
  createEnvBindingPreset([
    {
      key: 'OBSERVATORY_INGEST_MAX_FILES',
      path: 'ingest.maxFiles',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    },
    { key: 'OBSERVATORY_INGEST_METASTORE_NAMESPACE', path: 'ingest.metastoreNamespace' }
  ])
);

registerEnvBindingPreset(
  ENV_PRESET_GENERATOR,
  createEnvBindingPreset([
    { key: 'OBSERVATORY_GENERATOR_MINUTE', path: 'generator.minute' },
    {
      key: 'OBSERVATORY_GENERATOR_ROWS_PER_INSTRUMENT',
      path: 'generator.rowsPerInstrument',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    },
    {
      key: 'OBSERVATORY_GENERATOR_INTERVAL_MINUTES',
      path: 'generator.intervalMinutes',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    },
    {
      key: 'OBSERVATORY_GENERATOR_INSTRUMENT_COUNT',
      path: 'generator.instrumentCount',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    },
    {
      key: 'OBSERVATORY_GENERATOR_SEED',
      path: 'generator.seed',
      map: ({ value, current }) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : (current as number);
      }
    }
  ])
);

export const COMMON_ENV_PRESET_KEYS = {
  filestore: ENV_PRESET_FILESTORE,
  timestore: ENV_PRESET_TIMESTORE,
  metastore: ENV_PRESET_METASTORE,
  calibrations: ENV_PRESET_CALIBRATIONS,
  events: ENV_PRESET_EVENTS,
  dashboard: ENV_PRESET_DASHBOARD,
  core: ENV_PRESET_CORE,
  standardSecrets: ENV_PRESET_SECRETS_STANDARD,
  reprocess: ENV_PRESET_REPROCESS,
  ingest: ENV_PRESET_INGEST,
  generator: ENV_PRESET_GENERATOR
} as const;
