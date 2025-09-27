import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createEventDrivenObservatoryConfig,
  ensureObservatoryBackend
} from '@apphub/examples-registry';

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const { config, outputPath } = createEventDrivenObservatoryConfig({
    repoRoot,
    variables: process.env
  });

  const backendId = await ensureObservatoryBackend(config, {
    logger: {
      debug(meta, message) {
        if (message) {
          console.log(message, meta ?? {});
        }
      },
      error(meta, message) {
        console.error(message ?? 'Failed to provision observatory filestore backend', meta ?? {});
      }
    }
  });
  if (typeof backendId === 'number' && Number.isFinite(backendId)) {
    config.filestore.backendMountId = backendId;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`Observatory config written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
