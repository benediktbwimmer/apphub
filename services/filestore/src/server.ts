import { buildApp } from './app';
import { loadServiceConfig } from './config/serviceConfig';
import { closePool } from './db/client';

async function start(): Promise<void> {
  const config = loadServiceConfig();
  const { app } = await buildApp({ config });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, 'filestore service listening');
  } catch (err) {
    app.log.error({ err }, 'failed to start filestore service');
    await app.close();
    throw err;
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down filestore');
    try {
      await app.close();
    } catch (closeErr) {
      app.log.error({ err: closeErr }, 'error during filestore shutdown');
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

start().catch(async (err) => {
  console.error('[filestore] fatal startup error', err);
  try {
    await closePool();
  } catch (closeErr) {
    console.error('[filestore] failed to close postgres pool after startup failure', closeErr);
  }
  process.exit(1);
});
