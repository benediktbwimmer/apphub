import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  createEventDrivenObservatoryConfig,
  ensureObservatoryBackend,
  type EventDrivenObservatoryConfig
} from '@apphub/examples';
import { FilestoreClient } from '@apphub/filestore-client';
import { ensureFilestoreHierarchy } from '../shared/filestore';

async function ensureConfiguredPrefixes(config: EventDrivenObservatoryConfig): Promise<void> {
  const backendMountId = config.filestore.backendMountId;
  if (!backendMountId || !Number.isFinite(backendMountId)) {
    return;
  }

  const client = new FilestoreClient({
    baseUrl: config.filestore.baseUrl,
    token: config.filestore.token,
    userAgent: 'observatory-config-materializer/0.3.0'
  });

  const prefixes = [
    config.filestore.inboxPrefix,
    config.filestore.stagingPrefix,
    config.filestore.archivePrefix,
    config.filestore.visualizationsPrefix,
    config.filestore.reportsPrefix,
    config.filestore.calibrationsPrefix,
    config.filestore.plansPrefix
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const prefix of prefixes) {
    await ensureFilestoreHierarchy(client, backendMountId, prefix, 'observatory-config');
  }
}

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

  await ensureConfiguredPrefixes(config);

  const timestoreDirs = [config.timestore.storageRoot, config.timestore.cacheDir]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => path.resolve(entry));

  for (const targetDir of timestoreDirs) {
    await mkdir(targetDir, { recursive: true });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  console.log(`Observatory config written to ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
