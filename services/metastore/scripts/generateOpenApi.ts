import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildApp } from '../src/app';

process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.FILESTORE_REDIS_URL = process.env.FILESTORE_REDIS_URL ?? 'inline';
process.env.METASTORE_FILESTORE_SYNC_ENABLED =
  process.env.METASTORE_FILESTORE_SYNC_ENABLED ?? 'false';
process.env.APPHUB_METRICS_ENABLED = process.env.APPHUB_METRICS_ENABLED ?? 'false';
process.env.APPHUB_AUTH_DISABLED = process.env.APPHUB_AUTH_DISABLED ?? 'true';

async function generateOpenApiSpec() {
  const { app } = await buildApp({ skipStartupHooks: true });
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
