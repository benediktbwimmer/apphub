const DEFAULT_HOST = process.env.APPHUB_E2E_HOST?.trim() || '127.0.0.1';

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildBaseUrl(envName: string, host: string, port: number): string {
  const override = process.env[envName]?.trim();
  if (override) {
    return override.replace(/\/+$/, '');
  }
  return `http://${host}:${port}`;
}

export const CORE_PORT = parsePort(process.env.APPHUB_E2E_CORE_PORT, 4400);
export const METASTORE_PORT = parsePort(process.env.APPHUB_E2E_METASTORE_PORT, 4410);
export const TIMESTORE_PORT = parsePort(process.env.APPHUB_E2E_TIMESTORE_PORT, 4420);
export const FILESTORE_PORT = parsePort(process.env.APPHUB_E2E_FILESTORE_PORT, 4430);
export const MINIO_PORT = parsePort(process.env.APPHUB_E2E_MINIO_PORT, 9400);

export const CORE_BASE_URL = buildBaseUrl('APPHUB_E2E_CORE_BASE_URL', DEFAULT_HOST, CORE_PORT);
export const METASTORE_BASE_URL = buildBaseUrl('APPHUB_E2E_METASTORE_BASE_URL', DEFAULT_HOST, METASTORE_PORT);
export const TIMESTORE_BASE_URL = buildBaseUrl('APPHUB_E2E_TIMESTORE_BASE_URL', DEFAULT_HOST, TIMESTORE_PORT);
export const FILESTORE_BASE_URL = buildBaseUrl('APPHUB_E2E_FILESTORE_BASE_URL', DEFAULT_HOST, FILESTORE_PORT);
export const MINIO_BASE_URL = buildBaseUrl('APPHUB_E2E_MINIO_BASE_URL', DEFAULT_HOST, MINIO_PORT);

export const OPERATOR_TOKEN = process.env.APPHUB_E2E_OPERATOR_TOKEN?.trim() || 'apphub-e2e-operator';
