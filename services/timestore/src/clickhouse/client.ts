import { createClient, type ClickHouseClient } from '@clickhouse/client';
import type { ServiceConfig } from '../config/serviceConfig';

type ClickHouseSettings = ServiceConfig['clickhouse'];

let cached: { key: string; client: ClickHouseClient } | null = null;

function buildKey(settings: ClickHouseSettings): string {
  return [
    settings.host,
    settings.httpPort,
    settings.username,
    settings.password,
    settings.database,
    settings.secure ? 'secure' : 'insecure'
  ].join('|');
}

export function getClickHouseClient(settings: ClickHouseSettings): ClickHouseClient {
  const key = buildKey(settings);
  if (cached && cached.key === key) {
    return cached.client;
  }

  const protocol = settings.secure ? 'https' : 'http';
  const host = `${protocol}://${settings.host}:${settings.httpPort}`;
  const client = createClient({
    host,
    username: settings.username,
    password: settings.password,
    database: settings.database,
    application: 'timestore'
  });

  if (cached) {
    void cached.client.close().catch(() => undefined);
  }
  cached = { key, client };
  return client;
}

export async function closeClickHouseClient(): Promise<void> {
  if (!cached) {
    return;
  }
  const { client } = cached;
  cached = null;
  await client.close();
}
