import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import { z } from 'zod';
import {
  joinSourceLabel,
  manifestEntrySchema,
  manifestFileSchema,
  serviceNetworkSchema,
  type ManifestEntryInput,
  type ManifestEnvVarInput,
  type ManifestEnvVarValue,
  type ManifestLoadError,
  type ManifestPlaceholderDetails,
  type ManifestPlaceholderValue,
  type ManifestServiceNetworkInput,
  type ResolvedManifestEnvVar
} from './serviceManifestTypes';
import { bootstrapPlanSchema, type BootstrapPlanSpec, type BootstrapActionSpec } from './bootstrap';

const git = simpleGit();

const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'commit must be a git SHA');

const serviceConfigImportSchema = z
  .object({
    module: z.string().min(1),
    repo: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    commit: gitShaSchema.optional(),
    configPath: z.string().min(1).optional(),
    variables: z.record(z.string().min(1), z.string()).optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasRepo = typeof value.repo === 'string' && value.repo.trim().length > 0;
    const hasPath = typeof value.path === 'string' && value.path.trim().length > 0;

    if (hasRepo === hasPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of "repo" or "path" when importing service configs.'
      });
    }

    if (!hasRepo) {
      if (value.ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The "ref" field can only be used with git-based imports.'
        });
      }
      if (value.commit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The "commit" field can only be used with git-based imports.'
        });
      }
    }
  });

export type ServiceConfigImport = z.infer<typeof serviceConfigImportSchema>;

const serviceConfigSchema = z
  .object({
    module: z.string().min(1),
    services: z.array(manifestEntrySchema).optional(),
    networks: z.array(serviceNetworkSchema).optional(),
    manifestPath: z.string().min(1).optional(),
    imports: z.array(serviceConfigImportSchema).optional(),
    bootstrap: bootstrapPlanSchema.optional()
  })
  .strict();

type ServiceConfig = z.infer<typeof serviceConfigSchema>;

const placeholderDescriptorSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    default: z.string().optional()
  })
  .strict();

const manifestReferenceSchema = z
  .object({
    path: z.string().min(1),
    kind: z.enum(['services', 'networks', 'bundle']).optional(),
    description: z.string().optional()
  })
  .strict();

const linkedAssetSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1),
    description: z.string().optional(),
    mediaType: z.string().optional()
  })
  .strict();

export const exampleConfigDescriptorSchema = serviceConfigSchema
  .extend({
    $schema: z.string().optional(),
    configVersion: z.string().optional(),
    placeholders: z.array(placeholderDescriptorSchema).optional(),
    manifests: z.array(manifestReferenceSchema).optional(),
    assets: z.array(linkedAssetSchema).optional()
  })
  .strict();

export type ExampleConfigDescriptor = z.infer<typeof exampleConfigDescriptorSchema>;

export type LoadedManifestEntry = Omit<ManifestEntryInput, 'env'> & {
  env?: ResolvedManifestEnvVar[];
  sources: string[];
  baseUrlSource: 'manifest' | 'env';
};

type LoadedNetworkService = Omit<ManifestServiceNetworkInput['services'][number], 'env' | 'app'> & {
  env?: ResolvedManifestEnvVar[];
  app: Omit<ManifestServiceNetworkInput['services'][number]['app'], 'launchEnv'> & {
    launchEnv?: ResolvedManifestEnvVar[];
  };
};

export type LoadedServiceNetwork = Omit<ManifestServiceNetworkInput, 'env' | 'services'> & {
  env?: ResolvedManifestEnvVar[];
  services: LoadedNetworkService[];
  sources: string[];
};

export type ManifestPlaceholderOccurrence =
  | { kind: 'service'; serviceSlug: string; envKey: string; source: string }
  | { kind: 'network'; networkId: string; envKey: string; source: string }
  | { kind: 'network-service'; networkId: string; serviceSlug: string; envKey: string; source: string }
  | { kind: 'app-launch'; networkId: string; appId: string; envKey: string; source: string };

export type ManifestPlaceholderSummary = {
  name: string;
  description?: string;
  defaultValue?: string;
  value?: string;
  required: boolean;
  missing: boolean;
  occurrences: ManifestPlaceholderOccurrence[];
  conflicts: string[];
};

type VisitedModules = Map<string, string>;

type ConfigLoadResult = {
  moduleId: string | null;
  entries: LoadedManifestEntry[];
  networks: LoadedServiceNetwork[];
  errors: ManifestLoadError[];
  bootstrap: BootstrapPlanSpec | null;
};

type PlaceholderValueSource = 'default' | 'variable';

type PlaceholderEntry = {
  name: string;
  description?: string;
  defaultValue?: string;
  value?: string;
  valueSource?: PlaceholderValueSource;
  required: boolean;
  missing: boolean;
  occurrences: ManifestPlaceholderOccurrence[];
  conflicts: string[];
  missingNotified: boolean;
  conflictNotified: boolean;
};

type PlaceholderCollector = Map<string, PlaceholderEntry>;

type PlaceholderMetadataEntry = {
  name: string;
  description?: string;
  defaultValue?: string;
  sourceLabel: string;
};

type PlaceholderMetadataStore = Map<string, PlaceholderMetadataEntry>;

type PlaceholderMetadataDetails = {
  description?: string;
  defaultValue?: string;
  sourceLabel?: string;
};

type PlaceholderMetadataLookup = (name: string) => PlaceholderMetadataDetails | undefined;

type PlaceholderMode = 'collect' | 'enforce';

type PlaceholderOwner =
  | { kind: 'service'; serviceSlug: string }
  | { kind: 'network'; networkId: string }
  | { kind: 'network-service'; networkId: string; serviceSlug: string }
  | { kind: 'app-launch'; networkId: string; appId: string };

type ConfigLoadOptions = {
  filePath: string;
  sourceLabel: string;
  expectedModule?: string | null;
  visitedModules: VisitedModules;
  repoRoot?: string;
  variables?: Record<string, string> | null;
  placeholderCollector: PlaceholderCollector;
  placeholderMetadata: PlaceholderMetadataStore;
  placeholderMode: PlaceholderMode;
};

type PlaceholderDetection =
  | { type: 'none' }
  | { type: 'literal'; value: string }
  | {
      type: 'placeholder';
      details: {
        name: string;
        defaultValue?: string;
        description?: string;
        sourceLabel?: string;
      };
    };

function createPlaceholderCollector(): PlaceholderCollector {
  return new Map();
}

function createPlaceholderMetadataStore(): PlaceholderMetadataStore {
  return new Map();
}

function registerPlaceholderMetadata(
  store: PlaceholderMetadataStore,
  metadata: { name: string; description?: string; defaultValue?: string; sourceLabel: string },
  errors: ManifestLoadError[]
) {
  const name = metadata.name.trim();
  if (!name) {
    return;
  }
  const existing = store.get(name);
  if (!existing) {
    store.set(name, {
      name,
      description: metadata.description,
      defaultValue: metadata.defaultValue,
      sourceLabel: metadata.sourceLabel
    });
    return;
  }

  if (
    metadata.defaultValue !== undefined &&
    existing.defaultValue !== undefined &&
    metadata.defaultValue !== existing.defaultValue
  ) {
    errors.push({
      source: metadata.sourceLabel,
      error: new Error(
        `placeholder ${name} default "${metadata.defaultValue}" conflicts with "${existing.defaultValue}" from ${existing.sourceLabel}`
      )
    });
    return;
  }

  if (existing.defaultValue === undefined && metadata.defaultValue !== undefined) {
    existing.defaultValue = metadata.defaultValue;
    existing.sourceLabel = metadata.sourceLabel;
  }

  if (!existing.description && metadata.description) {
    existing.description = metadata.description;
  }
}

function lookupPlaceholderMetadata(
  store: PlaceholderMetadataStore,
  name: string
): PlaceholderMetadataDetails | undefined {
  const entry = store.get(name.trim());
  if (!entry) {
    return undefined;
  }
  return {
    defaultValue: entry.defaultValue,
    description: entry.description,
    sourceLabel: entry.sourceLabel
  };
}

function detectPlaceholder(
  value: ManifestEnvVarValue | undefined,
  options: { metadataLookup?: PlaceholderMetadataLookup } = {}
): PlaceholderDetection {
  if (value === undefined) {
    return { type: 'none' };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(/^\$\{([A-Za-z0-9_]+)\}$/);
    if (match) {
      const placeholderName = match[1];
      const metadata = options.metadataLookup?.(placeholderName);
      return {
        type: 'placeholder',
        details: {
          name: placeholderName,
          defaultValue: metadata?.defaultValue,
          description: metadata?.description,
          sourceLabel: metadata?.sourceLabel
        }
      };
    }
    return { type: 'literal', value };
  }
  const placeholder = (value as ManifestPlaceholderValue).$var as ManifestPlaceholderDetails;
  return {
    type: 'placeholder',
    details: {
      name: placeholder.name,
      defaultValue: placeholder.default,
      description: placeholder.description
    }
  };
}

function ensurePlaceholderEntry(collector: PlaceholderCollector, name: string): PlaceholderEntry {
  const normalized = name.trim();
  const existing = collector.get(normalized);
  if (existing) {
    return existing;
  }
  const entry: PlaceholderEntry = {
    name: normalized,
    required: false,
    missing: false,
    occurrences: [],
    conflicts: [],
    missingNotified: false,
    conflictNotified: false
  };
  collector.set(normalized, entry);
  return entry;
}

function recordPlaceholderOccurrence(
  entry: PlaceholderEntry,
  owner: PlaceholderOwner,
  envKey: string,
  sourceLabel: string
) {
  let occurrence: ManifestPlaceholderOccurrence;
  switch (owner.kind) {
    case 'service':
      occurrence = {
        kind: 'service',
        serviceSlug: owner.serviceSlug,
        envKey,
        source: sourceLabel
      };
      break;
    case 'network':
      occurrence = {
        kind: 'network',
        networkId: owner.networkId,
        envKey,
        source: sourceLabel
      };
      break;
    case 'network-service':
      occurrence = {
        kind: 'network-service',
        networkId: owner.networkId,
        serviceSlug: owner.serviceSlug,
        envKey,
        source: sourceLabel
      };
      break;
    case 'app-launch':
      occurrence = {
        kind: 'app-launch',
        networkId: owner.networkId,
        appId: owner.appId,
        envKey,
        source: sourceLabel
      };
      break;
    default: {
      const unexpected: never = owner;
      throw new Error(`Unhandled placeholder owner ${(unexpected as { kind: string }).kind}`);
    }
  }
  entry.occurrences.push(occurrence);
}

function appendConflict(entry: PlaceholderEntry, message: string) {
  if (!entry.conflicts.includes(message)) {
    entry.conflicts.push(message);
  }
}

function applyPlaceholderMetadata(
  entry: PlaceholderEntry,
  metadata: { description?: string; defaultValue?: string },
  sourceLabel: string
) {
  if (metadata.description && !entry.description) {
    entry.description = metadata.description;
  }
  if (metadata.defaultValue !== undefined) {
    if (entry.defaultValue === undefined) {
      entry.defaultValue = metadata.defaultValue;
    } else if (entry.defaultValue !== metadata.defaultValue) {
      appendConflict(
        entry,
        `Conflicting default values for placeholder ${entry.name}: "${entry.defaultValue}" vs "${metadata.defaultValue}" (source ${sourceLabel})`
      );
    }
  }
}

function resolvePlaceholderValue(
  params: {
    entry: PlaceholderEntry;
    owner: PlaceholderOwner;
    envKey: string;
    sourceLabel: string;
    metadataSourceLabel?: string;
    details: { name: string; defaultValue?: string; description?: string };
    variables?: Record<string, string> | null;
  }
): { value?: string; missing: boolean } {
  const { entry, owner, envKey, sourceLabel, metadataSourceLabel, details, variables } = params;
  recordPlaceholderOccurrence(entry, owner, envKey, sourceLabel);
  const metadataSource = metadataSourceLabel ?? sourceLabel;
  applyPlaceholderMetadata(
    entry,
    { description: details.description, defaultValue: details.defaultValue },
    metadataSource
  );

  if (details.defaultValue === undefined) {
    entry.required = true;
  }

  const hasVariable = Boolean(variables && Object.prototype.hasOwnProperty.call(variables, entry.name));
  const providedValue = hasVariable ? (variables as Record<string, string>)[entry.name] : undefined;
  if (hasVariable) {
    const value = providedValue ?? '';
    if (entry.valueSource === 'variable') {
      if (entry.value !== value) {
        appendConflict(
          entry,
          `Conflicting values provided for placeholder ${entry.name}: "${entry.value}" vs "${value}"`
        );
      }
    } else {
      entry.value = value;
      entry.valueSource = 'variable';
    }
    entry.missing = false;
    return { value, missing: false };
  }

  if (details.defaultValue !== undefined) {
    const value = details.defaultValue;
    if (!entry.valueSource) {
      entry.value = value;
      entry.valueSource = 'default';
    } else if (entry.valueSource === 'default' && entry.value !== value) {
      appendConflict(
        entry,
        `Conflicting default values for placeholder ${entry.name}: "${entry.value}" vs "${value}"`
      );
    }
    entry.missing = false;
    return { value, missing: false };
  }

  entry.missing = true;
  return { value: undefined, missing: true };
}

function summarizePlaceholders(
  collector: PlaceholderCollector,
  options: { requireExplicitValues?: boolean } = {}
): ManifestPlaceholderSummary[] {
  const requireExplicit = Boolean(options.requireExplicitValues);
  const summaries = Array.from(collector.values()).map<ManifestPlaceholderSummary>((entry) => {
    const explicitMissing = requireExplicit
      ? entry.required && entry.valueSource !== 'variable'
      : false;
    const missing = entry.missing || (entry.required && entry.value === undefined) || explicitMissing;
    return {
      name: entry.name,
      description: entry.description,
      defaultValue: entry.defaultValue,
      value: entry.value,
      required: entry.required,
      missing,
      occurrences: [...entry.occurrences],
      conflicts: [...entry.conflicts]
    };
  });
  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return Boolean(value && typeof value === 'object' && 'code' in value);
}

function deriveModuleIdFromConfigPath(configPath: string): string {
  const absolutePath = path.resolve(configPath);
  const relativePath = path
    .relative(process.cwd(), absolutePath)
    .replace(/\\/g, '/');
  const base = relativePath.startsWith('..')
    ? path.basename(absolutePath, path.extname(absolutePath))
    : relativePath.replace(/\.json$/i, '');
  const sanitized = base
    .toLowerCase()
    .replace(/[^a-z0-9/_:-]+/g, '-')
    .replace(/--+/g, '-')
    .replace(/^[-/]+/, '')
    .replace(/[-/]+$/, '');
  const identifier = sanitized.length > 0 ? sanitized : 'service-config';
  return `local:${identifier}`;
}

function resolveEnvVars(params: {
  env?: ManifestEnvVarInput[] | null;
  owner: PlaceholderOwner;
  sourceLabel: string;
  collector: PlaceholderCollector;
  metadataLookup?: PlaceholderMetadataLookup;
  variables?: Record<string, string> | null;
  placeholderMode: PlaceholderMode;
  errors: ManifestLoadError[];
}): ResolvedManifestEnvVar[] | undefined {
  const { env, owner, sourceLabel, collector, metadataLookup, variables, placeholderMode, errors } = params;
  if (!env || !Array.isArray(env)) {
    return undefined;
  }

  const resolved: ResolvedManifestEnvVar[] = [];

  for (const entry of env) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }

    const clone: ResolvedManifestEnvVar = { key };

    if (entry.fromService && typeof entry.fromService.service === 'string') {
      const service = entry.fromService.service.trim().toLowerCase();
      if (service) {
        clone.fromService = {
          service,
          property: entry.fromService.property,
          fallback: entry.fromService.fallback
        };
      }
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
      const detection = detectPlaceholder(entry.value as ManifestEnvVarValue, {
        metadataLookup
      });
      if (detection.type === 'literal') {
        clone.value = detection.value;
      } else if (detection.type === 'placeholder') {
        const placeholderName = detection.details.name.trim();
        if (!placeholderName) {
          errors.push({
            source: sourceLabel,
            error: new Error(`placeholder name missing for env ${key}`)
          });
          if (placeholderMode === 'enforce') {
            continue;
          }
        } else {
          const placeholderEntry = ensurePlaceholderEntry(collector, placeholderName);
          const result = resolvePlaceholderValue({
            entry: placeholderEntry,
            owner,
            envKey: key,
            sourceLabel,
            metadataSourceLabel: detection.details.sourceLabel,
            details: {
              name: placeholderName,
              defaultValue: detection.details.defaultValue,
              description: detection.details.description
            },
            variables
          });

          if (placeholderEntry.conflicts.length > 0 && placeholderMode === 'enforce' && !placeholderEntry.conflictNotified) {
            placeholderEntry.conflictNotified = true;
            const message =
              placeholderEntry.conflicts[placeholderEntry.conflicts.length - 1] ??
              `Conflicting values for placeholder ${placeholderName}`;
            errors.push({ source: sourceLabel, error: new Error(message) });
          }

          if (result.value !== undefined) {
            clone.value = result.value;
          }

          if (result.missing) {
            if (placeholderMode === 'enforce' && !placeholderEntry.missingNotified) {
              placeholderEntry.missingNotified = true;
              errors.push({
                source: sourceLabel,
                error: new Error(`placeholder ${placeholderName} requires a value for ${key}`)
              });
            }
            if (placeholderMode === 'enforce') {
              continue;
            }
          }
        }
      }
    }

    if (!clone.value && !clone.fromService && placeholderMode === 'enforce') {
      // invalid entry without value or fromService
      continue;
    }

    resolved.push(clone);
  }

  return resolved.length > 0 ? resolved : undefined;
}

type TagInput = { key: string; value: string };

function cloneTags(tags?: TagInput[] | null): TagInput[] | undefined {
  if (!tags || !Array.isArray(tags)) {
    return undefined;
  }
  return tags
    .filter((tag): tag is TagInput => Boolean(tag && typeof tag.key === 'string' && typeof tag.value === 'string'))
    .map((tag) => ({ key: tag.key, value: tag.value }));
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

type ManifestDescriptorSet = {
  entries: ManifestEntryInput[];
  networks: ManifestServiceNetworkInput[];
};

async function readManifestDescriptors(manifestPath: string): Promise<ManifestDescriptorSet> {
  return readJsonFile(manifestPath, (value) => {
    const parsed = manifestFileSchema.parse(value);
    if (Array.isArray(parsed)) {
      return {
        entries: parsed.map((entry) => ({ ...entry })),
        networks: []
      };
    }
    const services = parsed.services?.map((entry) => ({ ...entry })) ?? [];
    const networks = parsed.networks?.map((network) => ({ ...network })) ?? [];
    return { entries: services, networks };
  });
}

async function readServiceConfig(configPath: string): Promise<ExampleConfigDescriptor> {
  return readJsonFile(configPath, (value) => exampleConfigDescriptorSchema.parse(value));
}

async function resolveConfigFilePath(repoRoot: string, overridePath?: string | null) {
  if (overridePath && overridePath.trim()) {
    return overridePath.trim();
  }
  const candidates = ['config.json', 'service-config.json'];
  for (const candidate of candidates) {
    try {
      await fs.access(path.resolve(repoRoot, candidate));
      return candidate;
    } catch (err) {
      if (!isErrnoException(err) || err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
  return 'service-config.json';
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
  sourceLabel: string,
  options: {
    collector: PlaceholderCollector;
    metadataLookup?: PlaceholderMetadataLookup;
    variables?: Record<string, string> | null;
    placeholderMode: PlaceholderMode;
    errors: ManifestLoadError[];
  }
) {
  for (const entry of entries) {
    const slug = entry.slug.trim().toLowerCase();
    const env = resolveEnvVars({
      env: entry.env,
      owner: { kind: 'service', serviceSlug: slug },
      sourceLabel,
      collector: options.collector,
      metadataLookup: options.metadataLookup,
      variables: options.variables,
      placeholderMode: options.placeholderMode,
      errors: options.errors
    });
    target.push({
      ...entry,
      slug,
      env,
      tags: cloneTags(entry.tags),
      sources: [moduleSource, sourceLabel],
      baseUrlSource: 'manifest'
    });
  }
}

function addManifestNetworks(
  target: LoadedServiceNetwork[],
  networks: ManifestServiceNetworkInput[],
  moduleSource: string,
  sourceLabel: string,
  options: {
    collector: PlaceholderCollector;
    metadataLookup?: PlaceholderMetadataLookup;
    variables?: Record<string, string> | null;
    placeholderMode: PlaceholderMode;
    errors: ManifestLoadError[];
  }
) {
  for (const network of networks) {
    const networkId = network.id.trim().toLowerCase();
    const normalizedServices = network.services.map((service) => {
      const slug = service.serviceSlug.trim().toLowerCase();
      const serviceEnv = resolveEnvVars({
        env: service.env,
        owner: { kind: 'network-service', networkId, serviceSlug: slug },
        sourceLabel,
        collector: options.collector,
        metadataLookup: options.metadataLookup,
        variables: options.variables,
        placeholderMode: options.placeholderMode,
        errors: options.errors
      });
      const launchEnv = resolveEnvVars({
        env: service.app.launchEnv,
        owner: {
          kind: 'app-launch',
          networkId,
          appId: service.app.id.trim().toLowerCase()
        },
        sourceLabel,
        collector: options.collector,
        metadataLookup: options.metadataLookup,
        variables: options.variables,
        placeholderMode: options.placeholderMode,
        errors: options.errors
      });
      return {
        ...service,
        serviceSlug: slug,
        dependsOn: service.dependsOn?.map((dep) => dep.trim().toLowerCase()) ?? undefined,
        env: serviceEnv,
        app: {
          ...service.app,
          id: service.app.id.trim().toLowerCase(),
          tags: cloneTags(service.app.tags),
          launchEnv
        }
      };
    });
    const networkEnv = resolveEnvVars({
      env: network.env,
      owner: { kind: 'network', networkId },
      sourceLabel,
      collector: options.collector,
      metadataLookup: options.metadataLookup,
      variables: options.variables,
      placeholderMode: options.placeholderMode,
      errors: options.errors
    });

    target.push({
      ...network,
      id: networkId,
      services: normalizedServices,
      env: networkEnv,
      tags: cloneTags(network.tags),
      sources: [moduleSource, sourceLabel]
    });
  }
}

async function loadConfigRecursive(options: ConfigLoadOptions): Promise<ConfigLoadResult> {
  const {
    filePath,
    sourceLabel,
    expectedModule,
    visitedModules,
    repoRoot,
    variables,
    placeholderCollector,
    placeholderMetadata,
    placeholderMode
  } = options;
  const errors: ManifestLoadError[] = [];

  let config: ExampleConfigDescriptor;
  try {
    config = await readServiceConfig(filePath);
  } catch (err) {
    errors.push({ source: sourceLabel, error: err as Error });
    return { moduleId: null, entries: [], networks: [], errors, bootstrap: null };
  }

  const moduleId = config.module.trim();
  if (expectedModule && expectedModule !== moduleId) {
    errors.push({
      source: sourceLabel,
      error: new Error(`expected module ${expectedModule} but found ${moduleId}`)
    });
  }

  if (visitedModules.has(moduleId)) {
    return { moduleId, entries: [], networks: [], errors, bootstrap: null };
  }

  visitedModules.set(moduleId, sourceLabel);

  const entries: LoadedManifestEntry[] = [];
  const networks: LoadedServiceNetwork[] = [];
  const bootstrapActions: BootstrapActionSpec[] = [...(config.bootstrap?.actions ?? [])];
  const moduleSource = `module:${moduleId}`;
  const metadataLookup: PlaceholderMetadataLookup = (name) =>
    lookupPlaceholderMetadata(placeholderMetadata, name);

  const configDir = path.dirname(filePath);
  const manifestPathsLoaded = new Set<string>();

  const loadManifestFile = async (manifestRelativePath: string) => {
    const trimmed = manifestRelativePath.trim();
    if (!trimmed) {
      return;
    }
    const manifestFullPath = path.resolve(configDir, trimmed);
    if (manifestPathsLoaded.has(manifestFullPath)) {
      return;
    }
    manifestPathsLoaded.add(manifestFullPath);
    const manifestSourceLabel = joinSourceLabel(sourceLabel, toRepoRelativePath(manifestFullPath, repoRoot));
    try {
      const manifestDescriptors = await readManifestDescriptors(manifestFullPath);
      addManifestEntries(entries, manifestDescriptors.entries, moduleSource, manifestSourceLabel, {
        collector: placeholderCollector,
        metadataLookup,
        variables,
        placeholderMode,
        errors
      });
      addManifestNetworks(networks, manifestDescriptors.networks, moduleSource, manifestSourceLabel, {
        collector: placeholderCollector,
        metadataLookup,
        variables,
        placeholderMode,
        errors
      });
    } catch (err) {
      errors.push({ source: manifestSourceLabel, error: err as Error });
    }
  };

  for (const placeholder of config.placeholders ?? []) {
    registerPlaceholderMetadata(
      placeholderMetadata,
      {
        name: placeholder.name,
        description: placeholder.description,
        defaultValue: placeholder.default,
        sourceLabel
      },
      errors
    );
  }

  if (config.services?.length) {
    addManifestEntries(entries, config.services, moduleSource, sourceLabel, {
      collector: placeholderCollector,
      metadataLookup,
      variables,
      placeholderMode,
      errors
    });
  }

  if (config.networks?.length) {
    addManifestNetworks(networks, config.networks, moduleSource, sourceLabel, {
      collector: placeholderCollector,
      metadataLookup,
      variables,
      placeholderMode,
      errors
    });
  }

  if (config.manifests?.length) {
    for (const manifest of config.manifests) {
      if (manifest.kind === 'bundle') {
        // Bundles are handled by the job importer; skip them here so service manifest imports do not fail.
        continue;
      }
      await loadManifestFile(manifest.path);
    }
  }

  if (config.manifestPath) {
    await loadManifestFile(config.manifestPath);
  }

  for (const child of config.imports ?? []) {
    if (visitedModules.has(child.module)) {
      continue;
    }
    const childResult = await loadConfigImport(child, visitedModules, {
      placeholderCollector,
      placeholderMetadata,
      placeholderMode,
      expectedModuleOverride: undefined
    });
    entries.push(...childResult.entries);
    networks.push(...childResult.networks);
    errors.push(...childResult.errors);
    if (childResult.bootstrap?.actions?.length) {
      bootstrapActions.push(...childResult.bootstrap.actions);
    }
  }

  const bootstrapPlan = bootstrapActions.length > 0 ? { actions: bootstrapActions } : null;

  return { moduleId, entries, networks, errors, bootstrap: bootstrapPlan };
}

async function loadConfigImport(
  importConfig: ServiceConfigImport,
  visitedModules: VisitedModules,
  options: {
    expectedModuleOverride?: string | null;
    placeholderCollector: PlaceholderCollector;
    placeholderMetadata: PlaceholderMetadataStore;
    placeholderMode: PlaceholderMode;
  }
) {
  const errors: ManifestLoadError[] = [];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-service-config-'));
  let moduleId: string | null = null;
  let entries: LoadedManifestEntry[] = [];
  let networks: LoadedServiceNetwork[] = [];
  let resolvedCommit: string | null = null;
  let bootstrap: BootstrapPlanSpec | null = null;
  try {
    let repoRoot: string;
    let sourceLabelBase: string;

    if (importConfig.repo) {
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

      repoRoot = tempDir;
      const baseLabel = `git:${importConfig.repo}`;
      const commitLabel = resolvedCommit ?? importConfig.commit ?? importConfig.ref ?? 'HEAD';
      sourceLabelBase = `${baseLabel}#${commitLabel}`;
    } else if (importConfig.path) {
      repoRoot = path.resolve(importConfig.path);
      sourceLabelBase = `path:${repoRoot}`;
    } else {
      throw new Error('service import must provide either a git repository or a local path');
    }

    const configPathRelative = await resolveConfigFilePath(repoRoot, importConfig.configPath);
    const configFilePath = path.resolve(repoRoot, configPathRelative);
    const sourceLabel = joinSourceLabel(sourceLabelBase, configPathRelative);
    const expectedModule =
      options.expectedModuleOverride === undefined ? importConfig.module : options.expectedModuleOverride;
    const result = await loadConfigRecursive({
      filePath: configFilePath,
      sourceLabel,
      expectedModule,
      visitedModules,
      repoRoot,
      variables: importConfig.variables ?? null,
      placeholderCollector: options.placeholderCollector,
      placeholderMetadata: options.placeholderMetadata,
      placeholderMode: options.placeholderMode
    });
    moduleId = result.moduleId;
    entries = result.entries;
    networks = result.networks;
    errors.push(...result.errors);
    bootstrap = result.bootstrap;
  } catch (err) {
    const sourceLabel = importConfig.repo
      ? `git:${importConfig.repo}`
      : importConfig.path
        ? `path:${path.resolve(importConfig.path)}`
        : 'service-import';
    errors.push({
      source: sourceLabel,
      error: err as Error
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  return { moduleId, entries, networks, errors, resolvedCommit, bootstrap };
}

export type ServiceConfigImportRequest = {
  repo?: string | null;
  path?: string | null;
  ref?: string | null;
  commit?: string | null;
  configPath?: string | null;
  module?: string | null;
  variables?: Record<string, string> | null;
  requirePlaceholderValues?: boolean | null;
};

export type ServiceConfigImportPreview = {
  moduleId: string;
  resolvedCommit: string | null;
  entries: LoadedManifestEntry[];
  networks: LoadedServiceNetwork[];
  errors: ManifestLoadError[];
  placeholders: ManifestPlaceholderSummary[];
  bootstrap: BootstrapPlanSpec | null;
};

export async function previewServiceConfigImport(
  payload: ServiceConfigImportRequest
): Promise<ServiceConfigImportPreview> {
  const expectedModule = payload.module?.trim() || null;
  const importConfig: ServiceConfigImport = {
    module: expectedModule ?? '__preview__',
    repo: payload.repo?.trim() || undefined,
    path: payload.path?.trim() || undefined,
    ref: payload.ref?.trim() || undefined,
    commit: payload.commit?.trim() ? payload.commit.trim() : undefined,
    configPath: payload.configPath?.trim() || undefined,
    variables: payload.variables ?? undefined
  };

  const visitedModules: VisitedModules = new Map();
  const placeholderCollector = createPlaceholderCollector();
  const placeholderMetadata = createPlaceholderMetadataStore();
  const result = await loadConfigImport(importConfig, visitedModules, {
    expectedModuleOverride: expectedModule,
    placeholderCollector,
    placeholderMetadata,
    placeholderMode: 'collect'
  });
  if (!result.moduleId) {
    const firstError = result.errors[0];
    if (firstError) {
      const sourceHint = firstError.source ? `${firstError.source}: ` : '';
      throw new Error(
        `${sourceHint}${firstError.error.message || 'failed to resolve module id from service configuration'}`
      );
    }
    throw new Error('failed to resolve module id from service configuration');
  }

  if (expectedModule && expectedModule !== result.moduleId) {
    const sourceLabel = payload.repo
      ? `git:${payload.repo}`
      : payload.path
        ? `path:${payload.path}`
        : 'service-import';
    result.errors.push({
      source: sourceLabel,
      error: new Error(`requested module ${expectedModule} but config exports ${result.moduleId}`)
    });
  }

  const placeholders = summarizePlaceholders(placeholderCollector, {
    requireExplicitValues: Boolean(payload.requirePlaceholderValues)
  });

  return {
    moduleId: result.moduleId,
    resolvedCommit: result.resolvedCommit ?? null,
    entries: result.entries,
    networks: result.networks,
    errors: result.errors,
    placeholders,
    bootstrap: result.bootstrap ?? null
  };
}
