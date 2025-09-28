export function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[build] ${message}${payload}`);
}

export function sanitizeImageName(source: string): string {
  const normalized = source.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'app';
}

export function buildImageTag(repositoryId: string, commitSha: string | null): string {
  const name = sanitizeImageName(repositoryId);
  const suffix = commitSha ? commitSha.slice(0, 12) : Date.now().toString(36);
  return `apphub/${name}:${suffix}`;
}
