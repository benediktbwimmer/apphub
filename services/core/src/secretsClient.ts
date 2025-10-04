import { SecretsClient } from '@apphub/shared';

let client: SecretsClient | null = null;

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveBaseUrl(): string {
  return (
    process.env.SECRETS_SERVICE_URL ??
    process.env.APPHUB_SECRETS_URL ??
    'http://127.0.0.1:4010'
  ).trim();
}

function resolveAdminToken(): string {
  return (
    process.env.SECRETS_SERVICE_ADMIN_TOKEN ?? process.env.APPHUB_SECRETS_ADMIN_TOKEN ?? ''
  ).trim();
}

export function shouldUseManagedSecrets(): boolean {
  const mode = (process.env.APPHUB_SECRETS_MODE ?? 'managed').trim().toLowerCase();
  if (mode === 'inline') {
    return false;
  }
  const token = resolveAdminToken();
  if (!token) {
    return false;
  }
  const baseUrl = resolveBaseUrl();
  return baseUrl.length > 0;
}

export function getSecretsClient(): SecretsClient {
  if (!client) {
    const baseUrl = resolveBaseUrl();
    const adminToken = resolveAdminToken();
    if (!adminToken) {
      throw new Error('SECRETS_SERVICE_ADMIN_TOKEN is not configured');
    }
    client = new SecretsClient({
      baseUrl,
      adminToken,
      subject: process.env.APPHUB_SECRETS_SUBJECT ?? 'apphub.core',
      tokenTtlSeconds: parseNumber(process.env.APPHUB_SECRETS_TOKEN_TTL, 300),
      cacheTtlMs: parseNumber(process.env.APPHUB_SECRETS_CACHE_TTL_MS, 5_000),
      logger: {
        warn(message, meta) {
          console.warn('[secrets-client]', message, meta);
        },
        error(message, meta) {
          console.error('[secrets-client]', message, meta);
        }
      }
    });
  }
  return client;
}

export function resetSecretsClient(): void {
  client = null;
}
