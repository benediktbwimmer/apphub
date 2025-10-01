import type { BundleBinding } from './bundleRecovery';

const BUNDLE_ENTRY_REGEX = /^bundle:([a-z0-9][a-z0-9._-]*)@([^#]+?)(?:#([a-zA-Z_$][\w$]*))?$/i;

export function parseBundleEntryPoint(entryPoint: string | null | undefined): BundleBinding | null {
  if (!entryPoint || typeof entryPoint !== 'string') {
    return null;
  }
  const trimmed = entryPoint.trim();
  const matches = BUNDLE_ENTRY_REGEX.exec(trimmed);
  if (!matches) {
    return null;
  }
  const [, rawSlug, rawVersion, rawExport] = matches;
  const slug = rawSlug.toLowerCase();
  const version = rawVersion.trim();
  if (!version) {
    return null;
  }
  return {
    slug,
    version,
    exportName: rawExport ?? null
  } satisfies BundleBinding;
}
