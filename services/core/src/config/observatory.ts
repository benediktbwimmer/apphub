import { z } from 'zod';
import {
  integerVar,
  loadEnvConfig,
  stringVar
} from '@apphub/shared/envConfig';
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
  core: {
    baseUrl: string;
    apiToken: string | null;
  };
  defaults: {
    maxConcurrency: number;
    pollIntervalMs: number;
  };
};

let cachedConfig: ObservatoryCalibrationConfig | null = null;

function normalizePathPrefix(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
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

const observatoryEnvSchema = z
  .object({
    OBSERVATORY_FILESTORE_BACKEND_ID: integerVar({ min: 1 }),
    CORE_OBSERVATORY_FILESTORE_BACKEND_ID: integerVar({ min: 1 }),
    FILESTORE_BACKEND_ID: integerVar({ min: 1 }),
    OBSERVATORY_CALIBRATIONS_PREFIX: stringVar({ defaultValue: 'datasets/observatory/calibrations' }),
    OBSERVATORY_CALIBRATION_PLANS_PREFIX: stringVar({ allowEmpty: false }),
    OBSERVATORY_CALIBRATION_NAMESPACE: stringVar({ defaultValue: 'observatory.calibrations' }),
    OBSERVATORY_CALIBRATION_PLAN_NAMESPACE: stringVar({ defaultValue: 'observatory.reprocess.plans' }),
    OBSERVATORY_CALIBRATION_IMPORT_PRINCIPAL: stringVar({ defaultValue: 'observatory-calibration-importer' }),
    OBSERVATORY_CALIBRATION_REPROCESS_PRINCIPAL: stringVar({ defaultValue: 'observatory-calibration-reprocessor' }),
    OBSERVATORY_CALIBRATION_IMPORT_WORKFLOW_SLUG: stringVar({ defaultValue: 'observatory-calibration-import' }),
    OBSERVATORY_CALIBRATION_REPROCESS_WORKFLOW_SLUG: stringVar({ defaultValue: 'observatory-calibration-reprocess' }),
    OBSERVATORY_INGEST_WORKFLOW_SLUG: stringVar({ allowEmpty: false }),
    OBSERVATORY_REPROCESS_MAX_CONCURRENCY_DEFAULT: integerVar({ min: 1, defaultValue: 3 }),
    OBSERVATORY_REPROCESS_POLL_INTERVAL_MS_DEFAULT: integerVar({ min: 1, defaultValue: 1500 }),
    OBSERVATORY_CORE_BASE_URL: stringVar({ allowEmpty: false }),
    CORE_PUBLIC_BASE_URL: stringVar({ allowEmpty: false }),
    CORE_BASE_URL: stringVar({ allowEmpty: false }),
    APPHUB_CORE_BASE_URL: stringVar({ allowEmpty: false }),
    OBSERVATORY_CORE_API_TOKEN: stringVar({ allowEmpty: false }),
    CORE_API_TOKEN: stringVar({ allowEmpty: false }),
    APPHUB_CORE_API_TOKEN: stringVar({ allowEmpty: false })
  })
  .passthrough();

type ObservatoryEnv = z.infer<typeof observatoryEnvSchema>;

function loadObservatoryEnv(): ObservatoryEnv {
  return loadEnvConfig(observatoryEnvSchema as unknown as z.ZodType<ObservatoryEnv>, {
    context: 'core:observatory'
  });
}

function resolveCoreBaseUrl(env: ObservatoryEnv): string {
  const candidates = [
    env.OBSERVATORY_CORE_BASE_URL,
    env.CORE_PUBLIC_BASE_URL,
    env.CORE_BASE_URL,
    env.APPHUB_CORE_BASE_URL
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate ?? null);
    if (normalized) {
      return normalized;
    }
  }

  return 'http://127.0.0.1:4000';
}

function resolveCoreApiToken(env: ObservatoryEnv): string | null {
  const candidates = [
    env.OBSERVATORY_CORE_API_TOKEN,
    env.CORE_API_TOKEN,
    env.APPHUB_CORE_API_TOKEN
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

  const env = loadObservatoryEnv();
  const filestoreRuntime = await getFilestoreRuntimeConfig();
  const metastoreRuntime = await getMetastoreRuntimeConfig();

  const backendId =
    env.OBSERVATORY_FILESTORE_BACKEND_ID ??
    env.CORE_OBSERVATORY_FILESTORE_BACKEND_ID ??
    env.FILESTORE_BACKEND_ID;

  if (!backendId) {
    throw new Error(
      'Observatory filestore backend id is not configured. Set OBSERVATORY_FILESTORE_BACKEND_ID.'
    );
  }

  const rawCalibrationsPrefix = env.OBSERVATORY_CALIBRATIONS_PREFIX;
  const calibrationsPrefix = normalizePathPrefix(rawCalibrationsPrefix) || 'datasets/observatory/calibrations';

  const rawPlansPrefix = env.OBSERVATORY_CALIBRATION_PLANS_PREFIX ?? `${calibrationsPrefix}/plans`;
  const plansPrefix = normalizePathPrefix(rawPlansPrefix) || `${calibrationsPrefix}/plans`;

  const calibrationNamespace =
    env.OBSERVATORY_CALIBRATION_NAMESPACE?.trim() || 'observatory.calibrations';
  const planNamespace =
    env.OBSERVATORY_CALIBRATION_PLAN_NAMESPACE?.trim() || 'observatory.reprocess.plans';

  const importPrincipal = sanitizePrincipal(
    env.OBSERVATORY_CALIBRATION_IMPORT_PRINCIPAL,
    'observatory-calibration-importer'
  );
  const reprocessPrincipal = sanitizePrincipal(
    env.OBSERVATORY_CALIBRATION_REPROCESS_PRINCIPAL,
    'observatory-calibration-reprocessor'
  );

  const calibrationImportSlug =
    env.OBSERVATORY_CALIBRATION_IMPORT_WORKFLOW_SLUG?.trim() || 'observatory-calibration-import';
  const reprocessSlug =
    env.OBSERVATORY_CALIBRATION_REPROCESS_WORKFLOW_SLUG?.trim() || 'observatory-calibration-reprocess';
  const ingestSlugRaw = env.OBSERVATORY_INGEST_WORKFLOW_SLUG ?? null;
  const ingestSlug = ingestSlugRaw && ingestSlugRaw.trim().length > 0 ? ingestSlugRaw.trim() : null;

  const maxConcurrencyDefault = env.OBSERVATORY_REPROCESS_MAX_CONCURRENCY_DEFAULT ?? 3;
  const pollIntervalDefault = env.OBSERVATORY_REPROCESS_POLL_INTERVAL_MS_DEFAULT ?? 1500;

  const coreBaseUrl = resolveCoreBaseUrl(env);
  const coreApiToken = resolveCoreApiToken(env);

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
    core: {
      baseUrl: coreBaseUrl,
      apiToken: coreApiToken
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
