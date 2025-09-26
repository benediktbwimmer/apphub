import { buildApp } from './app';
import { loadServiceConfig } from './config/serviceConfig';

async function main(): Promise<void> {
  const config = loadServiceConfig();
  const { app } = await buildApp({ config });

  try {
    await app.ready();
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`Metastore API listening on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error({ err }, 'Failed to start Metastore API');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[metastore] unexpected error while starting server', err);
    process.exit(1);
  });
}
