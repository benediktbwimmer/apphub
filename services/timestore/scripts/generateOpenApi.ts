import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';

process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'inline';
process.env.TIMESTORE_MANIFEST_CACHE_REDIS_URL =
  process.env.TIMESTORE_MANIFEST_CACHE_REDIS_URL ?? process.env.REDIS_URL;
process.env.FILESTORE_REDIS_URL = process.env.FILESTORE_REDIS_URL ?? process.env.REDIS_URL;
process.env.TIMESTORE_DATABASE_URL =
  process.env.TIMESTORE_DATABASE_URL ?? 'postgres://apphub:apphub@127.0.0.1:5432/apphub';
process.env.TIMESTORE_HOST = process.env.TIMESTORE_HOST ?? '127.0.0.1';
process.env.TIMESTORE_PORT = process.env.TIMESTORE_PORT ?? '4200';
process.env.APPHUB_DISABLE_ANALYTICS = process.env.APPHUB_DISABLE_ANALYTICS ?? 'true';

async function generateOpenApiSpec() {
  const app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        strict: false
      }
    }
  });

  const [
    { registerOpenApi },
    { registerHealthRoutes },
    { registerIngestionRoutes },
    { registerQueryRoutes },
    { registerSqlRoutes }
  ] = await Promise.all([
    import('../src/openapi/plugin'),
    import('../src/routes/health'),
    import('../src/routes/ingest'),
    import('../src/routes/query'),
    import('../src/routes/sql')
  ]);

  await registerOpenApi(app);
  await registerHealthRoutes(app);
  await registerIngestionRoutes(app);
  await registerQueryRoutes(app);
  await registerSqlRoutes(app);

  await app.ready();

  const document = app.swagger();
  const outputPath = path.resolve(__dirname, '..', 'openapi.json');
  const serialized = JSON.stringify(document, null, 2);
  await fs.writeFile(outputPath, `${serialized}\n`, 'utf8');

  await app.close();

  return outputPath;
}

generateOpenApiSpec()
  .then((outputPath) => {
    process.stdout.write(`OpenAPI schema written to ${outputPath}\n`);
  })
  .catch((error) => {
    console.error('Failed to generate OpenAPI schema', error);
    process.exitCode = 1;
  });
