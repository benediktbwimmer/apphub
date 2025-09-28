const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return false;
}

function applyEnv(values: Record<string, string | undefined>): () => void {
  const restore: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(values)) {
    restore[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, original] of Object.entries(restore)) {
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  };
}

async function findAvailablePort(): Promise<number> {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (typeof address === 'object' && address) {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Failed to resolve port for metastore test server')));
      }
    });
  });
}

export type MetastoreTestServer = {
  port: number;
  url: string;
  schema: string;
  close: () => Promise<void>;
};

export async function startMetastoreTestServer(options: {
  databaseUrl: string;
  redisUrl?: string;
}): Promise<MetastoreTestServer> {
  const port = await findAvailablePort();
  const schema = `metastore_test_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const restoreEnv = applyEnv({
    HOST: '127.0.0.1',
    PORT: String(port),
    APPHUB_AUTH_DISABLED: '1',
    APPHUB_METRICS_ENABLED: '0',
    APPHUB_METASTORE_PG_SCHEMA: schema,
    APPHUB_METASTORE_DEFAULT_NAMESPACE: 'observatory.ingest',
    DATABASE_URL: options.databaseUrl,
    METASTORE_FILESTORE_SYNC_ENABLED: '0',
    REDIS_URL: options.redisUrl ?? 'inline'
  });

  const configModule = await import('../../../services/metastore/src/config/serviceConfig');
  configModule.resetServiceConfigCache();

  const { buildApp } = await import('../../../services/metastore/src/app');
  const { app, config } = await buildApp();

  await app.listen({ host: config.host, port: config.port });

  return {
    port: config.port,
    url: `http://${config.host}:${config.port}`,
    schema,
    close: async () => {
      try {
        await app.close();
      } finally {
        configModule.resetServiceConfigCache();
        restoreEnv();
      }
    }
  } satisfies MetastoreTestServer;
}
