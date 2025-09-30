import process from 'node:process';

import { loadConfig } from './config';
import { createApp } from './app';

const start = async () => {
  const config = loadConfig();
  const { app } = await createApp(config);

  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info({ port: config.port, host: config.host }, 'Ticketing service listening');
  } catch (error) {
    app.log.error({ err: error }, 'Failed to start ticketing service');
    process.exit(1);
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, 'Shutting down ticketing service');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
};

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught error in ticketing service', error);
  process.exit(1);
});
