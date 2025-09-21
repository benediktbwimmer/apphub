const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseSlugList(value: string | undefined): Set<string> {
  if (!value) {
    return new Set();
  }
  const entries = value
    .split(',')
    .map((slug) => slug.trim().toLowerCase())
    .filter((slug) => slug.length > 0);
  return new Set(entries);
}

const globalBundlesEnabled = parseBoolean(process.env.APPHUB_JOB_BUNDLES_ENABLED);
const enabledSlugSet = parseSlugList(process.env.APPHUB_JOB_BUNDLES_ENABLE_SLUGS);
const disabledSlugSet = parseSlugList(process.env.APPHUB_JOB_BUNDLES_DISABLE_SLUGS);

const globalFallbackDisabled = parseBoolean(process.env.APPHUB_JOB_BUNDLES_DISABLE_FALLBACK);
const fallbackDisabledSlugSet = parseSlugList(process.env.APPHUB_JOB_BUNDLES_DISABLE_FALLBACK_SLUGS);

export function shouldUseJobBundle(slug: string | null | undefined): boolean {
  if (!slug) {
    return false;
  }
  const normalized = slug.toLowerCase();
  if (disabledSlugSet.has(normalized)) {
    return false;
  }
  if (enabledSlugSet.has(normalized)) {
    return true;
  }
  return globalBundlesEnabled;
}

export function shouldAllowLegacyFallback(slug: string | null | undefined): boolean {
  if (!slug) {
    return true;
  }
  const normalized = slug.toLowerCase();
  if (fallbackDisabledSlugSet.has(normalized)) {
    return false;
  }
  return !globalFallbackDisabled;
}

