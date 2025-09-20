import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import { z } from 'zod';
import {
  joinSourceLabel,
  manifestEntrySchema,
  manifestFileSchema,
  type ManifestEntryInput,
  type ManifestLoadError
} from './serviceManifestTypes';

const DEFAULT_SERVICE_CONFIG_PATH = path.resolve(__dirname, '..', '..', 'service-config.json');

const git = simpleGit();

const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'commit must be a git SHA');

const serviceConfigImportSchema = z
  .object({
    module: z.string().min(1),
    repo: z.string().min(1),
    ref: z.string().min(1).optional(),
    commit: gitShaSchema.optional(),
    configPath: z.string().min(1).optional()
  })
  .strict();

export type ServiceConfigImport = z.infer<typeof serviceConfigImportSchema>;

const serviceConfigSchema = z
  .object({
    module: z.string().min(1),
    services: z.array(manifestEntrySchema).optional(),
    manifestPath: z.string().min(1).optional(),
    imports: z.array(serviceConfigImportSchema).optional()
  })
  .strict();

type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export type LoadedManifestEntry = ManifestEntryInput & {
  sources: string[];
  baseUrlSource: 'manifest' | 'env';
};

export type ServiceConfigLoadResult = {
  entries: LoadedManifestEntry[];
  errors: ManifestLoadError[];
  usedConfigs: string[];
};

type VisitedModules = Map<string, string>;

type ConfigLoadResult = {
  moduleId: string | null;
  entries: LoadedManifestEntry[];
  errors: ManifestLoadError[];
};

type ConfigLoadOptions = {
  filePath: string;
  sourceLabel: string;
  expectedModule?: string | null;
  visitedModules: VisitedModules;
  repoRoot?: string;
};

function resolveConfiguredPaths(envValue: string | undefined, defaults: string[]): string[] {
  const extras = (envValue ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (path.isAbsolute(entry) ? entry : path.resolve(entry)));
  const paths = [...defaults, ...extras];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const item of paths) {
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    deduped.push(item);
  }
  return deduped;
}

export function resolveServiceConfigPaths(): string[] {
  return resolveConfiguredPaths(process.env.SERVICE_CONFIG_PATH, [DEFAULT_SERVICE_CONFIG_PATH]);
}

async function readJsonFile<T>(filePath: string, parser: (value: unknown) => T): Promise<T> {
  const contents = await fs.readFile(filePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (err) {
    throw new Error(`failed to parse JSON in ${filePath}: ${(err as Error).message}`);
  }
  return parser(parsed);
}

async function readManifestEntries(manifestPath: string): Promise<ManifestEntryInput[]> {
  return readJsonFile(manifestPath, (value) => {
    const parsed = manifestFileSchema.parse(value);
    const entries = Array.isArray(parsed) ? parsed : parsed.services;
    return entries.map((entry) => ({ ...entry }));
  });
}

async function readServiceConfig(configPath: string): Promise<ServiceConfig> {
  return readJsonFile(configPath, (value) => serviceConfigSchema.parse(value));
}

function toRepoRelativePath(filePath: string, repoRoot?: string) {
  if (!repoRoot) {
    return filePath;
  }
  const relative = path.relative(repoRoot, filePath);
  return relative.startsWith('..') ? filePath : relative;
}

function addManifestEntries(
  target: LoadedManifestEntry[],
  entries: ManifestEntryInput[],
  moduleSource: string,
  sourceLabel: string
) {
  for (const entry of entries) {
    target.push({
      ...entry,
      slug: entry.slug.trim().toLowerCase(),
      sources: [moduleSource, sourceLabel],
      baseUrlSource: 'manifest'
    });
  }
}

async function loadConfigRecursive(options: ConfigLoadOptions): Promise<ConfigLoadResult> {
  const { filePath, sourceLabel, expectedModule, visitedModules, repoRoot } = options;
  const errors: ManifestLoadError[] = [];

  let config: ServiceConfig;
  try {
    config = await readServiceConfig(filePath);
  } catch (err) {
    errors.push({ source: sourceLabel, error: err as Error });
    return { moduleId: null, entries: [], errors };
  }

  const moduleId = config.module.trim();
  if (expectedModule && expectedModule !== moduleId) {
    errors.push({
      source: sourceLabel,
      error: new Error(`expected module ${expectedModule} but found ${moduleId}`)
    });
  }

  if (visitedModules.has(moduleId)) {
    return { moduleId, entries: [], errors };
  }

  visitedModules.set(moduleId, sourceLabel);

  const entries: LoadedManifestEntry[] = [];
  const moduleSource = `module:${moduleId}`;

  if (config.services?.length) {
    addManifestEntries(entries, config.services, moduleSource, sourceLabel);
  }

  if (config.manifestPath) {
    const configDir = path.dirname(filePath);
    const manifestFullPath = path.resolve(configDir, config.manifestPath);
    const manifestSourceLabel = joinSourceLabel(sourceLabel, toRepoRelativePath(manifestFullPath, repoRoot));
    try {
      const manifestEntries = await readManifestEntries(manifestFullPath);
      addManifestEntries(entries, manifestEntries, moduleSource, manifestSourceLabel);
    } catch (err) {
      errors.push({ source: manifestSourceLabel, error: err as Error });
    }
  }

  for (const child of config.imports ?? []) {
    if (visitedModules.has(child.module)) {
      continue;
    }
    const childResult = await loadConfigImport(child, visitedModules);
    entries.push(...childResult.entries);
    errors.push(...childResult.errors);
  }

  return { moduleId, entries, errors };
}

async function loadConfigImport(
  importConfig: ServiceConfigImport,
  visitedModules: VisitedModules,
  expectedModuleOverride?: string | null
) {
  const errors: ManifestLoadError[] = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-service-config-'));
  let moduleId: string | null = null;
  let entries: LoadedManifestEntry[] = [];
  let resolvedCommit: string | null = null;
  try {
    const cloneArgs: string[] = [];
    if (!importConfig.commit) {
      cloneArgs.push('--depth', '1');
    }
    if (importConfig.ref) {
      cloneArgs.push('--branch', importConfig.ref);
      cloneArgs.push('--single-branch');
    }
    await git.clone(importConfig.repo, tempDir, cloneArgs);
    const repoGit = simpleGit(tempDir);

    if (importConfig.commit) {
      await repoGit.checkout(importConfig.commit);
    } else if (importConfig.ref) {
      await repoGit.checkout(importConfig.ref);
    }

    try {
      const headSha = await repoGit.revparse(['HEAD']);
      resolvedCommit = headSha.trim();
    } catch (err) {
      errors.push({
        source: `git:${importConfig.repo}`,
        error: new Error(`failed to resolve HEAD commit: ${(err as Error).message}`)
      });
    }

    const configPathRelative = importConfig.configPath ?? 'service-config.json';
    const configFilePath = path.resolve(tempDir, configPathRelative);
    const baseLabel = `git:${importConfig.repo}`;
    const commitLabel = resolvedCommit ?? importConfig.commit ?? importConfig.ref ?? 'HEAD';
    const sourceLabel = joinSourceLabel(`${baseLabel}#${commitLabel}`, configPathRelative);
    const expectedModule =
      expectedModuleOverride === undefined ? importConfig.module : expectedModuleOverride;
    const result = await loadConfigRecursive({
      filePath: configFilePath,
      sourceLabel,
      expectedModule,
      visitedModules,
      repoRoot: tempDir
    });
    moduleId = result.moduleId;
    entries = result.entries;
    errors.push(...result.errors);
  } catch (err) {
    errors.push({
      source: `git:${importConfig.repo}`,
      error: err as Error
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  return { moduleId, entries, errors, resolvedCommit };
}

export async function loadServiceConfigurations(configPaths: string[]): Promise<ServiceConfigLoadResult> {
  const visitedModules: VisitedModules = new Map();
  const entries: LoadedManifestEntry[] = [];
  const errors: ManifestLoadError[] = [];
  const usedConfigs: string[] = [];

  for (const configPath of configPaths) {
    try {
      await fs.access(configPath);
    } catch {
      continue;
    }

    const result = await loadConfigRecursive({
      filePath: configPath,
      sourceLabel: configPath,
      visitedModules,
      repoRoot: path.dirname(configPath)
    });
    usedConfigs.push(configPath);
    entries.push(...result.entries);
    errors.push(...result.errors);
  }

  return { entries, errors, usedConfigs };
}

export type ServiceConfigImportRequest = {
  repo: string;
  ref?: string | null;
  commit?: string | null;
  configPath?: string | null;
  module?: string | null;
};

export type ServiceConfigImportPreview = {
  moduleId: string;
  resolvedCommit: string | null;
  entries: LoadedManifestEntry[];
  errors: ManifestLoadError[];
};

export async function previewServiceConfigImport(
  payload: ServiceConfigImportRequest
): Promise<ServiceConfigImportPreview> {
  const expectedModule = payload.module?.trim() || null;
  const importConfig: ServiceConfigImport = {
    module: expectedModule ?? '__preview__',
    repo: payload.repo,
    ref: payload.ref?.trim() || undefined,
    commit: payload.commit?.trim() ? payload.commit.trim() : undefined,
    configPath: payload.configPath?.trim() || undefined
  };

  const visitedModules: VisitedModules = new Map();
  const result = await loadConfigImport(importConfig, visitedModules, expectedModule);
  if (!result.moduleId) {
    throw new Error('failed to resolve module id from service configuration');
  }

  if (expectedModule && expectedModule !== result.moduleId) {
    result.errors.push({
      source: `git:${payload.repo}`,
      error: new Error(`requested module ${expectedModule} but config exports ${result.moduleId}`)
    });
  }

  return {
    moduleId: result.moduleId,
    resolvedCommit: result.resolvedCommit ?? null,
    entries: result.entries,
    errors: result.errors
  };
}

export class DuplicateModuleImportError extends Error {
  constructor(moduleId: string) {
    super(`module ${moduleId} is already imported`);
    this.name = 'DuplicateModuleImportError';
  }
}

export async function appendServiceConfigImport(
  configPath: string,
  descriptor: ServiceConfigImport & { resolvedCommit?: string | null }
) {
  let config: ServiceConfig;
  try {
    config = await readServiceConfig(configPath);
  } catch (err) {
    throw new Error(`failed to load service config at ${configPath}: ${(err as Error).message}`);
  }

  const imports = [...(config.imports ?? [])];
  if (imports.some((entry) => entry.module === descriptor.module)) {
    throw new DuplicateModuleImportError(descriptor.module);
  }

  const newImport: ServiceConfigImport = {
    module: descriptor.module,
    repo: descriptor.repo,
    ref: descriptor.ref,
    commit: descriptor.resolvedCommit ?? descriptor.commit,
    configPath: descriptor.configPath
  };

  imports.push(newImport);
  imports.sort((a, b) => a.module.localeCompare(b.module));

  const updated: ServiceConfig = {
    ...config,
    imports
  };

  await fs.writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
}

export { DEFAULT_SERVICE_CONFIG_PATH };
