import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export type ObservatoryPathConfig = {
  inbox: string;
  staging: string;
  archive: string;
  plots: string;
  reports: string;
};

export type ObservatoryFilestoreConfig = {
  baseUrl: string;
  backendMountId: number;
  token?: string;
  inboxPrefix: string;
  stagingPrefix: string;
  archivePrefix: string;
  bucket?: string;
  endpoint?: string;
  region?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

export type ObservatoryTimestoreConfig = {
  baseUrl: string;
  datasetSlug: string;
  datasetName?: string;
  tableName?: string;
  storageTargetId?: string;
  authToken?: string;
  storageDriver?: 'local' | 's3' | 'gcs' | 'azure_blob';
  storageRoot?: string;
  cacheDir?: string;
};

export type ObservatoryMetastoreConfig = {
  baseUrl?: string;
  namespace?: string;
  authToken?: string;
};

export type ObservatoryCatalogConfig = {
  baseUrl?: string;
  apiToken?: string;
};

export type ObservatoryWorkflowGeneratorConfig = {
  instrumentCount?: number;
};

export type ObservatoryWorkflowDashboardConfig = {
  overviewDirName?: string;
  lookbackMinutes?: number;
};

export type ObservatoryWorkflowConfig = {
  generatorSlug: string;
  ingestSlug: string;
  publicationSlug: string;
  aggregateSlug: string;
  visualizationAssetId: string;
  generator?: ObservatoryWorkflowGeneratorConfig;
  dashboard?: ObservatoryWorkflowDashboardConfig;
};

export type ObservatoryConfig = {
  paths: ObservatoryPathConfig;
  filestore: ObservatoryFilestoreConfig;
  timestore: ObservatoryTimestoreConfig;
  metastore?: ObservatoryMetastoreConfig;
  catalog?: ObservatoryCatalogConfig;
  workflows: ObservatoryWorkflowConfig;
};

let cachedConfig: ObservatoryConfig | null = null;
let cachedPath: string | null = null;

const GENERATED_RELATIVE_PATH = path.join('.generated', 'observatory-config.json');

function resolveCandidatePaths(): string[] {
  const explicit = process.env.OBSERVATORY_CONFIG_PATH;
  if (explicit && explicit.trim()) {
    return [path.resolve(explicit.trim()), path.resolve(process.cwd(), explicit.trim())];
  }

  const cwd = process.cwd();
  const guesses = new Set<string>();
  guesses.add(path.resolve(cwd, GENERATED_RELATIVE_PATH));
  guesses.add(path.resolve(cwd, '..', GENERATED_RELATIVE_PATH));
  guesses.add(path.resolve(cwd, '..', '..', GENERATED_RELATIVE_PATH));
  guesses.add(path.resolve(cwd, '..', '..', '..', GENERATED_RELATIVE_PATH));
  guesses.add(path.resolve(__dirname, '..', GENERATED_RELATIVE_PATH));
  guesses.add(path.resolve(__dirname, '..', '..', GENERATED_RELATIVE_PATH));
  return Array.from(guesses);
}

function loadRawConfig(configPath?: string): ObservatoryConfig {
  const candidates = configPath ? [configPath] : resolveCandidatePaths();
  for (const candidate of candidates) {
    try {
      if (!candidate) {
        continue;
      }
      if (!existsSync(candidate)) {
        continue;
      }
      const contents = readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(contents) as ObservatoryConfig;
      cachedPath = candidate;
      return parsed;
    } catch (err) {
      // Continue searching; invalid JSON will surface in final throw below.
    }
  }

  throw new Error(
    'Observatory configuration not found. Provide OBSERVATORY_CONFIG_PATH or generate .generated/observatory-config.json.'
  );
}

export function loadObservatoryConfig(configPath?: string, force = false): ObservatoryConfig {
  if (!force && cachedConfig && !configPath) {
    return cachedConfig;
  }
  const resolved = loadRawConfig(configPath);
  cachedConfig = resolved;
  return resolved;
}

export function getObservatoryConfig(): ObservatoryConfig {
  if (!cachedConfig) {
    cachedConfig = loadObservatoryConfig();
  }
  return cachedConfig;
}

export function getObservatoryConfigPath(): string {
  if (!cachedPath) {
    loadObservatoryConfig();
  }
  if (!cachedPath) {
    throw new Error('Observatory configuration path not resolved');
  }
  return cachedPath;
}

export function resolvePath(config: ObservatoryConfig, key: keyof ObservatoryPathConfig): string {
  const value = config.paths[key];
  if (!value) {
    throw new Error(`Missing observatory path configuration for ${key}`);
  }
  return value;
}

export function resolveFilestorePrefixes(config: ObservatoryConfig) {
  const { inboxPrefix, stagingPrefix, archivePrefix } = config.filestore;
  if (!inboxPrefix || !stagingPrefix || !archivePrefix) {
    throw new Error('Filestore prefixes missing from observatory configuration');
  }
  return { inboxPrefix, stagingPrefix, archivePrefix };
}
