import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  addRepository,
  deleteServiceNetwork,
  getRepositoryById,
  getServiceBySlug,
  getLatestServiceHealthSnapshots,
  listActiveServiceManifests,
  listAllServiceNetworks,
  listServiceNetworksByModule,
  listServices,
  replaceRepositoryTags,
  replaceServiceNetworkMembers,
  replaceModuleManifests,
  recordServiceHealthSnapshot,
  setRepositoryStatus,
  setServiceStatus,
  upsertRepository,
  upsertService,
  upsertServiceNetwork,
  updateRepositoryLaunchEnvTemplates,
  upsertModuleResourceContext,
  type JsonValue,
  type LaunchEnvVar,
  type RepositoryRecord,
  type RepositoryMetadataStrategy,
  type ServiceHealthSnapshotRecord,
  type ServiceRecord,
  type ServiceManifestStoreInput,
  type ServiceManifestStoreRecord,
  type ServiceNetworkRecord,
  type ServiceUpsertInput,
  type TagKV,
  type ServiceNetworkMemberInput
} from './db/index';
import { enqueueRepositoryIngestion } from './queue';
import { type LoadedManifestEntry, type LoadedServiceNetwork } from './serviceConfigLoader';
import {
  manifestEnvVarSchema,
  type ManifestEnvVarInput,
  type ResolvedManifestEnvVar
} from './serviceManifestTypes';
import {
  coerceServiceMetadata,
  mergeServiceMetadata,
  serviceManifestMetadataSchema,
  type ServiceMetadata
} from './serviceMetadata';
import {
  publishServiceRegistryInvalidation,
  subscribeToServiceRegistryInvalidations,
  type ServiceRegistryInvalidationMessage
} from './serviceRegistry/invalidationBus';

const HEALTH_INTERVAL_MS = Number(process.env.SERVICE_HEALTH_INTERVAL_MS ?? 30_000);
const HEALTH_TIMEOUT_MS = Number(process.env.SERVICE_HEALTH_TIMEOUT_MS ?? 5_000);
const OPENAPI_REFRESH_INTERVAL_MS = Number(process.env.SERVICE_OPENAPI_REFRESH_INTERVAL_MS ?? 15 * 60_000);
const MANIFEST_CACHE_TTL_MS = Number(process.env.SERVICE_REGISTRY_CACHE_TTL_MS ?? 5_000);
const HEALTH_CACHE_TTL_MS = Number(process.env.SERVICE_HEALTH_CACHE_TTL_MS ?? 10_000);
type ManifestEntry = LoadedManifestEntry;

type ManifestMap = Map<string, ManifestEntry>;

type ManifestStateCache = {
  entries: ManifestMap;
  networks: LoadedServiceNetwork[];
  fetchedAt: number;
  expiresAt: number;
};

type HealthSnapshotCache = {
  snapshots: Map<string, ServiceHealthSnapshotRecord>;
  fetchedAt: number;
  expiresAt: number;
};

type HealthCheckOutcome = {
  status: 'healthy' | 'degraded' | 'unreachable';
  statusMessage: string | null;
  latencyMs: number | null;
  statusCode?: number;
  error?: Error;
  openapi?: {
    hash: string;
    version: string | null;
    fetchedAt: string;
    bytes: number;
    url: string;
    schema: JsonValue | null;
  } | null;
};

type PollerController = {
  stop: () => void;
  isRunning: () => boolean;
};

let manifestStateCache: ManifestStateCache | null = null;
let healthSnapshotCache: HealthSnapshotCache | null = null;
let manifestEntries: ManifestMap = new Map();
let manifestNetworks: LoadedServiceNetwork[] = [];
let poller: PollerController | null = null;
let isPolling = false;
const repositoryToServiceSlug = new Map<string, string>();
let unsubscribeInvalidation: (() => void) | null = null;

type ModuleContext = {
  moduleId: string;
  moduleVersion: string | null;
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0.0.0.0']);

function deepCloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function computeStableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function toManifestStoreInput(entry: LoadedManifestEntry): ServiceManifestStoreInput {
  const clone = cloneLoadedManifestEntry(entry);
  const jsonDefinition = deepCloneJson(clone) as JsonValue;
  return {
    serviceSlug: clone.slug.trim().toLowerCase(),
    definition: jsonDefinition,
    checksum: computeStableHash(jsonDefinition)
  } satisfies ServiceManifestStoreInput;
}

function parseStoredManifest(record: ServiceManifestStoreRecord): LoadedManifestEntry {
  const definition = deepCloneJson(record.definition) as LoadedManifestEntry;
  const cloned = cloneLoadedManifestEntry(definition);
  const moduleVersion = record.moduleVersion === null || record.moduleVersion === undefined
    ? null
    : String(record.moduleVersion);
  cloned.module = {
    id: record.moduleId,
    version: moduleVersion
  };
  const moduleSource = `module:${record.moduleId}`;
  if (!Array.isArray(cloned.sources) || cloned.sources.length === 0) {
    cloned.sources = [moduleSource];
  } else if (!cloned.sources.some((source) => source.startsWith('module:'))) {
    cloned.sources = [moduleSource, ...cloned.sources];
  }
  return cloned;
}

function buildNetworkStoreDefinition(network: LoadedServiceNetwork): {
  definition: JsonValue;
  checksum: string;
} {
  const clone = cloneLoadedServiceNetwork(network);
  const jsonDefinition = deepCloneJson(clone) as JsonValue;
  return {
    definition: jsonDefinition,
    checksum: computeStableHash(jsonDefinition)
  };
}

function parseStoredNetwork(record: ServiceNetworkRecord): LoadedServiceNetwork | null {
  if (!record.definition) {
    return null;
  }
  try {
    const definition = deepCloneJson(record.definition) as LoadedServiceNetwork;
    return cloneLoadedServiceNetwork(definition);
  } catch (err) {
    log('warn', 'failed to parse stored service network definition', {
      repositoryId: record.repositoryId,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

function ensureInvalidationSubscription(): void {
  if (unsubscribeInvalidation) {
    return;
  }
  unsubscribeInvalidation = subscribeToServiceRegistryInvalidations((message, source) => {
    handleInvalidation(message, source);
  });
}

async function broadcastInvalidation(
  message: ServiceRegistryInvalidationMessage,
  options: { skipLocal?: boolean } = {}
): Promise<void> {
  if (!options.skipLocal) {
    handleInvalidation(message, 'local');
  }
  await publishServiceRegistryInvalidation(message, { skipLocal: true });
}

function handleInvalidation(
  message: ServiceRegistryInvalidationMessage,
  source: 'local' | 'remote'
): void {
  if (message.kind === 'manifest') {
    manifestStateCache = null;
    manifestEntries = new Map();
    manifestNetworks = [];
    repositoryToServiceSlug.clear();
  } else if (message.kind === 'health') {
    if (message.slug && healthSnapshotCache) {
      healthSnapshotCache.snapshots.delete(message.slug);
    } else {
      healthSnapshotCache = null;
    }
  } else if (message.kind === 'module-context') {
    // module context invalidations are consumed by subscribers; no cache to clear yet.
  }

  if (source === 'remote') {
    if (message.kind === 'manifest') {
      log('info', 'cache invalidation received', { scope: 'manifest', reason: message.reason });
    } else if (message.kind === 'health') {
      log('info', 'cache invalidation received', {
        scope: 'health',
        reason: message.reason,
        slug: message.slug ?? null
      });
    } else {
      log('info', 'cache invalidation received', {
        scope: 'module-context',
        moduleId: message.moduleId,
        resourceType: message.resourceType,
        resourceId: message.resourceId,
        action: message.action
      });
    }
  }
}

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function rewriteLoopbackHost(urlValue: string | null | undefined): string | null {
  if (!urlValue) {
    return null;
  }

  try {
    const parsed = new URL(urlValue);
    const hostname = parsed.hostname.toLowerCase();

    if (LOOPBACK_HOSTS.has(hostname) || hostname.startsWith('127.')) {
      parsed.hostname = 'host.docker.internal';
      return parsed.toString();
    }
    return urlValue;
  } catch {
    if (urlValue.includes('localhost')) {
      return urlValue.replace(/localhost/gi, 'host.docker.internal');
    }
    return urlValue;
  }
}

function buildBaseUrlFromHostPort(hostValue: string | null | undefined, portValue: number | null | undefined): string | null {
  if (!hostValue) {
    return null;
  }
  const trimmedHost = hostValue.trim();
  if (!trimmedHost) {
    return null;
  }
  const numericPort = typeof portValue === 'number' && Number.isFinite(portValue) ? portValue : null;
  if (!numericPort) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmedHost)) {
    try {
      const url = new URL(trimmedHost);
      url.port = String(numericPort);
      return url.toString();
    } catch {
      return null;
    }
  }

  return `http://${trimmedHost}:${numericPort}`;
}

function toNumber(value: JsonValue | null | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function collectHealthBaseUrls(
  service: ServiceRecord,
  runtimeMeta: Record<string, JsonValue>,
  manifest: ManifestEntry | undefined
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (value: unknown, options?: { rewriteLoopback?: boolean }) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }

    const addCandidate = (candidate: string | null | undefined) => {
      const normalized = candidate?.trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      candidates.push(normalized);
    };

    const shouldRewrite = options?.rewriteLoopback !== false;
    const rewritten = shouldRewrite ? rewriteLoopbackHost(trimmed) : trimmed;
    const resolved = (rewritten ?? trimmed).trim();

    addCandidate(resolved);

    if (shouldRewrite && resolved !== trimmed) {
      addCandidate(trimmed);
    }
  };

  const containerBaseUrl = typeof runtimeMeta.containerBaseUrl === 'string' ? runtimeMeta.containerBaseUrl : null;
  push(containerBaseUrl, { rewriteLoopback: false });

  const containerIp = typeof runtimeMeta.containerIp === 'string' ? runtimeMeta.containerIp : null;
  const containerPort = toNumber(runtimeMeta.containerPort ?? null);
  if (containerIp && containerPort) {
    push(`http://${containerIp}:${containerPort}`, { rewriteLoopback: false });
  }

  const instanceUrl = typeof runtimeMeta.instanceUrl === 'string' ? runtimeMeta.instanceUrl : null;
  const runtimeBaseUrl = typeof runtimeMeta.baseUrl === 'string' ? runtimeMeta.baseUrl : null;
  const previewUrl = typeof runtimeMeta.previewUrl === 'string' ? runtimeMeta.previewUrl : null;
  const runtimeHost = typeof runtimeMeta.host === 'string' ? runtimeMeta.host : null;
  const runtimePort = toNumber(runtimeMeta.port ?? null);

  push(instanceUrl);
  push(runtimeBaseUrl);
  push(previewUrl);
  push(buildBaseUrlFromHostPort(runtimeHost, runtimePort));

  push(service.baseUrl);
  if (manifest?.baseUrl) {
    push(manifest.baseUrl);
  }

  if (candidates.length === 0 && service.baseUrl) {
    candidates.push(service.baseUrl);
  }

  return candidates;
}

const log = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => {
  const payload = meta ? { ...meta } : undefined;
  const prefix = '[service-registry]';
  switch (level) {
    case 'info':
      if (payload) {
        console.log(prefix, message, payload);
      } else {
        console.log(prefix, message);
      }
      break;
    case 'warn':
      if (payload) {
        console.warn(prefix, message, payload);
      } else {
        console.warn(prefix, message);
      }
      break;
    case 'error':
      if (payload) {
        console.error(prefix, message, payload);
      } else {
        console.error(prefix, message);
      }
      break;
  }
};

type EnvVar = ResolvedManifestEnvVar;

function normalizeEnvReference(
  entry: ManifestEnvVarInput['fromService']
): ResolvedManifestEnvVar['fromService'] | undefined {
  if (!entry) {
    return undefined;
  }
  const service = entry.service?.trim().toLowerCase();
  if (!service) {
    return undefined;
  }
  return {
    service,
    property: entry.property,
    fallback: entry.fallback
  };
}

function extractPlaceholderDefault(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const placeholder = (value as { $var?: { default?: unknown } }).$var;
  const defaultValue = placeholder?.default;
  return typeof defaultValue === 'string' ? defaultValue : undefined;
}

function cloneEnvVars(env?: ManifestEnvVarInput[] | null): EnvVar[] | undefined {
  if (!env || !Array.isArray(env)) {
    return undefined;
  }
  return env
    .filter((entry): entry is ManifestEnvVarInput => Boolean(entry && typeof entry.key === 'string'))
    .map((entry) => {
      const key = entry.key.trim();
      if (!key) {
        return { key: '' } as EnvVar;
      }
    const clone: EnvVar = { key };
    if (typeof entry.value === 'string') {
      clone.value = entry.value;
    } else {
      const placeholderDefault = extractPlaceholderDefault(entry.value);
      if (placeholderDefault !== undefined) {
        clone.value = placeholderDefault;
      }
    }
    const ref = normalizeEnvReference(entry.fromService);
    if (ref) {
      clone.fromService = ref;
    }
    return clone;
  })
  .filter((entry) => entry.key.length > 0 && (entry.value !== undefined || entry.fromService !== undefined));
}

function toLaunchEnvVars(env?: EnvVar[] | null): LaunchEnvVar[] {
  if (!env || env.length === 0) {
    return [];
  }
  const seen = new Map<string, string>();
  for (const entry of env) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    let value: string | undefined;
    if (entry.value !== undefined) {
      value = entry.value;
    }
    if (value === undefined && entry.fromService?.fallback !== undefined) {
      value = entry.fromService.fallback;
    }
    if (value === undefined) {
      continue;
    }
    seen.set(key, value);
    if (seen.size >= 64) {
      break;
    }
  }
  return Array.from(seen.entries()).map(([key, value]) => ({ key, value }));
}

function normalizeTags(tags?: TagKV[] | null): TagKV[] {
  if (!tags || tags.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: TagKV[] = [];
  for (const tag of tags) {
    if (!tag || typeof tag.key !== 'string' || typeof tag.value !== 'string') {
      continue;
    }
    const key = tag.key.trim();
    const value = tag.value.trim();
    if (!key || !value) {
      continue;
    }
    const fingerprint = `${key}:${value}`;
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    normalized.push({ key, value });
  }
  return normalized;
}

function cloneTags(tags?: { key: string; value: string }[] | null) {
  if (!tags || !Array.isArray(tags)) {
    return undefined;
  }
  return tags
    .filter((tag): tag is { key: string; value: string } => Boolean(tag && typeof tag.key === 'string' && typeof tag.value === 'string'))
    .map((tag) => ({ key: tag.key, value: tag.value }));
}

function applyEnvOverrides(entry: ManifestEntry): ManifestEntry {
  const envKey = entry.slug
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  const baseUrlOverride = process.env[`SERVICE_${envKey}_BASE_URL`];
  if (baseUrlOverride && baseUrlOverride.trim().length > 0) {
    const normalized = baseUrlOverride.trim();
    if (normalized !== entry.baseUrl) {
      log('info', 'service base URL override applied', {
        slug: entry.slug,
        from: entry.baseUrl,
        to: normalized,
        env: `SERVICE_${envKey}_BASE_URL`
      });
    }
    entry.baseUrl = normalized;
    entry.baseUrlSource = 'env';
  }
  return entry;
}

function mergeManifestEntries(entries: ManifestEntry[]): ManifestMap {
  const merged: ManifestMap = new Map();
  for (const incoming of entries) {
    const slug = incoming.slug.trim().toLowerCase();
    if (!slug) {
      continue;
    }
    const existing = merged.get(slug);
    if (!existing) {
      merged.set(slug, { ...incoming, slug });
      continue;
    }
    merged.set(slug, {
      ...existing,
      ...incoming,
      slug,
      sources: [...existing.sources, ...incoming.sources],
      baseUrlSource: incoming.baseUrlSource ?? existing.baseUrlSource
    });
  }
  return merged;
}

async function loadManifestState(options?: { force?: boolean }): Promise<ManifestStateCache> {
  const force = options?.force ?? false;
  const now = Date.now();

  if (!force && manifestStateCache && manifestStateCache.expiresAt > now) {
    return manifestStateCache;
  }

  const aggregatedEntries: ManifestEntry[] = [];
  try {
    const records = await listActiveServiceManifests();
    for (const record of records) {
      try {
        const entry = parseStoredManifest(record);
        aggregatedEntries.push(applyEnvOverrides(entry));
      } catch (err) {
        log('warn', 'failed to parse stored manifest entry', {
          moduleId: record.moduleId,
          serviceSlug: record.serviceSlug,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  } catch (err) {
    log('error', 'failed to load service manifests from database', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }

  const mergedEntries = mergeManifestEntries(aggregatedEntries);

  const networks: LoadedServiceNetwork[] = [];
  try {
    const records = await listAllServiceNetworks();
    for (const record of records) {
      const parsed = parseStoredNetwork(record);
      if (parsed) {
        networks.push(parsed);
      }
    }
  } catch (err) {
    log('error', 'failed to load service networks from database', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err;
  }

  const state: ManifestStateCache = {
    entries: mergedEntries,
    networks,
    fetchedAt: now,
    expiresAt: now + MANIFEST_CACHE_TTL_MS
  };

  manifestStateCache = state;
  manifestEntries = mergedEntries;
  manifestNetworks = networks;

  rebuildRepositoryToServiceSlugFromNetworks(networks);

  return state;
}

async function rebuildManifestState(options?: { force?: boolean }): Promise<{
  entries: ManifestMap;
  networks: LoadedServiceNetwork[];
}> {
  const state = await loadManifestState(options);
  return { entries: state.entries, networks: state.networks };
}

function rebuildRepositoryToServiceSlugFromNetworks(networks: LoadedServiceNetwork[]): void {
  repositoryToServiceSlug.clear();
  for (const network of networks) {
    if (!network?.services) {
      continue;
    }
    for (const service of network.services) {
      const repositoryId = normalizeRepositoryId(service?.app?.id);
      if (!repositoryId) {
        continue;
      }
      if (service?.serviceSlug) {
        repositoryToServiceSlug.set(repositoryId, service.serviceSlug);
      }
    }
  }
}

async function getHealthSnapshots(
  slugs: string[]
): Promise<Map<string, ServiceHealthSnapshotRecord>> {
  const normalized = Array.from(
    new Set(
      slugs
        .map((slug) => slug.trim().toLowerCase())
        .filter((slug) => slug.length > 0)
    )
  );

  if (normalized.length === 0) {
    return new Map();
  }

  const now = Date.now();
  if (healthSnapshotCache && healthSnapshotCache.expiresAt > now) {
    const cached = new Map<string, ServiceHealthSnapshotRecord>();
    let allPresent = true;
    for (const slug of normalized) {
      const record = healthSnapshotCache.snapshots.get(slug);
      if (record) {
        cached.set(slug, record);
      } else {
        allPresent = false;
        break;
      }
    }
    if (allPresent) {
      return cached;
    }
  }

  const snapshots = await getLatestServiceHealthSnapshots(normalized);
  healthSnapshotCache = {
    snapshots: new Map(snapshots),
    fetchedAt: now,
    expiresAt: now + HEALTH_CACHE_TTL_MS
  };
  return snapshots;
}

function cloneResolvedEnvVars(env?: ResolvedManifestEnvVar[] | null): ResolvedManifestEnvVar[] | undefined {
  if (!env || env.length === 0) {
    return undefined;
  }
  return env
    .filter((entry): entry is ResolvedManifestEnvVar => Boolean(entry && typeof entry.key === 'string'))
    .map((entry) => ({
      key: entry.key,
      value: entry.value,
      fromService: entry.fromService
        ? {
            service: entry.fromService.service,
            property: entry.fromService.property,
            fallback: entry.fromService.fallback
          }
        : undefined
    }));
}

function cloneLoadedManifestEntry(entry: LoadedManifestEntry): LoadedManifestEntry {
  const moduleContext = entry.module
    ? { id: entry.module.id, version: entry.module.version ?? null }
    : undefined;
  return {
    ...entry,
    env: cloneResolvedEnvVars(entry.env),
    sources: Array.isArray(entry.sources) ? [...entry.sources] : [],
    tags: cloneTags(entry.tags),
    metadata: entry.metadata ? { ...(entry.metadata as Record<string, JsonValue>) } : entry.metadata,
    module: moduleContext
  };
}

function resolveModuleContextFromEntry(entry: LoadedManifestEntry): ModuleContext | null {
  const explicitModuleId = entry.module?.id?.trim();
  if (explicitModuleId) {
    const explicitVersion = entry.module?.version && entry.module.version.trim()
      ? entry.module.version.trim()
      : null;
    return {
      moduleId: explicitModuleId,
      moduleVersion: explicitVersion
    } satisfies ModuleContext;
  }
  if (Array.isArray(entry.sources)) {
    const moduleSource = entry.sources.find((source) => source.startsWith('module:'));
    if (moduleSource) {
      const inferredModuleId = moduleSource.slice('module:'.length).trim();
      if (inferredModuleId) {
        return {
          moduleId: inferredModuleId,
          moduleVersion: null
        } satisfies ModuleContext;
      }
    }
  }
  return null;
}

function buildServiceModuleContextMetadata(
  entry: LoadedManifestEntry,
  record: ServiceRecord
): JsonValue {
  const metadata: Record<string, JsonValue> = {
    sources: Array.isArray(entry.sources) ? entry.sources : [],
    kind: entry.kind,
    baseUrl: record.baseUrl,
    status: record.status,
    source: record.source,
    baseUrlSource: entry.baseUrlSource
  } satisfies Record<string, JsonValue>;

  if (entry.tags && entry.tags.length > 0) {
    metadata.tags = entry.tags as unknown as JsonValue;
  }

  if (entry.metadata !== undefined) {
    metadata.manifest = entry.metadata as JsonValue;
  }

  if (entry.capabilities !== undefined) {
    metadata.capabilities = entry.capabilities as JsonValue;
  }

  return metadata;
}

function cloneLoadedServiceNetwork(network: LoadedServiceNetwork): LoadedServiceNetwork {
  return {
    ...network,
    env: cloneResolvedEnvVars(network.env),
    tags: cloneTags(network.tags),
    sources: Array.isArray(network.sources) ? [...network.sources] : [],
    services: network.services.map((service) => ({
      ...service,
      dependsOn: service.dependsOn ? [...service.dependsOn] : undefined,
      env: cloneResolvedEnvVars(service.env),
      app: {
        ...service.app,
        tags: cloneTags(service.app.tags),
        launchEnv: cloneResolvedEnvVars(service.app.launchEnv)
      }
    }))
  };
}

export type ManifestImportResult = {
  servicesApplied: number;
  networksApplied: number;
  moduleVersion: string;
};

export async function importServiceManifestModule(options: {
  moduleId: string;
  entries: LoadedManifestEntry[];
  networks: LoadedServiceNetwork[];
}): Promise<ManifestImportResult> {
  const moduleId = options.moduleId.trim();
  if (!moduleId) {
    throw new Error('moduleId is required for service manifest import');
  }

  const manifestInputs = options.entries.map((entry) => toManifestStoreInput(entry));
  const moduleVersion = await replaceModuleManifests(moduleId, manifestInputs);

  const clonedNetworks = options.networks.map(cloneLoadedServiceNetwork);
  await syncNetworksFromManifest(moduleId, moduleVersion, clonedNetworks);

  const { entries, networks } = await rebuildManifestState({ force: true });

  await applyManifestToDatabase(entries);
  await updateServiceManifestAppReferences(networks, entries);

  await broadcastInvalidation({ kind: 'manifest', reason: 'module-import', moduleId }, { skipLocal: true });

  return {
    servicesApplied: entries.size,
    networksApplied: networks.length,
    moduleVersion: String(moduleVersion)
  };
}

export function resetServiceManifestState(): void {
  manifestStateCache = null;
  manifestEntries = new Map();
  manifestNetworks = [];
  repositoryToServiceSlug.clear();
}

function removeUndefined<T extends Record<string, unknown>>(input: T): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    result[key] = value as JsonValue;
  }
  return result;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) {
    return true;
  }
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (valueType === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (!isJsonValue(entry)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

export type ServiceRuntimeSnapshot = {
  repositoryId: string;
  launchId: string | null;
  instanceUrl: string | null;
  baseUrl: string | null;
  previewUrl?: string | null;
  host: string | null;
  port: number | null;
  containerIp?: string | null;
  containerPort?: number | null;
  containerBaseUrl?: string | null;
  source?: string;
};

function serializeManifestEnvVars(env?: ResolvedManifestEnvVar[] | null): ManifestEnvVarInput[] | null {
  if (!env || env.length === 0) {
    return null;
  }

  const normalized: ManifestEnvVarInput[] = [];

  for (const entry of env) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }

    const key = entry.key.trim();
    if (!key) {
      continue;
    }

    const result: ManifestEnvVarInput = { key };

    if (entry.value !== undefined) {
      result.value = entry.value;
    }

    if (entry.fromService && typeof entry.fromService.service === 'string') {
      const service = entry.fromService.service.trim().toLowerCase();
      if (service) {
        result.fromService = {
          service,
          property: entry.fromService.property,
          fallback: entry.fromService.fallback
        };
      }
    }

    if (result.value === undefined && !result.fromService) {
      continue;
    }

    normalized.push(result);
  }

  return normalized.length > 0 ? normalized : null;
}

export function resolvePortFromManifestEnv(env: unknown): number | null {
  if (!Array.isArray(env)) {
    return null;
  }

  for (const entry of env) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const keyRaw = record.key;
    if (typeof keyRaw !== 'string') {
      continue;
    }
    const key = keyRaw.trim().toLowerCase();
    if (key !== 'port') {
      continue;
    }

    const directPort = parsePortValue(record.value);
    if (directPort) {
      return directPort;
    }

    const value = record.value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const placeholder = (value as { $var?: { default?: unknown } }).$var;
      if (placeholder && typeof placeholder.default !== 'undefined') {
        const placeholderPort = parsePortValue(placeholder.default);
        if (placeholderPort) {
          return placeholderPort;
        }
      }
    }
  }

  return null;
}

function extractPortFromBaseUrl(baseUrl: string | null | undefined): number | null {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(baseUrl);
    const inferred = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    return parsePortValue(inferred);
  } catch {
    return null;
  }
}

function buildManifestMetadata(entry: ManifestEntry) {
  const env = serializeManifestEnvVars(entry.env);
  return removeUndefined({
    source: entry.sources[entry.sources.length - 1] ?? null,
    sources: entry.sources,
    devCommand: entry.devCommand ?? null,
    workingDir: entry.workingDir ?? null,
    healthEndpoint: entry.healthEndpoint ?? null,
    openapiPath: entry.openapiPath ?? null,
    baseUrlSource: entry.baseUrlSource,
    env: env ?? null
  });
}

function parseManifestEnvList(value: unknown): ManifestEnvVarInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries: ManifestEnvVarInput[] = [];
  for (const candidate of value) {
    const parsed = manifestEnvVarSchema.safeParse(candidate);
    if (parsed.success) {
      entries.push(parsed.data);
    }
  }
  return entries.length > 0 ? entries : null;
}

function manifestInputsToLaunchEnv(
  env?: ManifestEnvVarInput[] | null
): LaunchEnvVar[] {
  if (!env || env.length === 0) {
    return [];
  }
  const cloned = cloneEnvVars(env);
  if (!cloned || cloned.length === 0) {
    return [];
  }
  return toLaunchEnvVars(cloned);
}

function stripAppliedAt(value: JsonValue | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const clone: Record<string, JsonValue> = { ...(value as Record<string, JsonValue>) };
  delete clone.appliedAt;
  return clone;
}

async function applyManifestToDatabase(entries: ManifestMap) {
  for (const entry of entries.values()) {
    const existing = await getServiceBySlug(entry.slug);
    const existingMetadata = coerceServiceMetadata(existing?.metadata ?? null);
    const previousManifest = existingMetadata?.manifest;
    const manifestMeta = buildManifestMetadata(entry);
    const comparablePrevious = stripAppliedAt(previousManifest as JsonValue | undefined);
    const manifestChanged =
      JSON.stringify(comparablePrevious ?? null) !== JSON.stringify(manifestMeta);
    const appliedAt =
      !manifestChanged && previousManifest && typeof previousManifest === 'object'
        ? ((previousManifest as Record<string, JsonValue>).appliedAt as string | undefined) ?? new Date().toISOString()
        : new Date().toISOString();

    const manifestUpdate = serviceManifestMetadataSchema.parse({
      ...manifestMeta,
      appliedAt
    });

    const metadataUpdate: ServiceMetadata = {
      resourceType: 'service',
      manifest: manifestUpdate
    };

    if (Object.prototype.hasOwnProperty.call(entry, 'metadata')) {
      metadataUpdate.config = (entry.metadata ?? null) as JsonValue | null;
    }

    const mergedMetadata = mergeServiceMetadata(existing?.metadata ?? null, metadataUpdate);

    const upsertPayload: ServiceUpsertInput = {
      slug: entry.slug,
      displayName: entry.displayName,
      kind: entry.kind,
      baseUrl: entry.baseUrl,
      source: 'external',
      metadata: mergedMetadata,
      status: existing?.status,
      statusMessage: existing?.statusMessage
    };

    if (Object.prototype.hasOwnProperty.call(entry, 'capabilities')) {
      upsertPayload.capabilities = entry.capabilities ?? null;
    }

    const record = await upsertService(upsertPayload);
    const action = existing ? 'updated' : 'registered';
    log('info', `service manifest ${action}`, {
      slug: record.slug,
      baseUrl: record.baseUrl,
      source: manifestUpdate.source ?? null
    });

    const moduleContext = resolveModuleContextFromEntry(entry);
    if (moduleContext) {
      try {
        await upsertModuleResourceContext({
          moduleId: moduleContext.moduleId,
          moduleVersion: moduleContext.moduleVersion,
          resourceType: 'service',
          resourceId: record.id,
          resourceSlug: record.slug,
          resourceName: record.displayName,
          resourceVersion: moduleContext.moduleVersion,
          metadata: buildServiceModuleContextMetadata(entry, record)
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log('warn', 'failed to upsert module resource context for service', {
          slug: record.slug,
          moduleId: moduleContext.moduleId,
          moduleVersion: moduleContext.moduleVersion,
          error: errorMessage
        });
      }
    }
  }
}

async function ensureRepositoryFromManifest(options: {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  tags: TagKV[];
  envTemplates: LaunchEnvVar[];
  sourceLabel?: string | null;
  metadataStrategy?: RepositoryMetadataStrategy;
}): Promise<RepositoryRecord> {
  const repositoryId = options.id;
  const envTemplates = options.envTemplates;
  const tagsWithSource = options.tags.map((tag) => ({ ...tag, source: 'manifest' as const }));
  const existing = await getRepositoryById(repositoryId);
  const metadataStrategy = options.metadataStrategy ?? existing?.metadataStrategy ?? 'auto';

  if (!existing) {
    log('info', 'registering manifest repository', {
      repositoryId,
      repoUrl: options.repoUrl,
      source: options.sourceLabel ?? null
    });
    const record = await addRepository({
      id: repositoryId,
      name: options.name,
      description: options.description,
      repoUrl: options.repoUrl,
      dockerfilePath: options.dockerfilePath,
      tags: tagsWithSource,
      launchEnvTemplates: envTemplates,
      metadataStrategy
    });
    try {
      await enqueueRepositoryIngestion(record.id);
    } catch (err) {
      log('warn', 'failed to enqueue ingestion for manifest repository', {
        repositoryId: record.id,
        error: (err as Error).message
      });
    }
    return record;
  }

  const repoUrlChanged = existing.repoUrl !== options.repoUrl;
  const dockerfileChanged = existing.dockerfilePath !== options.dockerfilePath;
  const statusNeedsRecovery = existing.ingestStatus === 'failed' || existing.ingestStatus === 'seed';
  const shouldTriggerIngestion = repoUrlChanged || dockerfileChanged || statusNeedsRecovery;

  const updated = await upsertRepository({
    id: repositoryId,
    name: options.name,
    description: options.description,
    repoUrl: options.repoUrl,
    dockerfilePath: options.dockerfilePath,
    launchEnvTemplates: envTemplates,
    metadataStrategy
  });

  if (options.tags.length > 0) {
    await replaceRepositoryTags(repositoryId, options.tags, { clearExisting: false, source: 'manifest' });
  }

  if (envTemplates.length > 0) {
    await updateRepositoryLaunchEnvTemplates(repositoryId, envTemplates);
  }

  if (shouldTriggerIngestion) {
    const now = new Date().toISOString();
    if (existing.ingestStatus !== 'pending' || repoUrlChanged || dockerfileChanged) {
      await setRepositoryStatus(repositoryId, 'pending', {
        updatedAt: now,
        ingestError: null,
        eventMessage: 'Queued for ingestion by manifest sync'
      });
    }
    try {
      await enqueueRepositoryIngestion(repositoryId);
    } catch (err) {
      log('warn', 'failed to re-enqueue ingestion for manifest repository', {
        repositoryId,
        error: (err as Error).message
      });
    }
  }

  return updated;
}

async function ensureNetworkFromManifest(
  network: LoadedServiceNetwork,
  context: { moduleId: string; moduleVersion: number }
) {
  const clone = cloneLoadedServiceNetwork(network);
  const networkId = clone.id;
  if (!networkId) {
    throw new Error('service network missing id');
  }
  const manifestSource = clone.sources[clone.sources.length - 1] ?? null;
  const manifestTags = clone.tags
    ? clone.tags.map((tag) => ({ key: tag.key, value: tag.value }))
    : [];
  const networkTags = normalizeTags([
    ...manifestTags,
    { key: 'category', value: 'service-network' }
  ]);
  const networkEnv = toLaunchEnvVars(clone.env ?? []);

  const { definition, checksum } = buildNetworkStoreDefinition(clone);

  await ensureRepositoryFromManifest({
    id: networkId,
    name: clone.name,
    description: clone.description,
    repoUrl: clone.repoUrl,
    dockerfilePath: clone.dockerfilePath,
    tags: networkTags,
    envTemplates: networkEnv,
    sourceLabel: manifestSource
  });

  await upsertServiceNetwork({
    repositoryId: networkId,
    manifestSource,
    moduleId: context.moduleId,
    moduleVersion: context.moduleVersion,
    definition,
    checksum
  });

  const memberInputs: ServiceNetworkMemberInput[] = [];
  let defaultOrder = 0;

  for (const service of clone.services) {
    if (!service || typeof service.app?.id !== 'string') {
      continue;
    }
    const memberId = service.app.id.trim().toLowerCase();
    if (!memberId) {
      log('warn', 'service network member missing repository id', {
        networkId,
        serviceSlug: service.serviceSlug
      });
      continue;
    }

    const appTags = service.app.tags ? service.app.tags.map((tag) => ({ key: tag.key, value: tag.value })) : [];
    const serviceTags = normalizeTags([
      ...appTags,
      { key: 'service-network', value: networkId }
    ]);

    const launchEnvTemplates = toLaunchEnvVars(service.app.launchEnv ?? []);
    const memberEnv = cloneEnvVars(service.env ?? service.app.launchEnv);

    await ensureRepositoryFromManifest({
      id: memberId,
      name: service.app.name,
      description: service.app.description,
      repoUrl: service.app.repoUrl,
      dockerfilePath: service.app.dockerfilePath,
      tags: serviceTags,
      envTemplates: launchEnvTemplates,
      sourceLabel: manifestSource
    });

    memberInputs.push({
      memberRepositoryId: memberId,
      launchOrder: service.launchOrder ?? defaultOrder,
      waitForBuild: service.waitForBuild !== false,
      env: memberEnv,
      dependsOn: service.dependsOn
    });
    defaultOrder += 1;
  }

  await replaceServiceNetworkMembers(networkId, memberInputs);
}

async function syncNetworksFromManifest(
  moduleId: string,
  moduleVersion: number,
  networks: LoadedServiceNetwork[]
) {
  const desired = new Set<string>();
  for (const network of networks) {
    if (!network?.id) {
      continue;
    }
    desired.add(network.id);
    try {
      await ensureNetworkFromManifest(network, { moduleId, moduleVersion });
    } catch (err) {
      log('error', 'failed to sync service network', {
        moduleId,
        moduleVersion,
        networkId: network.id,
        error: (err as Error).message
      });
    }
  }

  const existing = await listServiceNetworksByModule(moduleId);
  for (const record of existing) {
    if (desired.has(record.repositoryId)) {
      continue;
    }
    await deleteServiceNetwork(record.repositoryId);
    log('info', 'removed service network not present in manifest', {
      moduleId,
      networkId: record.repositoryId
    });
  }
}

function toPlainObject(value: JsonValue | null | undefined): Record<string, JsonValue> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, JsonValue>) };
  }
  return {};
}

async function updateServiceManifestAppReferences(
  networks: LoadedServiceNetwork[],
  entries: ManifestMap
) {
  const serviceToApps = new Map<string, Set<string>>();
  for (const network of networks) {
    for (const service of network.services) {
      const slug = service.serviceSlug.trim().toLowerCase();
      const appId = service.app.id.trim().toLowerCase();
      if (!slug || !appId) {
        continue;
      }
      const existing = serviceToApps.get(slug);
      if (existing) {
        existing.add(appId);
      } else {
        serviceToApps.set(slug, new Set([appId]));
      }
    }
  }

  for (const [slug, entry] of entries) {
    const normalizedSlug = normalizeRepositoryId(slug);
    if (!normalizedSlug) {
      continue;
    }
    const repository = await getRepositoryById(normalizedSlug);
    if (!repository) {
      continue;
    }
    const repositoryId = normalizeRepositoryId(repository.id);
    if (!repositoryId) {
      continue;
    }

    const envTemplates = toLaunchEnvVars(entry.env ?? []);
    if (envTemplates.length > 0 && (repository.launchEnvTemplates?.length ?? 0) === 0) {
      try {
        await updateRepositoryLaunchEnvTemplates(repository.id, envTemplates);
      } catch (err) {
        log('warn', 'failed to update repository launch env templates from service manifest', {
          repositoryId: repository.id,
          slug,
          error: (err as Error).message
        });
      }
    }

    const existing = serviceToApps.get(normalizedSlug);
    if (existing) {
      existing.add(repositoryId);
    } else {
      serviceToApps.set(normalizedSlug, new Set([repositoryId]));
    }
  }

  repositoryToServiceSlug.clear();
  for (const [slug, apps] of serviceToApps) {
    for (const appId of apps) {
      repositoryToServiceSlug.set(appId, slug);
    }
  }

  const slugs = new Set<string>([...entries.keys(), ...serviceToApps.keys()]);
  for (const slug of slugs) {
    const service = await getServiceBySlug(slug);
    if (!service) {
      continue;
    }

    const existingMetadata = coerceServiceMetadata(service.metadata ?? null);
    const manifestMeta = toPlainObject(existingMetadata?.manifest as JsonValue | null | undefined);
    const apps = serviceToApps.get(slug);
    if (apps && apps.size > 0) {
      manifestMeta.apps = Array.from(apps).sort();
    } else {
      delete manifestMeta.apps;
    }

    const metadataUpdate: ServiceMetadata = {
      resourceType: 'service',
      manifest: serviceManifestMetadataSchema.parse(manifestMeta)
    };

    if (apps && apps.size > 0) {
      metadataUpdate.linkedApps = Array.from(apps).sort();
    } else {
      metadataUpdate.linkedApps = null;
    }

    const nextMetadata = mergeServiceMetadata(service.metadata ?? null, metadataUpdate);
    const previous = service.metadata ?? null;
    if (JSON.stringify(nextMetadata) === JSON.stringify(previous)) {
      continue;
    }
    await setServiceStatus(slug, { metadata: nextMetadata });
  }
}

function normalizeRepositoryId(id: string | null | undefined): string | null {
  if (!id || typeof id !== 'string') {
    return null;
  }
  const normalized = id.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

async function getServiceSlugForRepository(repositoryId: string): Promise<string | null> {
  const normalized = normalizeRepositoryId(repositoryId);
  if (!normalized) {
    return null;
  }

  await loadManifestState();

  const cached = repositoryToServiceSlug.get(normalized);
  if (cached) {
    return cached;
  }

  for (const network of manifestNetworks) {
    for (const service of network.services) {
      const memberId = normalizeRepositoryId(service.app.id);
      if (memberId === normalized) {
        repositoryToServiceSlug.set(normalized, service.serviceSlug);
        return service.serviceSlug;
      }
    }
  }

  const services = await listServices();
  for (const service of services) {
    const metadata = coerceServiceMetadata(service.metadata ?? null);
    const manifestMeta = toPlainObject(metadata?.manifest as JsonValue | null | undefined);
    const apps = manifestMeta.apps;
    if (!Array.isArray(apps)) {
      continue;
    }
    for (const appId of apps) {
      if (typeof appId !== 'string') {
        continue;
      }
      if (normalizeRepositoryId(appId) === normalized) {
        repositoryToServiceSlug.set(normalized, service.slug);
        return service.slug;
      }
    }
  }

  const direct = await getServiceBySlug(normalized);
  if (direct) {
    repositoryToServiceSlug.set(normalized, direct.slug);
    return direct.slug;
  }

  return null;
}

function isLoopbackHost(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.');
}

function normalizeUrl(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (!parsed.protocol || !parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function parsePortValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

export async function resolveManifestPortForRepository(repositoryId: string): Promise<number | null> {
  const slug = await getServiceSlugForRepository(repositoryId);
  if (!slug) {
    return null;
  }
  await loadManifestState();
  const manifest = manifestEntries.get(slug);
  if (manifest) {
    const manifestEnv = serializeManifestEnvVars(manifest.env);
    const manifestPort = resolvePortFromManifestEnv(manifestEnv ?? undefined);
    if (manifestPort) {
      return manifestPort;
    }

    const baseUrlPort = extractPortFromBaseUrl(manifest.baseUrl ?? null);
    if (baseUrlPort) {
      return baseUrlPort;
    }
  }

  const service = await getServiceBySlug(slug);
  if (!service) {
    return null;
  }

  const metadata = coerceServiceMetadata(service.metadata ?? null);
  const manifestMeta = toPlainObject(metadata?.manifest as JsonValue | null | undefined);
  const metadataPort = resolvePortFromManifestEnv(manifestMeta.env ?? null);
  if (metadataPort) {
    return metadataPort;
  }

  return extractPortFromBaseUrl(service.baseUrl ?? null);
}

export async function resolveManifestEnvForRepository(repositoryId: string): Promise<LaunchEnvVar[]> {
  const slug = await getServiceSlugForRepository(repositoryId);
  if (!slug) {
    return [];
  }

  await loadManifestState();
  const manifest = manifestEntries.get(slug);
  if (manifest) {
    const manifestEnv = manifestInputsToLaunchEnv(serializeManifestEnvVars(manifest.env));
    if (manifestEnv.length > 0) {
      return manifestEnv;
    }
  }

  const service = await getServiceBySlug(slug);
  if (!service) {
    return [];
  }

  const metadata = coerceServiceMetadata(service.metadata ?? null);
  const manifestMeta = toPlainObject(metadata?.manifest as JsonValue | null | undefined);
  const metadataEnv = manifestInputsToLaunchEnv(parseManifestEnvList(manifestMeta.env ?? null));
  if (metadataEnv.length > 0) {
    return metadataEnv;
  }

  return [];
}

function buildPreviewUrl(slug: string, runtime: ServiceRuntimeSnapshot): string | null {
  const proxyPath = `/services/${slug}/preview/`;
  const candidates = [runtime.previewUrl, runtime.instanceUrl, runtime.baseUrl];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (!normalized) {
      continue;
    }
    try {
      const parsed = new URL(normalized);
      if (!isLoopbackHost(parsed.hostname)) {
        return normalized;
      }
    } catch {
      continue;
    }
  }
  if (runtime.containerBaseUrl) {
    return proxyPath;
  }
  return normalizeUrl(runtime.previewUrl ?? runtime.instanceUrl ?? runtime.baseUrl) ?? proxyPath;
}

function buildRuntimeMetadata(slug: string, runtime: ServiceRuntimeSnapshot) {
  return removeUndefined({
    repositoryId: runtime.repositoryId,
    launchId: runtime.launchId ?? null,
    instanceUrl: runtime.instanceUrl ?? null,
    baseUrl: runtime.baseUrl ?? null,
    previewUrl: buildPreviewUrl(slug, runtime),
    host: runtime.host ?? null,
    port: runtime.port ?? null,
    containerIp: runtime.containerIp ?? null,
    containerPort: runtime.containerPort ?? null,
    containerBaseUrl: runtime.containerBaseUrl ?? null,
    source: runtime.source ?? 'service-network',
    status: 'running',
    updatedAt: new Date().toISOString()
  });
}

export async function updateServiceRuntimeForRepository(
  repositoryId: string,
  runtime: ServiceRuntimeSnapshot
) {
  const slug = await getServiceSlugForRepository(repositoryId);
  if (!slug) {
    log('warn', 'no service mapping for runtime update', { repositoryId });
    return;
  }

  const service = await getServiceBySlug(slug);
  if (!service) {
    log('warn', 'service missing for runtime update', { repositoryId, slug });
    return;
  }

  const runtimeMetadata = buildRuntimeMetadata(slug, runtime);
  const nextMetadata = mergeServiceMetadata(service.metadata ?? null, {
    resourceType: 'service',
    runtime: runtimeMetadata
  });
  await setServiceStatus(slug, { metadata: nextMetadata });

  try {
    const refreshed = await getServiceBySlug(slug);
    if (refreshed) {
      await checkServiceHealth(refreshed);
    }
  } catch (err) {
    log('warn', 'immediate health check failed after runtime update', {
      slug,
      error: (err as Error).message
    });
  }
}

export async function clearServiceRuntimeForRepository(
  repositoryId: string,
  options?: { launchId?: string | null }
) {
  const slug = await getServiceSlugForRepository(repositoryId);
  if (!slug) {
    return;
  }

  const service = await getServiceBySlug(slug);
  if (!service) {
    return;
  }

  const metadata = coerceServiceMetadata(service.metadata ?? null);
  const runtimeMeta = toPlainObject(metadata?.runtime as JsonValue | null | undefined);
  if (Object.keys(runtimeMeta).length === 0) {
    return;
  }

  const currentLaunchId = typeof runtimeMeta.launchId === 'string' ? runtimeMeta.launchId.trim() : '';
  const expectedLaunchId = options?.launchId ?? null;
  if (expectedLaunchId && currentLaunchId && currentLaunchId !== expectedLaunchId) {
    return;
  }

  const nextMetadata = mergeServiceMetadata(service.metadata ?? null, {
    resourceType: 'service',
    runtime: null
  });
  await setServiceStatus(slug, { metadata: nextMetadata });
}


function ensureTrailingSlash(url: string) {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolveUrl(baseUrl: string, endpoint?: string) {
  if (!endpoint || endpoint.trim().length === 0) {
    return baseUrl;
  }
  try {
    return new URL(endpoint, ensureTrailingSlash(baseUrl)).toString();
  } catch (err) {
    log('warn', 'failed to resolve endpoint for service', {
      baseUrl,
      endpoint,
      error: (err as Error).message
    });
    return baseUrl;
  }
}

function shouldRefreshOpenApi(service: ServiceRecord, metadata: Record<string, JsonValue>, now: number, url: string) {
  const openapi = metadata.openapi;
  if (!openapi || typeof openapi !== 'object' || Array.isArray(openapi)) {
    return true;
  }
  const openapiMeta = openapi as Record<string, JsonValue>;
  const fetchedAt = typeof openapiMeta.fetchedAt === 'string' ? Date.parse(openapiMeta.fetchedAt) : NaN;
  const lastUrl = typeof openapiMeta.url === 'string' ? openapiMeta.url : null;
  if (!Number.isFinite(fetchedAt)) {
    return true;
  }
  if (lastUrl && lastUrl !== url) {
    return true;
  }
  return now - fetchedAt > OPENAPI_REFRESH_INTERVAL_MS;
}

async function fetchOpenApi(url: string, signal: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/yaml, text/yaml, application/json; q=0.8, */*; q=0.5'
    }
  });
  if (!response.ok) {
    throw new Error(`OpenAPI request failed with status ${response.status}`);
  }
  const text = await response.text();
  const hash = createHash('sha256').update(text).digest('hex');
  let version: string | null = null;
  let schema: JsonValue | null = null;
  try {
    const parsed = parseYaml(text);
    if (isJsonValue(parsed)) {
      schema = parsed;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const info = (parsed as Record<string, JsonValue>).info;
        if (info && typeof info === 'object' && !Array.isArray(info)) {
          const maybeVersion = (info as Record<string, JsonValue>).version;
          if (typeof maybeVersion === 'string') {
            version = maybeVersion;
          }
        }
      }
    } else {
      log('warn', 'openapi document is not a JSON-compatible structure', { url });
    }
  } catch (err) {
    log('warn', 'failed to parse OpenAPI document', { url, error: (err as Error).message });
  }
  return {
    hash,
    version,
    bytes: Buffer.byteLength(text, 'utf8'),
    schema
  };
}

async function checkServiceHealth(service: ServiceRecord) {
  await loadManifestState();
  const manifest = manifestEntries.get(service.slug);
  const metadata = coerceServiceMetadata(service.metadata ?? null);
  const manifestHealthEndpoint =
    typeof manifest?.healthEndpoint === 'string' && manifest.healthEndpoint.trim().length > 0
      ? manifest.healthEndpoint.trim()
      : null;
  const metadataHealthEndpoint =
    typeof metadata?.manifest?.healthEndpoint === 'string' &&
    metadata.manifest.healthEndpoint.trim().length > 0
      ? metadata.manifest.healthEndpoint.trim()
      : null;
  const healthEndpoint = manifestHealthEndpoint ?? metadataHealthEndpoint ?? '/healthz';
  const runtimeMeta = toPlainObject(metadata?.runtime as JsonValue | null | undefined);
  const metadataRecord = toPlainObject(service.metadata ?? null);
  metadataRecord.resourceType = 'service';
  const baseUrls = collectHealthBaseUrls(service, runtimeMeta, manifest);

  let healthyResult: { outcome: HealthCheckOutcome; baseUrl: string; healthUrl: string } | null = null;
  let degradedResult: { outcome: HealthCheckOutcome; baseUrl: string; healthUrl: string } | null = null;
  let unreachableResult: { outcome: HealthCheckOutcome; baseUrl: string; healthUrl: string } | null = null;

  for (const baseUrl of baseUrls) {
    const healthUrl = resolveUrl(baseUrl, healthEndpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const started = Date.now();

    try {
      const response = await fetch(healthUrl, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, text/plain, */*',
          'User-Agent': 'apphub-service-registry/1.0'
        }
      });
      const latencyMs = Date.now() - started;
      if (response.ok) {
        healthyResult = {
          baseUrl,
          healthUrl,
          outcome: {
            status: 'healthy',
            statusMessage: null,
            latencyMs,
            statusCode: response.status,
            openapi: null
          }
        };
        break;
      }

      const body = await response.text();
      const message = body ? `${response.status} ${response.statusText}: ${body.slice(0, 240)}` : `${response.status} ${response.statusText}`;
      if (!degradedResult) {
        degradedResult = {
          baseUrl,
          healthUrl,
          outcome: {
            status: 'degraded',
            statusMessage: message,
            latencyMs,
            statusCode: response.status,
            openapi: null
          }
        };
      }
    } catch (err) {
      const latencyMs = Date.now() - started;
      const message = err instanceof Error ? err.message : 'unknown error';
      if (!unreachableResult) {
        unreachableResult = {
          baseUrl,
          healthUrl,
          outcome: {
            status: 'unreachable',
            statusMessage: message,
            latencyMs,
            error: err instanceof Error ? err : undefined,
            openapi: null
          }
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }

  const selected =
    healthyResult ??
    degradedResult ??
    unreachableResult ?? {
      baseUrl: service.baseUrl,
      healthUrl: resolveUrl(service.baseUrl, healthEndpoint),
      outcome: {
        status: 'unreachable',
        statusMessage: 'health check failed',
        latencyMs: null,
        openapi: null
      }
    };

  await finalizeHealthUpdate(service, manifest, metadataRecord, selected);
}

async function finalizeHealthUpdate(
  service: ServiceRecord,
  manifest: ManifestEntry | undefined,
  metadata: Record<string, JsonValue>,
  result: { outcome: HealthCheckOutcome; baseUrl: string; healthUrl: string }
) {
  const nowIso = new Date().toISOString();
  metadata.health = removeUndefined({
    url: result.healthUrl,
    status: result.outcome.status,
    checkedAt: nowIso,
    latencyMs: result.outcome.latencyMs,
    statusCode: result.outcome.statusCode ?? null,
    error: result.outcome.statusMessage
  });

  try {
    await recordServiceHealthSnapshot({
      serviceSlug: service.slug,
      status: result.outcome.status,
      statusMessage: result.outcome.statusMessage ?? null,
      latencyMs: result.outcome.latencyMs ?? null,
      statusCode: result.outcome.statusCode ?? null,
      checkedAt: nowIso,
      baseUrl: result.baseUrl,
      healthEndpoint: result.healthUrl,
      metadata: result.outcome.openapi ? { openapi: result.outcome.openapi } : null
    });
    healthSnapshotCache = null;
    await broadcastInvalidation({ kind: 'health', reason: 'snapshot', slug: service.slug });
  } catch (err) {
    log('warn', 'failed to record service health snapshot', {
      slug: service.slug,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  if (result.outcome.status === 'healthy') {
    const openapiPath = manifest?.openapiPath ?? '/openapi.yaml';
    const openapiUrl = resolveUrl(result.baseUrl, openapiPath);
    const shouldRefetch = shouldRefreshOpenApi(service, metadata, Date.now(), openapiUrl);
    if (shouldRefetch) {
      const openapiController = new AbortController();
      const openapiTimer = setTimeout(() => openapiController.abort(), HEALTH_TIMEOUT_MS);
      try {
        const openapiResult = await fetchOpenApi(openapiUrl, openapiController.signal);
        result.outcome.openapi = {
          hash: openapiResult.hash,
          version: openapiResult.version,
          fetchedAt: nowIso,
          bytes: openapiResult.bytes,
          url: openapiUrl,
          schema: openapiResult.schema
        };
        metadata.openapi = result.outcome.openapi;
      } catch (err) {
        log('warn', 'failed to refresh OpenAPI metadata', {
          slug: service.slug,
          url: openapiUrl,
          error: (err as Error).message
        });
      } finally {
        clearTimeout(openapiTimer);
      }
    }
  }

  const statusUpdate: Parameters<typeof setServiceStatus>[1] = {
    status: result.outcome.status,
    statusMessage: result.outcome.statusMessage,
    metadata: metadata as JsonValue,
    baseUrl: service.baseUrl
  };

  if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'capabilities')) {
    statusUpdate.capabilities = manifest.capabilities ?? null;
  }

  const updated = await setServiceStatus(service.slug, statusUpdate);

  if (updated && service.status !== updated.status) {
    if (updated.status === 'healthy') {
      log('info', 'service is healthy', { slug: updated.slug, latencyMs: result.outcome.latencyMs });
    } else {
      log('warn', 'service health changed', {
        slug: updated.slug,
        status: updated.status,
        error: result.outcome.statusMessage
      });
    }
  }
}

async function pollServicesOnce() {
  if (isPolling) {
    return;
  }
  isPolling = true;
  try {
    const services = await listServices();
    for (const service of services) {
      try {
        await checkServiceHealth(service);
      } catch (err) {
        log('error', 'health check failed', { slug: service.slug, error: (err as Error).message });
      }
    }
  } finally {
    isPolling = false;
  }
}

function startPolling(): PollerController {
  let stopped = false;
  const interval = setInterval(() => {
    void pollServicesOnce();
  }, HEALTH_INTERVAL_MS);
  interval.unref?.();
  void pollServicesOnce();
  return {
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(interval);
    },
    isRunning() {
      return !stopped;
    }
  };
}

export async function initializeServiceRegistry(options?: { enablePolling?: boolean }) {
  const disablePollingEnv = envFlagEnabled(process.env.APPHUB_DISABLE_SERVICE_POLLING);
  const enablePolling = options?.enablePolling ?? !disablePollingEnv;

  ensureInvalidationSubscription();
  try {
    await loadManifestState({ force: true });
  } catch (err) {
    log('warn', 'failed to prewarm service manifest cache', {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  poller?.stop();
  poller = null;
  if (enablePolling) {
    poller = startPolling();
  }
  return {
    importManifestModule: importServiceManifestModule,
    resetManifestState: resetServiceManifestState,
    stop() {
      poller?.stop();
      poller = null;
    },
    getManifestEntry(slug: string) {
      return manifestEntries.get(slug);
    }
  };
}

export async function getServiceManifest(slug: string) {
  await loadManifestState();
  return manifestEntries.get(slug) ?? null;
}

export async function getServiceHealthSnapshot(slug: string): Promise<ServiceHealthSnapshotRecord | null> {
  const snapshots = await getHealthSnapshots([slug]);
  return snapshots.get(slug) ?? null;
}

export async function getServiceHealthSnapshots(
  slugs: string[]
): Promise<Map<string, ServiceHealthSnapshotRecord>> {
  return getHealthSnapshots(slugs);
}

export const __testing = {
  checkServiceHealth,
  waitForInvalidations: async () =>
    new Promise<void>((resolve) => {
      setImmediate(resolve);
    }),
  getManifestCache: () => manifestStateCache,
  getHealthCache: () => healthSnapshotCache
};
