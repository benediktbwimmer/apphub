import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathExists, ensureDir } from './fs';
import { writeJsonFile } from './json';
import {
  createModuleContext,
  resolveModuleCapabilityConfig,
  serializeModuleDefinition,
  type ModuleCapabilities,
  type ModuleDefinition,
  type ModuleManifest,
  type ModuleManifestValueDescriptor,
  type ModuleMetadata,
  type ResolvedModuleCapabilityConfig,
  type ValueDescriptor
} from '@apphub/module-sdk';

const DEFAULT_DEFINITION_LOCATIONS = [
  'dist/module.js',
  'dist/module.cjs',
  'dist/module.mjs',
  'module.js',
  'module.cjs',
  'module.mjs',
  'module.ts'
];

export interface ModuleConfigFile {
  module: ModuleMetadata;
  settings: Record<string, unknown>;
  secrets: Record<string, unknown>;
  capabilities: ResolvedModuleCapabilityConfig;
  scratchDir: string;
  generatedAt: string;
}

export interface GenerateModuleConfigOptions {
  modulePath: string;
  definitionPath?: string;
  outputPath?: string;
  scratchDir?: string;
  overwrite?: boolean;
}

export interface GenerateModuleConfigResult {
  outputPath: string;
  config: ModuleConfigFile;
  manifest: ModuleManifest;
}

export interface ValidateModuleConfigOptions {
  modulePath: string;
  configPath: string;
  definitionPath?: string;
}

export interface ValidateModuleConfigResult {
  metadata: ModuleMetadata;
  manifest: ModuleManifest;
  configPath: string;
  resolvedCapabilities: ResolvedModuleCapabilityConfig;
}

async function resolveFromCandidates(
  modulePath: string,
  explicit: string | undefined,
  candidates: string[]
): Promise<string> {
  if (explicit) {
    const explicitPath = path.resolve(modulePath, explicit);
    if (!(await pathExists(explicitPath))) {
      throw new Error(`Path not found: ${explicitPath}`);
    }
    return explicitPath;
  }

  for (const candidate of candidates) {
    const candidatePath = path.resolve(modulePath, candidate);
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    `Unable to locate required file. Tried: ${candidates.map((candidate) => path.resolve(modulePath, candidate)).join(', ')}`
  );
}

export async function loadModuleDefinition(modulePath: string, definitionPath?: string): Promise<ModuleDefinition> {
  const resolvedDefinitionPath = await resolveFromCandidates(modulePath, definitionPath, DEFAULT_DEFINITION_LOCATIONS);
  const imported = await import(resolvedDefinitionPath);
  const definition = (imported.default ?? imported) as ModuleDefinition | undefined;
  if (!definition || typeof definition !== 'object' || !('metadata' in definition)) {
    throw new Error(`Module definition did not export a ModuleDefinition from ${resolvedDefinitionPath}`);
  }
  return definition;
}

function cloneJson<T>(value: T | undefined): T {
  if (value === undefined) {
    return {} as T;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function resolveDescriptorDefaults<TValue>(
  manifestDescriptor: ModuleManifestValueDescriptor | undefined,
  definitionDescriptor: ValueDescriptor<TValue> | undefined
): TValue | undefined {
  if (manifestDescriptor?.defaults !== undefined) {
    return manifestDescriptor.defaults as TValue;
  }

  if (manifestDescriptor?.inherit) {
    return undefined;
  }

  return definitionDescriptor?.defaults;
}

function resolveScratchDir(moduleName: string | undefined, explicit?: string): string {
  if (explicit) {
    return path.resolve(explicit);
  }
  const base = process.env.APPHUB_SCRATCH_ROOT?.trim() || os.tmpdir();
  const safeName = moduleName?.trim().replace(/[^a-z0-9._-]+/gi, '-') || 'apphub-module';
  return path.resolve(base, safeName);
}

export async function generateModuleConfig(
  options: GenerateModuleConfigOptions
): Promise<GenerateModuleConfigResult> {
  const modulePath = path.resolve(options.modulePath);
  const definition = await loadModuleDefinition(modulePath, options.definitionPath);
  const manifest = serializeModuleDefinition(definition);

  const settingsDefaults = resolveDescriptorDefaults<Record<string, unknown>>(
    manifest.settings,
    definition.settings as ValueDescriptor<Record<string, unknown>> | undefined
  );
  const secretsDefaults = resolveDescriptorDefaults<Record<string, unknown>>(
    manifest.secrets,
    definition.secrets as ValueDescriptor<Record<string, unknown>> | undefined
  );

  const settings = cloneJson<Record<string, unknown>>(settingsDefaults);
  const secrets = cloneJson<Record<string, unknown>>(secretsDefaults);

  const scratchDir = resolveScratchDir(manifest.metadata?.name, options.scratchDir);
  await ensureDir(scratchDir);

  const capabilityConfig = definition.capabilities
    ? resolveModuleCapabilityConfig(definition.capabilities, { settings, secrets })
    : {};

  const config: ModuleConfigFile = {
    module: definition.metadata,
    settings,
    secrets,
    capabilities: capabilityConfig,
    scratchDir,
    generatedAt: new Date().toISOString()
  };

  const outputPath = resolveOutputPath({
    modulePath,
    moduleName: definition.metadata.name,
    scratchDir,
    requested: options.outputPath,
    overwrite: options.overwrite
  });

  if (!options.overwrite && (await pathExists(outputPath))) {
    throw new Error(`Refusing to overwrite existing file at ${outputPath}. Pass --overwrite to replace it.`);
  }

  await writeJsonFile(outputPath, config);

  return {
    outputPath,
    config,
    manifest
  };
}

function resolveOutputPath(params: {
  modulePath: string;
  moduleName: string;
  scratchDir: string;
  requested?: string;
  overwrite?: boolean;
}): string {
  const { modulePath, moduleName, scratchDir, requested } = params;
  let candidate: string;
  if (requested) {
    const resolvedRequested = path.resolve(modulePath, requested);
    if (resolvedRequested.endsWith(path.sep)) {
      candidate = path.join(resolvedRequested, `${moduleName}-config.json`);
    } else {
      candidate = resolvedRequested;
    }
  } else {
    candidate = path.join(scratchDir, 'config', `${moduleName}.json`);
  }

  return path.resolve(candidate);
}

export async function validateModuleConfig(
  options: ValidateModuleConfigOptions
): Promise<ValidateModuleConfigResult> {
  const modulePath = path.resolve(options.modulePath);
  const configPath = path.resolve(options.configPath);

  const [definition, config] = await Promise.all([
    loadModuleDefinition(modulePath, options.definitionPath),
    readConfigFile(configPath)
  ]);
  const manifest = serializeModuleDefinition(definition);

  const context = createModuleContext<Record<string, unknown>, Record<string, unknown>>({
    module: definition.metadata,
    settingsDescriptor: definition.settings,
    secretsDescriptor: definition.secrets,
    capabilityConfig: definition.capabilities,
    settings: config.settings,
    secrets: config.secrets
  });

  const resolved = definition.capabilities
    ? resolveModuleCapabilityConfig(definition.capabilities, {
        settings: context.settings,
        secrets: context.secrets
      })
    : {};

  const missingCapabilities: string[] = [];
  if (definition.capabilities) {
    const capabilityKeys = Object.keys(definition.capabilities) as Array<keyof ModuleCapabilities>;
    for (const key of capabilityKeys) {
      if (!context.capabilities[key]) {
        missingCapabilities.push(String(key));
      }
    }
  }

  if (missingCapabilities.length > 0) {
    throw new Error(
      `Configuration for module "${definition.metadata.name}" is missing required capabilities: ${missingCapabilities.join(', ')}`
    );
  }

  return {
    metadata: definition.metadata,
    manifest,
    configPath,
    resolvedCapabilities: resolved
  } satisfies ValidateModuleConfigResult;
}

async function readConfigFile(configPath: string): Promise<ModuleConfigFile> {
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as ModuleConfigFile;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid configuration file');
    }
    parsed.settings = parsed.settings ?? {};
    parsed.secrets = parsed.secrets ?? {};
    parsed.capabilities = parsed.capabilities ?? {};
    return parsed;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to read config from ${configPath}: ${error.message}`);
    }
    throw error;
  }
}
