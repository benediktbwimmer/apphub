import type { ServiceConfig } from '../config/serviceConfig';
import { isClickHouseMockEnabled } from './mockStore';

type ClickHouseSettings = ServiceConfig['clickhouse'];

type ClickHouseClient = {
  command(options: { query: string }): Promise<void>;
  query(options: { query: string; format?: string }): Promise<{ json<T>(): Promise<T[]> }>;
  insert(options: { table: string; values: unknown; format?: string }): Promise<void>;
  close(): Promise<void>;
};

type CreateClientFactory = (options: Record<string, unknown>) => ClickHouseClient;

let cached: { key: string; client: ClickHouseClient } | null = null;
let createClientFactory: CreateClientFactory | null = null;

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

function loadCreateClientFactory(): CreateClientFactory {
  if (!createClientFactory) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, import/no-dynamic-require
      const mod = require('@clickhouse/client') as { createClient: CreateClientFactory };
      createClientFactory = mod.createClient;
    } catch (error) {
      throw new Error(
        'ClickHouse client dependency (@clickhouse/client) is not available. Install it or enable TIMESTORE_CLICKHOUSE_HOST=inline for mock mode.'
      );
    }
  }
  return createClientFactory;
}

export function getClickHouseClient(settings: ClickHouseSettings): ClickHouseClient {
  const key = buildKey(settings);
  if (cached && cached.key === key) {
    return cached.client;
  }

  if (isClickHouseMockEnabled(settings)) {
    const mockClient: ClickHouseClient = {
      async command() {
        return;
      },
      async query() {
        return {
          async json<T>() {
            return [] as T[];
          }
        };
      },
      async insert() {
        return;
      },
      async close() {
        return;
      }
    };
    cached = { key, client: mockClient };
    return mockClient;
  }

  const protocol = settings.secure ? 'https' : 'http';
  const host = `${protocol}://${settings.host}:${settings.httpPort}`;
  const createClient = loadCreateClientFactory();
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
  await client.close().catch(() => undefined);
}
