import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { enforceScratchOnlyWrites } from '@apphub/module-sdk';
import {
  createEventDrivenObservatoryConfig,
  type EventDrivenObservatoryConfig
} from './configBuilder';

export interface MaterializeObservatoryConfigOptions {
  repoRoot: string;
  env: NodeJS.ProcessEnv;
  logger?: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    error?: (message: string, meta?: Record<string, unknown>) => void;
  };
}

export interface MaterializeObservatoryConfigResult {
  config: EventDrivenObservatoryConfig;
  outputPath: string;
  filestore: FilestoreProvisioning;
}

export interface FilestoreProvisioning {
  baseUrl: string;
  token: string | null;
  backendMountId: number | null;
  backendMountKey: string | null;
  prefixes: string[];
  principal: string;
  bucket: string | null;
  endpoint: string | null;
  region: string | null;
  forcePathStyle: boolean | null;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  sessionToken: string | null;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object') {
    return value as Record<string, unknown>;
  }
  return {};
}

function collectFilestoreProvisioning(config: EventDrivenObservatoryConfig): FilestoreProvisioning {
  const prefixes = [
    config.filestore.inboxPrefix,
    config.filestore.stagingPrefix,
    config.filestore.archivePrefix,
    config.filestore.visualizationsPrefix,
    config.filestore.reportsPrefix,
    config.filestore.calibrationsPrefix,
    config.filestore.plansPrefix
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  return {
    baseUrl: config.filestore.baseUrl,
    token: config.filestore.token ?? null,
    backendMountId: config.filestore.backendMountId ?? null,
    backendMountKey: config.filestore.backendMountKey ?? null,
    prefixes,
    principal: 'observatory-config',
    bucket: config.filestore.bucket ?? null,
    endpoint: config.filestore.endpoint ?? null,
    region: config.filestore.region ?? null,
    forcePathStyle:
      config.filestore.forcePathStyle === undefined ? null : Boolean(config.filestore.forcePathStyle),
    accessKeyId: config.filestore.accessKeyId ?? null,
    secretAccessKey: config.filestore.secretAccessKey ?? null,
    sessionToken: config.filestore.sessionToken ?? null
  } satisfies FilestoreProvisioning;
}

export async function materializeObservatoryConfig(
  options: MaterializeObservatoryConfigOptions
): Promise<MaterializeObservatoryConfigResult> {
  const { repoRoot, env } = options;
  const { config, outputPath } = createEventDrivenObservatoryConfig({
    repoRoot,
    variables: env
  });

  const logger = options.logger ?? {};
  const filestore = collectFilestoreProvisioning(config);

  const timestoreDirs = [config.timestore.storageRoot, config.timestore.cacheDir]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => path.resolve(entry));

  for (const dir of timestoreDirs) {
    await mkdir(dir, { recursive: true });
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const runtimeScratchRoots = new Set<string>();
  const runtimeScratchCandidates = [
    env.APPHUB_RUNTIME_SCRATCH_ROOT?.trim(),
    env.APPHUB_SCRATCH_ROOT?.trim()
  ];

  for (const candidate of runtimeScratchCandidates) {
    if (!candidate) {
      continue;
    }
    runtimeScratchRoots.add(path.resolve(candidate));
  }

  runtimeScratchRoots.add('/tmp/apphub');

  const mirrorTargets = new Set<string>();
  const explicitConfigPath = env.OBSERVATORY_CONFIG_PATH?.trim();
  if (explicitConfigPath) {
    mirrorTargets.add(path.resolve(explicitConfigPath));
  }

  for (const root of runtimeScratchRoots) {
    mirrorTargets.add(path.resolve(path.join(root, 'observatory', 'config', 'observatory-config.json')));
    mirrorTargets.add(path.resolve(path.join(root, 'config', 'observatory-config.json')));
  }

  mirrorTargets.add(path.resolve('/tmp/apphub/config/observatory-config.json'));

  enforceScratchOnlyWrites({
    allowedPrefixes: Array.from(mirrorTargets).map((target) => path.dirname(target))
  });

  for (const targetPath of mirrorTargets) {
    if (path.resolve(targetPath) === path.resolve(outputPath)) {
      continue;
    }
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
      logger.debug?.('Observatory config mirrored', { path: targetPath });
    } catch (error) {
      logger.debug?.('Skipping observatory config mirror', { path: targetPath, error });
    }
  }

  logger.debug?.('Observatory config materialized', { outputPath });

  return { config, outputPath, filestore };
}
