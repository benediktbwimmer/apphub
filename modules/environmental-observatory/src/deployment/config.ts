import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  logger.debug?.('Observatory config materialized', { outputPath });

  return { config, outputPath, filestore };
}
