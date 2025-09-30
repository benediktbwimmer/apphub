import { promises as fs } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';

process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'inline';
process.env.FILESTORE_REDIS_URL = process.env.FILESTORE_REDIS_URL ?? process.env.REDIS_URL;
process.env.FILESTORE_EVENTS_MODE = process.env.FILESTORE_EVENTS_MODE ?? 'inline';
process.env.FILESTORE_EVENTS_CHANNEL = process.env.FILESTORE_EVENTS_CHANNEL ?? 'apphub:filestore';
process.env.FILESTORE_DATABASE_URL =
  process.env.FILESTORE_DATABASE_URL ?? 'postgres://apphub:apphub@127.0.0.1:5432/apphub';
process.env.FILESTORE_METRICS_ENABLED = process.env.FILESTORE_METRICS_ENABLED ?? 'false';

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
    { registerSystemRoutes },
    { registerV1Routes }
  ] = await Promise.all([
    import('../src/openapi/plugin'),
    import('../src/routes/system'),
    import('../src/routes/v1/index')
  ]);

  await registerOpenApi(app);
  await registerSystemRoutes(app);
  await registerV1Routes(app);

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
