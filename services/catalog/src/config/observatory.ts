import { getFilestoreRuntimeConfig, type FilestoreRuntimeConfig } from './filestore';
import { getMetastoreRuntimeConfig, type MetastoreRuntimeConfig } from './metastore';

export type ObservatoryCalibrationConfig = {
  filestore: {
    backendId: number;
    calibrationsPrefix: string;
    plansPrefix: string;
    importPrincipal: string | null;
    reprocessPrincipal: string | null;
    runtime: FilestoreRuntimeConfig;
  };
  metastore: {
    calibrationNamespace: string;
    planNamespace: string;
    runtime: MetastoreRuntimeConfig;
  };
  workflows: {
    calibrationImportSlug: string;
    reprocessSlug: string;
    ingestSlug: string | null;
  };
  catalog: {
    baseUrl: string;
    apiToken: string | null;
  };
  defaults: {
    maxConcurrency: number;
    pollIntervalMs: number;
  };
};

let cachedConfig: ObservatoryCalibrationConfig | null = null;

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(/^\/+/, '').replace(/\/+$/g, '');
}

function sanitizePrincipal(value: string | undefined, fallback: string | null): string | null {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? fallback : trimmed;
}

function parseInteger(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.search = '';
    if (url.pathname && url.pathname.endsWith('/') && url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }
    return url.toString();
  } catch {
    return null;
  }
}

function resolveCatalogBaseUrl(): string {
  const candidates = [
    process.env.OBSERVATORY_CATALOG_BASE_URL,
    process.env.CATALOG_PUBLIC_BASE_URL,
    process.env.CATALOG_BASE_URL,
    process.env.APPHUB_CATALOG_BASE_URL
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate ?? null);
    if (normalized) {
      return normalized;
    }
  }

  return 'http://127.0.0.1:4000';
}

function resolveCatalogApiToken(): string | null {
  const candidates = [
    process.env.OBSERVATORY_CATALOG_API_TOKEN,
    process.env.CATALOG_API_TOKEN,
    process.env.APPHUB_CATALOG_API_TOKEN
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

export async function getObservatoryCalibrationConfig(): Promise<ObservatoryCalibrationConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const filestoreRuntime = await getFilestoreRuntimeConfig();
  const metastoreRuntime = await getMetastoreRuntimeConfig();

  const backendId =
    parseInteger(process.env.OBSERVATORY_FILESTORE_BACKEND_ID)
    ?? parseInteger(process.env.CATALOG_OBSERVATORY_FILESTORE_BACKEND_ID)
    ?? parseInteger(process.env.FILESTORE_BACKEND_ID);

  if (!backendId) {
    throw new Error(
      'Observatory filestore backend id is not configured. Set OBSERVATORY_FILESTORE_BACKEND_ID.'
    );
  }

  const rawCalibrationsPrefix =
    process.env.OBSERVATORY_CALIBRATIONS_PREFIX ?? 'datasets/observatory/calibrations';
  const calibrationsPrefix = normalizePathPrefix(rawCalibrationsPrefix) || 'datasets/observatory/calibrations';

  const rawPlansPrefix = process.env.OBSERVATORY_CALIBRATION_PLANS_PREFIX ?? `${calibrationsPrefix}/plans`;
  const plansPrefix = normalizePathPrefix(rawPlansPrefix) || `${calibrationsPrefix}/plans`;

  const calibrationNamespace =
    (process.env.OBSERVATORY_CALIBRATION_NAMESPACE ?? 'observatory.calibrations').trim() || 'observatory.calibrations';
  const planNamespace =
    (process.env.OBSERVATORY_CALIBRATION_PLAN_NAMESPACE ?? 'observatory.reprocess.plans').trim() || 'observatory.reprocess.plans';

  const importPrincipal = sanitizePrincipal(
    process.env.OBSERVATORY_CALIBRATION_IMPORT_PRINCIPAL,
    'observatory-calibration-importer'
  );
  const reprocessPrincipal = sanitizePrincipal(
    process.env.OBSERVATORY_CALIBRATION_REPROCESS_PRINCIPAL,
    'observatory-calibration-reprocessor'
  );

  const calibrationImportSlug =
    (process.env.OBSERVATORY_CALIBRATION_IMPORT_WORKFLOW_SLUG ?? 'observatory-calibration-import').trim()
      || 'observatory-calibration-import';
  const reprocessSlug =
    (process.env.OBSERVATORY_CALIBRATION_REPROCESS_WORKFLOW_SLUG ?? 'observatory-calibration-reprocess').trim()
      || 'observatory-calibration-reprocess';
  const ingestSlugRaw = process.env.OBSERVATORY_INGEST_WORKFLOW_SLUG ?? null;
  const ingestSlug = ingestSlugRaw && ingestSlugRaw.trim().length > 0 ? ingestSlugRaw.trim() : null;

  const maxConcurrencyDefault = parseInteger(process.env.OBSERVATORY_REPROCESS_MAX_CONCURRENCY_DEFAULT) ?? 3;
  const pollIntervalDefault = parseInteger(process.env.OBSERVATORY_REPROCESS_POLL_INTERVAL_MS_DEFAULT) ?? 1500;

  const catalogBaseUrl = resolveCatalogBaseUrl();
  const catalogApiToken = resolveCatalogApiToken();

  cachedConfig = {
    filestore: {
      backendId,
      calibrationsPrefix,
      plansPrefix,
      importPrincipal,
      reprocessPrincipal,
      runtime: filestoreRuntime
    },
    metastore: {
      calibrationNamespace,
      planNamespace,
      runtime: metastoreRuntime
    },
    workflows: {
      calibrationImportSlug,
      reprocessSlug,
      ingestSlug
    },
    catalog: {
      baseUrl: catalogBaseUrl,
      apiToken: catalogApiToken
    },
    defaults: {
      maxConcurrency: Math.max(1, Math.min(maxConcurrencyDefault, 10)),
      pollIntervalMs: Math.max(250, Math.min(pollIntervalDefault, 10_000))
    }
  } satisfies ObservatoryCalibrationConfig;

  return cachedConfig;
}

export function clearObservatoryCalibrationConfigCache(): void {
  cachedConfig = null;
}
