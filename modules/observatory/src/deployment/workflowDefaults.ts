import type { WorkflowDefinition } from '@apphub/module-sdk';
import type { EventDrivenObservatoryConfig } from './configBuilder';

type JsonValue = unknown;
type JsonObject = Record<string, JsonValue>;

const OBSERVATORY_WORKFLOW_SLUGS = new Set([
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication',
  'observatory-dashboard-aggregate',
  'observatory-calibration-import',
  'observatory-calibration-reprocess'
]);

function ensureJsonObject(value: JsonValue | undefined): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function applyFilestoreBackendReference(target: JsonObject, config: EventDrivenObservatoryConfig): void {
  if (target.filestoreBackendKey === undefined) {
    target.filestoreBackendKey = config.filestore.backendMountKey;
  }
  if (target.backendMountKey === undefined) {
    target.backendMountKey = config.filestore.backendMountKey;
  }
  const backendId = config.filestore.backendMountId;
  if (typeof backendId === 'number' && Number.isFinite(backendId)) {
    target.filestoreBackendId = backendId;
    target.backendMountId = backendId;
  } else if (target.filestoreBackendId === undefined) {
    target.filestoreBackendId = null;
    if (target.backendMountId === undefined) {
      target.backendMountId = null;
    }
  } else if (target.backendMountId === undefined) {
    target.backendMountId = target.filestoreBackendId;
  }
}

export function applyObservatoryWorkflowDefaults(
  definition: WorkflowDefinition,
  config: EventDrivenObservatoryConfig
): void {
  if (!OBSERVATORY_WORKFLOW_SLUGS.has(definition.slug)) {
    return;
  }

  const defaults = ensureJsonObject(definition.defaultParameters as JsonValue | undefined);
  definition.defaultParameters = defaults;

  switch (definition.slug) {
    case 'observatory-minute-data-generator':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.inboxPrefix = config.filestore.inboxPrefix;
      defaults.stagingPrefix = config.filestore.stagingPrefix;
      defaults.archivePrefix = config.filestore.archivePrefix;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-data-generator';
      defaults.filestoreToken = config.filestore.token ?? null;
      if (defaults.seed === undefined || defaults.seed === null) {
        defaults.seed = 1337;
      }
      if (config.workflows.generator?.instrumentCount !== undefined) {
        defaults.instrumentCount = config.workflows.generator.instrumentCount;
      }
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace =
        defaults.metastoreNamespace ?? config.metastore?.namespace ?? 'observatory.ingest';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      break;

    case 'observatory-minute-ingest':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.inboxPrefix = config.filestore.inboxPrefix;
      defaults.stagingPrefix = config.filestore.stagingPrefix;
      defaults.archivePrefix = config.filestore.archivePrefix;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-minute-preprocessor';
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreDatasetName = config.timestore.datasetName ?? null;
      defaults.timestoreTableName = config.timestore.tableName ?? null;
      defaults.timestoreStorageTargetId = config.timestore.storageTargetId ?? null;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace =
        defaults.metastoreNamespace ?? config.metastore?.namespace ?? 'observatory.ingest';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;

      {
        const quietMs = config.workflows.dashboard?.burstQuietMillis ?? defaults.burstQuietMs ?? 5_000;
        const loadStep = definition.steps?.find((step) => step && (step as Record<string, unknown>).id === 'load-timestore');
        if (loadStep && Array.isArray((loadStep as Record<string, unknown>).produces)) {
          const produces = (loadStep as Record<string, unknown>).produces as Array<Record<string, unknown>>;
          const burstAsset = produces.find(
            (asset) => asset && asset.assetId === 'observatory.burst.window'
          );
          if (burstAsset) {
            const freshness =
              burstAsset.freshness && typeof burstAsset.freshness === 'object' && !Array.isArray(burstAsset.freshness)
                ? (burstAsset.freshness as Record<string, unknown>)
                : {};
            freshness.ttlMs = quietMs;
            burstAsset.freshness = freshness;
          }
        }
      }
      break;

    case 'observatory-daily-publication':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-visualization-runner';
      defaults.visualizationsPrefix = config.filestore.visualizationsPrefix ?? 'datasets/observatory/visualizations';
      defaults.reportsPrefix = config.filestore.reportsPrefix ?? 'datasets/observatory/reports';
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace = config.metastore?.namespace ?? defaults.metastoreNamespace ?? 'observatory.reports';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      break;

    case 'observatory-dashboard-aggregate':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-dashboard-aggregator';
      defaults.reportsPrefix = config.filestore.reportsPrefix ?? 'datasets/observatory/reports';
      defaults.overviewPrefix =
        config.workflows.dashboard?.overviewPrefix ?? `${defaults.reportsPrefix ?? 'datasets/observatory/reports'}/overview`;
      defaults.lookbackMinutes = config.workflows.dashboard?.lookbackMinutes ?? defaults.lookbackMinutes ?? 720;
      defaults.burstQuietMs = config.workflows.dashboard?.burstQuietMillis ?? defaults.burstQuietMs ?? 5_000;
      if ('snapshotFreshnessMs' in defaults) {
        delete (defaults as Record<string, unknown>).snapshotFreshnessMs;
      }
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;

      {
        const aggregateStep = definition.steps?.find(
          (step) => step && (step as Record<string, unknown>).id === 'aggregate-dashboard'
        );
        if (aggregateStep && Array.isArray((aggregateStep as Record<string, unknown>).produces)) {
          const produces = (aggregateStep as Record<string, unknown>).produces as Array<Record<string, unknown>>;
          const snapshotAsset = produces.find(
            (asset) => asset && asset.assetId === 'observatory.dashboard.snapshot'
          );
          if (snapshotAsset && snapshotAsset.freshness) {
            delete snapshotAsset.freshness;
          }
        }
      }
      break;

    case 'observatory-calibration-import':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.calibrationsPrefix = config.filestore.calibrationsPrefix;
      defaults.plansPrefix = config.filestore.plansPrefix ?? null;
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace = defaults.metastoreNamespace ?? 'observatory.calibrations';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      break;

    case 'observatory-calibration-reprocess':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      applyFilestoreBackendReference(defaults, config);
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.calibrationsPrefix = config.filestore.calibrationsPrefix;
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? defaults.metastoreBaseUrl ?? null;
      defaults.metastoreNamespace = defaults.metastoreNamespace ?? 'observatory.calibrations';
      defaults.metastoreAuthToken = config.metastore?.authToken ?? defaults.metastoreAuthToken ?? null;
      break;
  }
}
