const DEFAULT_HOST = process.env.APPHUB_E2E_HOST ?? '127.0.0.1';

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function parseBaseUrl(envName: string, host: string, port: number): string {
  const override = process.env[envName];
  if (override && override.trim()) {
    return override.trim();
  }
  return `http://${host}:${port}`;
}

export const CORE_PORT = parsePort(process.env.APPHUB_E2E_CORE_PORT, 4400);
export const METASTORE_PORT = parsePort(process.env.APPHUB_E2E_METASTORE_PORT, 4410);
export const TIMESTORE_PORT = parsePort(process.env.APPHUB_E2E_TIMESTORE_PORT, 4420);
export const FILESTORE_PORT = parsePort(process.env.APPHUB_E2E_FILESTORE_PORT, 4430);
export const MINIO_PORT = parsePort(process.env.APPHUB_E2E_MINIO_PORT, 9400);

export const CORE_BASE_URL = parseBaseUrl('APPHUB_E2E_CORE_BASE_URL', DEFAULT_HOST, CORE_PORT);
export const METASTORE_BASE_URL = parseBaseUrl('APPHUB_E2E_METASTORE_BASE_URL', DEFAULT_HOST, METASTORE_PORT);
export const TIMESTORE_BASE_URL = parseBaseUrl('APPHUB_E2E_TIMESTORE_BASE_URL', DEFAULT_HOST, TIMESTORE_PORT);
export const FILESTORE_BASE_URL = parseBaseUrl('APPHUB_E2E_FILESTORE_BASE_URL', DEFAULT_HOST, FILESTORE_PORT);
export const MINIO_ENDPOINT =
  process.env.APPHUB_E2E_MINIO_ENDPOINT?.trim() || `http://${DEFAULT_HOST}:${MINIO_PORT}`;
const MINIO_INTERNAL_ENDPOINT =
  process.env.APPHUB_E2E_MINIO_INTERNAL_ENDPOINT?.trim() || 'http://minio:9000';

export const OBSERVATORY_OPERATOR_TOKEN =
  process.env.APPHUB_E2E_OPERATOR_TOKEN?.trim() || 'apphub-e2e-operator';

type EnvSnapshot = Map<string, string | undefined>;

function captureEnv(keys: string[]): EnvSnapshot {
  const snapshot: EnvSnapshot = new Map();
  for (const key of keys) {
    snapshot.set(key, process.env[key]);
  }
  return snapshot;
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of snapshot.entries()) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
}

const OBSERVATORY_ENV_KEYS = [
  'OBSERVATORY_CORE_BASE_URL',
  'OBSERVATORY_CORE_TOKEN',
  'OBSERVATORY_FILESTORE_BASE_URL',
  'OBSERVATORY_FILESTORE_S3_ENDPOINT',
  'OBSERVATORY_TIMESTORE_BASE_URL',
  'OBSERVATORY_TIMESTORE_DATASET_SLUG',
  'OBSERVATORY_TIMESTORE_DATASET_NAME',
  'OBSERVATORY_TIMESTORE_TABLE_NAME'
];

const APPHUB_CLIENT_ENV_KEYS = [
  'APPHUB_FILESTORE_BASE_URL',
  'APPHUB_METASTORE_BASE_URL',
  'APPHUB_TIMESTORE_BASE_URL',
  'APPHUB_BUNDLE_STORAGE_ENDPOINT',
  'APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID',
  'APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY',
  'APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE'
];

const S3_ENV_KEYS = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'];

const ALL_OVERRIDES = new Set<string>([
  ...OBSERVATORY_ENV_KEYS,
  ...APPHUB_CLIENT_ENV_KEYS,
  ...S3_ENV_KEYS
]);

export function configureE2EEnvironment(): () => void {
  const snapshot = captureEnv(Array.from(ALL_OVERRIDES));

  process.env.OBSERVATORY_CORE_BASE_URL = CORE_BASE_URL;
  process.env.OBSERVATORY_CORE_TOKEN = OBSERVATORY_OPERATOR_TOKEN;
  process.env.OBSERVATORY_FILESTORE_BASE_URL = FILESTORE_BASE_URL;
  process.env.OBSERVATORY_FILESTORE_S3_ENDPOINT =
    process.env.OBSERVATORY_FILESTORE_S3_ENDPOINT ?? MINIO_INTERNAL_ENDPOINT;
  process.env.OBSERVATORY_TIMESTORE_BASE_URL = TIMESTORE_BASE_URL;
  process.env.OBSERVATORY_TIMESTORE_DATASET_SLUG =
    process.env.OBSERVATORY_TIMESTORE_DATASET_SLUG ?? 'observatory-timeseries';
  process.env.OBSERVATORY_TIMESTORE_DATASET_NAME =
    process.env.OBSERVATORY_TIMESTORE_DATASET_NAME ?? 'Observatory Time Series';
  process.env.OBSERVATORY_TIMESTORE_TABLE_NAME =
    process.env.OBSERVATORY_TIMESTORE_TABLE_NAME ?? 'observations';

  process.env.APPHUB_FILESTORE_BASE_URL = FILESTORE_BASE_URL;
  process.env.APPHUB_METASTORE_BASE_URL = METASTORE_BASE_URL;
  process.env.APPHUB_TIMESTORE_BASE_URL = TIMESTORE_BASE_URL;
  process.env.APPHUB_BUNDLE_STORAGE_ENDPOINT = MINIO_ENDPOINT;
  process.env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID =
    process.env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? 'apphub';
  process.env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY =
    process.env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? 'apphub123';
  process.env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE = 'true';

  process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? 'apphub';
  process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? 'apphub123';
  process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

  return () => restoreEnv(snapshot);
}
