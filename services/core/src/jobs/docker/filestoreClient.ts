import { FilestoreClient } from '@apphub/filestore-client';
import { getFilestoreRuntimeConfig, type FilestoreRuntimeConfig } from '../../config/filestore';

let cachedClient: FilestoreClient | null = null;
let cachedConfig: FilestoreRuntimeConfig | null = null;

export async function getFilestoreClient(): Promise<{
  client: FilestoreClient;
  config: FilestoreRuntimeConfig;
}> {
  if (cachedClient && cachedConfig) {
    return { client: cachedClient, config: cachedConfig };
  }

  const config = await getFilestoreRuntimeConfig();
  cachedClient = new FilestoreClient({
    baseUrl: config.baseUrl,
    token: config.token ?? undefined,
    userAgent: config.userAgent,
    fetchTimeoutMs: config.fetchTimeoutMs ?? undefined
  });
  cachedConfig = config;
  return { client: cachedClient, config };
}

export function clearFilestoreClientCache(): void {
  cachedClient = null;
  cachedConfig = null;
}
