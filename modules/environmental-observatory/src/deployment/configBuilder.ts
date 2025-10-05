import os from 'node:os';
import path from 'node:path';

export type ObservatoryConfig = {
  paths: {
    inbox: string;
    staging: string;
    archive: string;
    plots: string;
    reports: string;
  };
  filestore: {
    baseUrl: string;
    backendMountKey: string;
    backendMountId?: number | null;
    token?: string | null;
    inboxPrefix: string;
    stagingPrefix: string;
    archivePrefix: string;
    visualizationsPrefix?: string;
    reportsPrefix?: string;
    calibrationsPrefix: string;
    plansPrefix?: string | null;
    bucket?: string | null;
    endpoint?: string | null;
    region?: string | null;
    forcePathStyle?: boolean | null;
    accessKeyId?: string | null;
    secretAccessKey?: string | null;
    sessionToken?: string | null;
  };
  timestore: {
    baseUrl: string;
    datasetSlug: string;
    datasetName?: string;
    tableName?: string;
    storageTargetId?: string;
    authToken?: string;
    storageDriver?: 'local' | 's3' | 'gcs' | 'azure_blob';
    storageRoot?: string;
    cacheDir?: string;
  };
  metastore?: {
    baseUrl?: string;
    namespace?: string;
    authToken?: string;
  };
  core?: {
    baseUrl?: string;
    apiToken?: string;
  };
  workflows: {
    ingestSlug: string;
    publicationSlug: string;
    aggregateSlug: string;
    calibrationImportSlug: string;
    visualizationAssetId: string;
    generator?: {
      instrumentCount?: number;
    };
    dashboard?: {
      overviewPrefix?: string;
      lookbackMinutes?: number;
      burstQuietMillis?: number;
      snapshotFreshnessMillis?: number;
    };
  };
};

export type EventDrivenObservatoryConfig = ObservatoryConfig;

export interface EventDrivenObservatoryConfigOptions {
  repoRoot: string;
  variables?: Record<string, string | undefined> | null;
  outputPath?: string;
}

type TimestoreDriver = 'local' | 's3' | 'gcs' | 'azure_blob';

function optionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveString(value: string | undefined, fallback: string | undefined, key: string): string {
  const candidate = optionalString(value) ?? fallback;
  if (!candidate) {
    throw new Error(`Missing required configuration for ${key}`);
  }
  return candidate;
}

function resolvePathValue(repoRoot: string, value: string | undefined, fallback: string, key: string): string {
  const candidate = optionalString(value) ?? fallback;
  if (!candidate) {
    throw new Error(`Missing required configuration for ${key}`);
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
}

function resolveOptionalPath(repoRoot: string, value: string | undefined): string | undefined {
  const candidate = optionalString(value);
  if (!candidate) {
    return undefined;
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
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

function resolveTimestoreDriver(rawValue: string | undefined): TimestoreDriver {
  const raw = optionalString(rawValue);
  if (!raw) {
    return 's3';
  }
  const normalized = raw.toLowerCase().replace(/-/g, '_');
  if (normalized === 'local' || normalized === 's3' || normalized === 'gcs' || normalized === 'azure_blob') {
    return normalized;
  }
  throw new Error(
    `Unsupported OBSERVATORY_TIMESTORE_STORAGE_DRIVER '${raw}'. Expected one of local, s3, gcs, azure_blob.`
  );
}

export function createEventDrivenObservatoryConfig(
  options: EventDrivenObservatoryConfigOptions
): { config: EventDrivenObservatoryConfig; outputPath: string } {
  const repoRoot = path.resolve(options.repoRoot);
  const vars = options.variables ?? {};
  const getVar = (name: string, fallbacks: string[] = []): string | undefined => {
    if (Object.prototype.hasOwnProperty.call(vars, name)) {
      const raw = vars[name];
      return raw === undefined ? undefined : raw;
    }
    for (const candidate of fallbacks) {
      if (Object.prototype.hasOwnProperty.call(vars, candidate)) {
        const raw = vars[candidate];
        return raw === undefined ? undefined : raw;
      }
    }
    const envCandidates = [name, ...fallbacks];
    for (const candidate of envCandidates) {
      if (process.env[candidate] !== undefined) {
        return process.env[candidate];
      }
    }
    return undefined;
  };

  const scratchRoot = optionalString(getVar('APPHUB_SCRATCH_ROOT'))
    ?? optionalString(getVar('TMPDIR'))
    ?? os.tmpdir();
  const defaultDataDir = path.resolve(scratchRoot, 'observatory');
  const resolvedOutput = options.outputPath ?? getVar('OBSERVATORY_CONFIG_OUTPUT');
  const outputPath = path.resolve(
    resolvedOutput && resolvedOutput.trim().length > 0
      ? resolvedOutput
      : path.join(defaultDataDir, 'config', 'observatory-config.json')
  );

  const dataRoot = resolvePathValue(
    repoRoot,
    getVar('OBSERVATORY_DATA_ROOT'),
    defaultDataDir,
    'paths.dataRoot'
  );

  const filestoreBackendKey = resolveString(
    getVar('OBSERVATORY_FILESTORE_BACKEND_KEY', ['OBSERVATORY_FILESTORE_MOUNT_KEY']),
    'observatory-event-driven-s3',
    'filestore.backendMountKey'
  );
  const filestoreBackendId = optionalNumber(getVar('OBSERVATORY_FILESTORE_BACKEND_ID'));

  const filestore = {
    baseUrl: resolveString(
      getVar('OBSERVATORY_FILESTORE_BASE_URL'),
      'http://127.0.0.1:4300',
      'filestore.baseUrl'
    ),
    backendMountKey: filestoreBackendKey,
    backendMountId: filestoreBackendId ?? null,
    token: optionalString(getVar('OBSERVATORY_FILESTORE_TOKEN')) ?? null,
    inboxPrefix: resolveString(
      getVar('OBSERVATORY_FILESTORE_INBOX_PREFIX'),
      'datasets/observatory/inbox',
      'filestore.inboxPrefix'
    ),
    stagingPrefix: resolveString(
      getVar('OBSERVATORY_FILESTORE_STAGING_PREFIX'),
      'datasets/observatory/staging',
      'filestore.stagingPrefix'
    ),
    archivePrefix: resolveString(
      getVar('OBSERVATORY_FILESTORE_ARCHIVE_PREFIX'),
      'datasets/observatory/archive',
      'filestore.archivePrefix'
    ),
    visualizationsPrefix: resolveString(
      getVar('OBSERVATORY_FILESTORE_VIS_PREFIX'),
      'datasets/observatory/visualizations',
      'filestore.visualizationsPrefix'
    ),
    reportsPrefix: resolveString(
      getVar('OBSERVATORY_FILESTORE_REPORTS_PREFIX'),
      'datasets/observatory/reports',
      'filestore.reportsPrefix'
    ),
    calibrationsPrefix: resolveString(
      getVar('OBSERVATORY_FILESTORE_CALIBRATIONS_PREFIX'),
      'datasets/observatory/calibrations',
      'filestore.calibrationsPrefix'
    ),
    plansPrefix: optionalString(
      getVar('OBSERVATORY_FILESTORE_PLANS_PREFIX') ?? 'datasets/observatory/calibrations/plans'
    ),
    bucket: optionalString(
      getVar('OBSERVATORY_FILESTORE_S3_BUCKET', ['FILESTORE_S3_BUCKET', 'APPHUB_BUNDLE_STORAGE_BUCKET'])
    ) ?? 'apphub-filestore',
    endpoint: optionalString(
      getVar('OBSERVATORY_FILESTORE_S3_ENDPOINT', ['FILESTORE_S3_ENDPOINT', 'APPHUB_BUNDLE_STORAGE_ENDPOINT'])
    ) ?? 'http://127.0.0.1:9000',
    region: optionalString(
      getVar('OBSERVATORY_FILESTORE_S3_REGION', ['FILESTORE_S3_REGION', 'APPHUB_BUNDLE_STORAGE_REGION'])
    ) ?? 'us-east-1',
    forcePathStyle: parseBoolean(
      getVar('OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE', ['FILESTORE_S3_FORCE_PATH_STYLE']),
      true
    ),
    accessKeyId: optionalString(
      getVar('OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID', ['FILESTORE_S3_ACCESS_KEY_ID', 'APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID'])
    ) ?? 'apphub',
    secretAccessKey: optionalString(
      getVar('OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY', ['FILESTORE_S3_SECRET_ACCESS_KEY', 'APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY'])
    ) ?? 'apphub123',
    sessionToken: optionalString(getVar('OBSERVATORY_FILESTORE_S3_SESSION_TOKEN', ['FILESTORE_S3_SESSION_TOKEN']))
  } as const;

  const derivedInboxDefault = path.join(dataRoot, filestore.inboxPrefix.split('/').join(path.sep));
  const paths = {
    inbox: resolvePathValue(repoRoot, getVar('OBSERVATORY_INBOX_PATH'), derivedInboxDefault, 'paths.inbox'),
    staging: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_STAGING_PATH'),
      path.join(dataRoot, filestore.stagingPrefix.split('/').join(path.sep)),
      'paths.staging'
    ),
    archive: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_ARCHIVE_PATH'),
      path.join(dataRoot, filestore.archivePrefix.split('/').join(path.sep)),
      'paths.archive'
    ),
    plots: resolvePathValue(repoRoot, getVar('OBSERVATORY_PLOTS_PATH'), path.join(dataRoot, 'plots'), 'paths.plots'),
    reports: resolvePathValue(repoRoot, getVar('OBSERVATORY_REPORTS_PATH'), path.join(dataRoot, 'reports'), 'paths.reports')
  } as const;

  const timestoreDriver = resolveTimestoreDriver(
    getVar('OBSERVATORY_TIMESTORE_STORAGE_DRIVER', ['TIMESTORE_STORAGE_DRIVER'])
  );
  const defaultTimestoreStorageRoot = path.join(dataRoot, 'timestore', 'storage');
  const defaultTimestoreCacheDir = path.join(dataRoot, 'timestore', 'cache');

  const storageRoot =
    timestoreDriver === 'local'
      ? resolvePathValue(
          repoRoot,
          getVar('OBSERVATORY_TIMESTORE_STORAGE_ROOT', ['TIMESTORE_STORAGE_ROOT']),
          defaultTimestoreStorageRoot,
          'timestore.storageRoot'
        )
      : resolveOptionalPath(repoRoot, getVar('OBSERVATORY_TIMESTORE_STORAGE_ROOT', ['TIMESTORE_STORAGE_ROOT']));

  const cacheDir =
    resolveOptionalPath(repoRoot, getVar('OBSERVATORY_TIMESTORE_CACHE_DIR', ['TIMESTORE_QUERY_CACHE_DIR'])) ??
    (timestoreDriver === 'local'
      ? resolvePathValue(
          repoRoot,
          getVar('OBSERVATORY_TIMESTORE_CACHE_DIR', ['TIMESTORE_QUERY_CACHE_DIR']),
          defaultTimestoreCacheDir,
          'timestore.cacheDir'
        )
      : undefined);

  const timestore = {
    baseUrl: resolveString(
      getVar('OBSERVATORY_TIMESTORE_BASE_URL'),
      'http://127.0.0.1:4200',
      'timestore.baseUrl'
    ),
    datasetSlug: resolveString(
      getVar('OBSERVATORY_TIMESTORE_DATASET_SLUG'),
      'observatory-timeseries',
      'timestore.datasetSlug'
    ),
    datasetName: optionalString(getVar('OBSERVATORY_TIMESTORE_DATASET_NAME') ?? 'Observatory Time Series'),
    tableName: optionalString(getVar('OBSERVATORY_TIMESTORE_TABLE_NAME') ?? 'observations'),
    storageTargetId: optionalString(getVar('OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID')),
    authToken: optionalString(getVar('OBSERVATORY_TIMESTORE_TOKEN')),
    storageDriver: timestoreDriver,
    storageRoot: storageRoot ?? undefined,
    cacheDir: cacheDir ?? undefined
  } as const;

  const config: EventDrivenObservatoryConfig = {
    paths,
    filestore,
    timestore,
    metastore: {
      baseUrl: optionalString(getVar('OBSERVATORY_METASTORE_BASE_URL') ?? 'http://127.0.0.1:4100'),
      namespace: optionalString(getVar('OBSERVATORY_METASTORE_NAMESPACE') ?? 'observatory.reports'),
      authToken: optionalString(getVar('OBSERVATORY_METASTORE_TOKEN'))
    },
    core: {
      baseUrl: optionalString(getVar('OBSERVATORY_CORE_BASE_URL') ?? 'http://127.0.0.1:4000'),
      apiToken: optionalString(getVar('OBSERVATORY_CORE_TOKEN') ?? 'dev-token')
    },
    workflows: {
      ingestSlug: resolveString(
        getVar('OBSERVATORY_INGEST_WORKFLOW_SLUG'),
        'observatory-minute-ingest',
        'workflows.ingestSlug'
      ),
      publicationSlug: resolveString(
        getVar('OBSERVATORY_PUBLICATION_WORKFLOW_SLUG'),
        'observatory-daily-publication',
        'workflows.publicationSlug'
      ),
      aggregateSlug: resolveString(
        getVar('OBSERVATORY_DASHBOARD_WORKFLOW_SLUG'),
        'observatory-dashboard-aggregate',
        'workflows.aggregateSlug'
      ),
      calibrationImportSlug: resolveString(
        getVar('OBSERVATORY_CALIBRATION_WORKFLOW_SLUG'),
        'observatory-calibration-import',
        'workflows.calibrationImportSlug'
      ),
      visualizationAssetId: resolveString(
        getVar('OBSERVATORY_VISUALIZATION_ASSET_ID'),
        'observatory.visualizations.minute',
        'workflows.visualizationAssetId'
      ),
      generator: {
        instrumentCount: optionalNumber(getVar('OBSERVATORY_GENERATOR_INSTRUMENT_COUNT'))
      },
      dashboard: {
        overviewPrefix: optionalString(getVar('OBSERVATORY_DASHBOARD_OVERVIEW_PREFIX')),
        lookbackMinutes: optionalNumber(getVar('OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES')) ?? 720,
        burstQuietMillis: optionalNumber(getVar('OBSERVATORY_DASHBOARD_BURST_QUIET_MS')) ?? 5_000,
        snapshotFreshnessMillis:
          optionalNumber(getVar('OBSERVATORY_DASHBOARD_SNAPSHOT_FRESHNESS_MS')) ?? 60_000
      }
    }
  };

  return { config, outputPath };
}
