import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { createEventDrivenObservatoryConfig } from './observatoryEventDrivenConfig';
import type { JsonObject, JsonValue, WorkflowDefinitionTemplate } from './types';

export type EventDrivenObservatoryConfig = ReturnType<typeof createEventDrivenObservatoryConfig>['config'];

const OBSERVATORY_MODULE_ID = 'github.com/apphub/examples/environmental-observatory-event-driven';
const OBSERVATORY_BACKEND_MOUNT_KEY = process.env.OBSERVATORY_FILESTORE_MOUNT_KEY
  ? process.env.OBSERVATORY_FILESTORE_MOUNT_KEY.trim()
  : 'observatory-event-driven-local';
const OBSERVATORY_WORKFLOW_SLUGS = new Set([
  'observatory-minute-data-generator',
  'observatory-minute-ingest',
  'observatory-daily-publication'
]);

function resolveHostRootMount(): string | null {
  const raw = process.env.APPHUB_HOST_ROOT ?? process.env.HOST_ROOT_PATH;
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) {
    return null;
  }
  return resolved;
}

const HOST_ROOT_MOUNT = resolveHostRootMount();

function resolveContainerPath(targetPath: string): string {
  const absolute = path.resolve(targetPath);
  if (!HOST_ROOT_MOUNT) {
    return absolute;
  }
  if (existsSync(absolute)) {
    return absolute;
  }
  if (
    absolute === HOST_ROOT_MOUNT ||
    absolute.startsWith(`${HOST_ROOT_MOUNT}${path.sep}`)
  ) {
    return absolute;
  }
  const relativeFromRoot = path.relative('/', absolute);
  if (!relativeFromRoot || relativeFromRoot.startsWith('..')) {
    return absolute;
  }
  return path.join(HOST_ROOT_MOUNT, relativeFromRoot);
}

function isWithinDirectory(base: string, target: string): boolean {
  const relative = path.relative(base, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureJsonObject(value: JsonValue | undefined): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }
  const empty: JsonObject = {};
  return empty;
}

export type ObservatoryBootstrapLogger = {
  debug?: (meta: unknown, message?: string) => void;
  error?: (meta: unknown, message?: string) => void;
};

export function resolveObservatoryRepoRoot(): string {
  const envRoot = process.env.APPHUB_REPO_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot.trim());
  }
  return path.resolve(__dirname, '..', '..', '..');
}

export function isObservatoryModule(moduleId: string): boolean {
  return moduleId === OBSERVATORY_MODULE_ID;
}

export function resolveGeneratedObservatoryConfigPath(repoRoot: string): string {
  return path.resolve(
    repoRoot,
    'examples',
    'environmental-observatory-event-driven',
    '.generated',
    'observatory-config.json'
  );
}

export function isObservatoryWorkflowSlug(slug: string): boolean {
  return OBSERVATORY_WORKFLOW_SLUGS.has(slug);
}

export function applyObservatoryWorkflowDefaults(
  definition: WorkflowDefinitionTemplate,
  config: EventDrivenObservatoryConfig
): void {
  if (!OBSERVATORY_WORKFLOW_SLUGS.has(definition.slug)) {
    return;
  }

  const defaults = ensureJsonObject(definition.defaultParameters);
  definition.defaultParameters = defaults;

  switch (definition.slug) {
    case 'observatory-minute-data-generator':
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      defaults.filestoreBackendId = config.filestore.backendMountId;
      defaults.inboxPrefix = config.filestore.inboxPrefix;
      defaults.stagingPrefix = config.filestore.stagingPrefix;
      defaults.archivePrefix = config.filestore.archivePrefix;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-data-generator';
      defaults.filestoreToken = config.filestore.token ?? null;
      break;
    case 'observatory-minute-ingest':
      defaults.stagingDir = config.paths.staging;
      defaults.archiveDir = config.paths.archive;
      defaults.filestoreBaseUrl = config.filestore.baseUrl;
      defaults.filestoreBackendId = config.filestore.backendMountId;
      defaults.inboxPrefix = config.filestore.inboxPrefix;
      defaults.stagingPrefix = config.filestore.stagingPrefix;
      defaults.archivePrefix = config.filestore.archivePrefix;
      defaults.filestorePrincipal = defaults.filestorePrincipal ?? 'observatory-inbox-normalizer';
      defaults.filestoreToken = config.filestore.token ?? null;
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreDatasetName = config.timestore.datasetName ?? null;
      defaults.timestoreTableName = config.timestore.tableName ?? null;
      defaults.timestoreStorageTargetId = config.timestore.storageTargetId ?? null;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;
      break;
    case 'observatory-daily-publication':
      defaults.timestoreBaseUrl = config.timestore.baseUrl;
      defaults.timestoreDatasetSlug = config.timestore.datasetSlug;
      defaults.timestoreAuthToken = config.timestore.authToken ?? null;
      defaults.plotsDir = config.paths.plots;
      defaults.reportsDir = config.paths.reports;
      defaults.metastoreBaseUrl = config.metastore?.baseUrl ?? null;
      defaults.metastoreNamespace = config.metastore?.namespace ?? null;
      defaults.metastoreAuthToken = config.metastore?.authToken ?? null;
      break;
    default:
      break;
  }
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function resolveBackendRoot(config: EventDrivenObservatoryConfig): string {
  const directories = [config.paths.inbox, config.paths.staging, config.paths.archive]
    .filter(Boolean)
    .map((entry) => resolveContainerPath(entry));

  if (directories.length === 0) {
    throw new Error('Observatory configuration is missing directories for filestore backend root resolution');
  }

  let candidate = directories[0];
  while (candidate) {
    const normalized = resolveContainerPath(candidate);
    if (directories.every((dir) => isWithinDirectory(normalized, dir))) {
      return normalized;
    }
    const parent = path.dirname(normalized);
    if (parent === normalized) {
      return normalized;
    }
    candidate = parent;
  }

  return directories[0];
}

async function ensurePaths(config: EventDrivenObservatoryConfig): Promise<void> {
  const uniquePaths = new Set<string>([
    config.paths.inbox,
    config.paths.staging,
    config.paths.archive,
    config.paths.plots,
    config.paths.reports
  ]);

  for (const entry of uniquePaths) {
    if (!entry) {
      continue;
    }
    const containerPath = resolveContainerPath(entry);
    await mkdir(containerPath, { recursive: true });
  }
}

export type EnsureObservatoryBackendOptions = {
  logger?: ObservatoryBootstrapLogger;
};

export async function ensureObservatoryBackend(
  config: EventDrivenObservatoryConfig,
  options?: EnsureObservatoryBackendOptions
): Promise<number | null> {
  if (process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP === '1') {
    options?.logger?.debug?.({ reason: 'disabled' }, 'Observatory bootstrap disabled via env flag');
    return null;
  }

  await ensurePaths(config);

  const connectionString =
    process.env.FILESTORE_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://apphub:apphub@127.0.0.1:5432/apphub';
  const schema = (process.env.FILESTORE_PG_SCHEMA ?? 'filestore').trim();

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const backendRoot = resolveBackendRoot(config);
    await mkdir(backendRoot, { recursive: true });

    const quotedSchema = quoteIdentifier(schema);
    const result = await pool.query<{ id: number }>(
      `INSERT INTO ${quotedSchema}.backend_mounts (mount_key, backend_kind, root_path, access_mode, state, config)
       VALUES ($1, 'local', $2, 'rw', 'active', $3::jsonb)
       ON CONFLICT (mount_key)
       DO UPDATE SET
         root_path = EXCLUDED.root_path,
         access_mode = 'rw',
         state = 'active',
         config = ${quotedSchema}.backend_mounts.config || EXCLUDED.config,
         updated_at = NOW()
       RETURNING id`,
      [
        OBSERVATORY_BACKEND_MOUNT_KEY,
        backendRoot,
        JSON.stringify({ provisionedBy: 'observatory-import' })
      ]
    );

    options?.logger?.debug?.({ rows: result.rows }, 'Ensured observatory filestore backend');

    const rawBackendId = result.rows[0]?.id;
    const backendId =
      typeof rawBackendId === 'string'
        ? Number.parseInt(rawBackendId, 10)
        : typeof rawBackendId === 'number'
          ? rawBackendId
          : null;
    if (typeof backendId !== 'number' || !Number.isFinite(backendId)) {
      throw new Error('Failed to resolve filestore backend id after insert');
    }
    return backendId;
  } catch (err) {
    options?.logger?.error?.({ err: err instanceof Error ? err.message : err }, 'Failed to ensure observatory filestore backend');
    throw err;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

export async function loadObservatoryConfig(): Promise<EventDrivenObservatoryConfig> {
  const repoRoot = resolveObservatoryRepoRoot();
  const explicitPath = process.env.OBSERVATORY_CONFIG_PATH?.trim();
  const candidates: string[] = [];
  if (explicitPath) {
    candidates.push(path.resolve(explicitPath));
  }
  candidates.push(resolveGeneratedObservatoryConfigPath(repoRoot));

  for (const candidate of candidates) {
    try {
      const contents = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(contents) as EventDrivenObservatoryConfig;
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // Continue searching; fall through to generated materialization.
    }
  }

  const { config } = createEventDrivenObservatoryConfig({
    repoRoot,
    variables: process.env
  });
  return config;
}
