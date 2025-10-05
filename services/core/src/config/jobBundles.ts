import { z } from 'zod';
import { booleanVar, loadEnvConfig, stringSetVar } from '@apphub/shared/envConfig';

export type JobBundleConfig = {
  enabled: boolean;
  enabledSlugs: ReadonlySet<string>;
  disabledSlugs: ReadonlySet<string>;
  fallbackDisabled: boolean;
  fallbackDisabledSlugs: ReadonlySet<string>;
};

let cachedConfig: JobBundleConfig | null = null;

const jobBundleEnvSchema = z
  .object({
    APPHUB_JOB_BUNDLES_ENABLED: booleanVar({ defaultValue: false }),
    APPHUB_JOB_BUNDLES_ENABLE_SLUGS: stringSetVar({ lowercase: true, unique: true }),
    APPHUB_JOB_BUNDLES_DISABLE_SLUGS: stringSetVar({ lowercase: true, unique: true }),
    APPHUB_JOB_BUNDLES_DISABLE_FALLBACK: booleanVar({ defaultValue: false }),
    APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS: stringSetVar({ lowercase: true, unique: true })
  })
  .passthrough()
  .transform((env) => {
    return {
      enabled: env.APPHUB_JOB_BUNDLES_ENABLED ?? false,
      enabledSlugs: env.APPHUB_JOB_BUNDLES_ENABLE_SLUGS ?? new Set<string>(),
      disabledSlugs: env.APPHUB_JOB_BUNDLES_DISABLE_SLUGS ?? new Set<string>(),
      fallbackDisabled: env.APPHUB_JOB_BUNDLES_DISABLE_FALLBACK ?? false,
      fallbackDisabledSlugs: env.APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS ?? new Set<string>()
    } satisfies JobBundleConfig;
  });

function getJobBundleConfig(): JobBundleConfig {
  if (!cachedConfig) {
    cachedConfig = loadEnvConfig(jobBundleEnvSchema, { context: 'core:job-bundles' });
  }
  return cachedConfig;
}

export function shouldUseJobBundle(slug: string | null | undefined): boolean {
  if (!slug) {
    return false;
  }
  const config = getJobBundleConfig();
  const normalized = slug.toLowerCase();
  if (config.disabledSlugs.has(normalized)) {
    return false;
  }
  if (config.enabledSlugs.has(normalized)) {
    return true;
  }
  return config.enabled;
}

export function shouldAllowLegacyFallback(slug: string | null | undefined): boolean {
  if (!slug) {
    return true;
  }
  const config = getJobBundleConfig();
  const normalized = slug.toLowerCase();
  if (config.fallbackDisabledSlugs.has(normalized)) {
    return false;
  }
  return !config.fallbackDisabled;
}

export function resetJobBundleConfigCache(): void {
  cachedConfig = null;
}
