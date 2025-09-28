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
    backendMountId: number;
    token?: string;
    inboxPrefix: string;
    stagingPrefix: string;
    archivePrefix: string;
  };
  timestore: {
    baseUrl: string;
    datasetSlug: string;
    datasetName?: string;
    tableName?: string;
    storageTargetId?: string;
    authToken?: string;
  };
  metastore?: {
    baseUrl?: string;
    namespace?: string;
    authToken?: string;
  };
  catalog?: {
    baseUrl?: string;
    apiToken?: string;
  };
  workflows: {
    ingestSlug: string;
    publicationSlug: string;
    visualizationAssetId: string;
  };
};

export type EventDrivenObservatoryConfigOptions = {
  repoRoot: string;
  variables?: Record<string, string | undefined> | null;
  outputPath?: string;
};

function coerceNumber(value: string | undefined, fallback: number, key: string): number {
  if (value === undefined || value === null || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric value for ${key}, received '${value}'`);
  }
  return parsed;
}

function optionalString(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function resolvePathValue(repoRoot: string, value: string | undefined, fallback: string, key: string): string {
  const candidate = optionalString(value) ?? fallback;
  if (!candidate) {
    throw new Error(`Missing required configuration for ${key}`);
  }
  return path.isAbsolute(candidate) ? candidate : path.resolve(repoRoot, candidate);
}

function resolveString(value: string | undefined, fallback: string | undefined, key: string): string {
  const candidate = optionalString(value) ?? fallback;
  if (!candidate) {
    throw new Error(`Missing required configuration for ${key}`);
  }
  return candidate;
}

export function createEventDrivenObservatoryConfig(
  options: EventDrivenObservatoryConfigOptions
): { config: ObservatoryConfig; outputPath: string } {
  const repoRoot = path.resolve(options.repoRoot);
  const vars = options.variables ?? {};

  const getVar = (name: string): string | undefined => {
    const raw = vars[name];
    return raw === undefined ? undefined : raw;
  };

  const exampleRoot = path.resolve(repoRoot, 'examples', 'environmental-observatory-event-driven');
  const defaultDataDir = path.join(exampleRoot, 'data');

  const resolvedOutput = options.outputPath ?? getVar('OBSERVATORY_CONFIG_OUTPUT');
  const outputPath = path.resolve(
    resolvedOutput && resolvedOutput.trim().length > 0
      ? resolvedOutput
      : path.join(exampleRoot, '.generated', 'observatory-config.json')
  );

  const dataRoot = resolvePathValue(
    repoRoot,
    getVar('OBSERVATORY_DATA_ROOT'),
    defaultDataDir,
    'paths.dataRoot'
  );

  const filestore = {
    baseUrl: resolveString(
      getVar('OBSERVATORY_FILESTORE_BASE_URL'),
      'http://127.0.0.1:4300',
      'filestore.baseUrl'
    ),
      backendMountId: coerceNumber(
        getVar('OBSERVATORY_FILESTORE_BACKEND_ID'),
        1,
        'filestore.backendMountId'
      ),
      token: optionalString(getVar('OBSERVATORY_FILESTORE_TOKEN')),
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
      )
    } as const;

  const derivedInboxDefault = path.join(
    dataRoot,
    filestore.inboxPrefix.split('/').join(path.sep)
  );

  const paths = {
    inbox: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_INBOX_PATH'),
      derivedInboxDefault,
      'paths.inbox'
    ),
    staging: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_STAGING_PATH'),
      path.join(
        dataRoot,
        filestore.stagingPrefix.split('/').join(path.sep)
      ),
      'paths.staging'
    ),
    archive: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_ARCHIVE_PATH'),
      path.join(
        dataRoot,
        filestore.archivePrefix.split('/').join(path.sep)
      ),
      'paths.archive'
    ),
    plots: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_PLOTS_PATH'),
      path.join(dataRoot, 'plots'),
      'paths.plots'
    ),
    reports: resolvePathValue(
      repoRoot,
      getVar('OBSERVATORY_REPORTS_PATH'),
      path.join(dataRoot, 'reports'),
      'paths.reports'
    )
  } as const;

  const config: ObservatoryConfig = {
    paths,
    filestore,
    timestore: {
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
      datasetName: optionalString(
        getVar('OBSERVATORY_TIMESTORE_DATASET_NAME') ?? 'Observatory Time Series'
      ),
      tableName: optionalString(getVar('OBSERVATORY_TIMESTORE_TABLE_NAME') ?? 'observations'),
      storageTargetId: optionalString(getVar('OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID')),
      authToken: optionalString(getVar('OBSERVATORY_TIMESTORE_TOKEN'))
    },
    metastore: {
      baseUrl: optionalString(getVar('OBSERVATORY_METASTORE_BASE_URL') ?? 'http://127.0.0.1:4100'),
      namespace: optionalString(getVar('OBSERVATORY_METASTORE_NAMESPACE') ?? 'observatory.reports'),
      authToken: optionalString(getVar('OBSERVATORY_METASTORE_TOKEN'))
    },
    catalog: {
      baseUrl: optionalString(getVar('OBSERVATORY_CATALOG_BASE_URL') ?? 'http://127.0.0.1:4000'),
      apiToken: optionalString(getVar('OBSERVATORY_CATALOG_TOKEN') ?? 'dev-token')
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
      visualizationAssetId: resolveString(
        getVar('OBSERVATORY_VISUALIZATION_ASSET_ID'),
        'observatory.visualizations.minute',
        'workflows.visualizationAssetId'
      )
    }
  } satisfies ObservatoryConfig;

  return { config, outputPath };
}
