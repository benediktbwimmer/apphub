export function buildResourceName(prefix: string, identifier: string, fallback: string): string {
  const normalized = identifier.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const base = normalized || fallback;
  const maxLength = 63;
  const maxSuffixLength = Math.max(maxLength - prefix.length - 1, 8);
  const suffix = base.length > maxSuffixLength ? base.slice(-maxSuffixLength) : base;
  return `${prefix}-${suffix}`.slice(0, maxLength);
}
