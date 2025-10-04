import { buildApp } from './app';

async function start(): Promise<void> {
  const { app, config } = await buildApp();

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info({ host: config.host, port: config.port }, 'secrets service listening');
  } catch (error) {
    app.log.error({ err: error }, 'failed to start secrets service');
    await app.close();
    throw error;
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down secrets service');
    try {
      await app.close();
    } catch (closeError) {
      app.log.error({ err: closeError }, 'error during secrets service shutdown');
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}

start().catch((error) => {
  console.error('[secrets] fatal startup error', error);
  process.exit(1);
});
