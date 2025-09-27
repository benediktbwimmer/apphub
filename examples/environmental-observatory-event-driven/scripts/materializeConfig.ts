import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const exampleRoot = path.resolve(__dirname, '..');
const defaultDataDir = path.join(exampleRoot, 'data');
const outputPath = path.resolve(
  process.env.OBSERVATORY_CONFIG_OUTPUT ?? path.join(exampleRoot, '.generated', 'observatory-config.json')
);

function coerceNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric value, received '${value}'`);
  }
  return parsed;
}

function ensureString(value: string | undefined, fallback: string | undefined, key: string): string {
  const candidate = value ?? fallback;
  if (candidate === undefined) {
    throw new Error(`Missing required configuration for ${key}`);
  }
  return candidate;
}

async function main(): Promise<void> {
  const config = {
    paths: {
      inbox: ensureString(
        process.env.OBSERVATORY_INBOX_PATH,
        path.join(defaultDataDir, 'inbox'),
        'paths.inbox'
      ),
      staging: ensureString(
        process.env.OBSERVATORY_STAGING_PATH,
        path.join(defaultDataDir, 'staging'),
        'paths.staging'
      ),
      archive: ensureString(
        process.env.OBSERVATORY_ARCHIVE_PATH,
        path.join(defaultDataDir, 'archive'),
        'paths.archive'
      ),
      plots: ensureString(
        process.env.OBSERVATORY_PLOTS_PATH,
        path.join(defaultDataDir, 'plots'),
        'paths.plots'
      ),
      reports: ensureString(
        process.env.OBSERVATORY_REPORTS_PATH,
        path.join(defaultDataDir, 'reports'),
        'paths.reports'
      )
    },
    filestore: {
      baseUrl: ensureString(
        process.env.OBSERVATORY_FILESTORE_BASE_URL,
        'http://127.0.0.1:4200',
        'filestore.baseUrl'
      ),
      backendMountId: coerceNumber(process.env.OBSERVATORY_FILESTORE_BACKEND_ID, 1),
      token: process.env.OBSERVATORY_FILESTORE_TOKEN,
      inboxPrefix: ensureString(
        process.env.OBSERVATORY_FILESTORE_INBOX_PREFIX,
        'inbox',
        'filestore.inboxPrefix'
      ),
      stagingPrefix: ensureString(
        process.env.OBSERVATORY_FILESTORE_STAGING_PREFIX,
        'staging',
        'filestore.stagingPrefix'
      ),
      archivePrefix: ensureString(
        process.env.OBSERVATORY_FILESTORE_ARCHIVE_PREFIX,
        'archive',
        'filestore.archivePrefix'
      )
    },
    timestore: {
      baseUrl: ensureString(
        process.env.OBSERVATORY_TIMESTORE_BASE_URL,
        'http://127.0.0.1:4100',
        'timestore.baseUrl'
      ),
      datasetSlug: ensureString(
        process.env.OBSERVATORY_TIMESTORE_DATASET_SLUG,
        'observatory-timeseries',
        'timestore.datasetSlug'
      ),
      datasetName: process.env.OBSERVATORY_TIMESTORE_DATASET_NAME ?? 'Observatory Time Series',
      tableName: process.env.OBSERVATORY_TIMESTORE_TABLE_NAME ?? 'observations',
      storageTargetId: process.env.OBSERVATORY_TIMESTORE_STORAGE_TARGET_ID,
      authToken: process.env.OBSERVATORY_TIMESTORE_TOKEN
    },
    metastore: {
      baseUrl: process.env.OBSERVATORY_METASTORE_BASE_URL ?? 'http://127.0.0.1:4100',
      namespace: process.env.OBSERVATORY_METASTORE_NAMESPACE ?? 'observatory.reports',
      authToken: process.env.OBSERVATORY_METASTORE_TOKEN
    },
    catalog: {
      baseUrl: process.env.OBSERVATORY_CATALOG_BASE_URL ?? 'http://127.0.0.1:4000',
      apiToken: process.env.OBSERVATORY_CATALOG_TOKEN ?? 'dev-token'
    },
    workflows: {
      ingestSlug: process.env.OBSERVATORY_INGEST_WORKFLOW_SLUG ?? 'observatory-minute-ingest',
      publicationSlug:
        process.env.OBSERVATORY_PUBLICATION_WORKFLOW_SLUG ?? 'observatory-daily-publication',
      visualizationAssetId:
        process.env.OBSERVATORY_VISUALIZATION_ASSET_ID ?? 'observatory.visualizations.minute'
    }
  } as const;

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`Observatory config written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
