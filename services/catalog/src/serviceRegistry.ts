import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import {
  addRepository,
  deleteServiceNetwork,
  getRepositoryById,
  getServiceBySlug,
  listServiceNetworkRepositoryIds,
  listServices,
  replaceRepositoryTags,
  replaceServiceNetworkMembers,
  setRepositoryStatus,
  setServiceStatus,
  upsertRepository,
  upsertService,
  upsertServiceNetwork,
  updateRepositoryLaunchEnvTemplates,
  type JsonValue,
  type LaunchEnvVar,
  type RepositoryRecord,
  type ServiceRecord,
  type ServiceUpsertInput,
  type TagKV,
  type ServiceNetworkMemberInput
} from './db/index';
import { enqueueRepositoryIngestion } from './queue';
import {
  loadServiceConfigurations,
  resolveServiceConfigPaths,
  type LoadedManifestEntry,
  type LoadedServiceNetwork
} from './serviceConfigLoader';
import {
  manifestFileSchema,
  type ManifestEnvVarInput,
  type ManifestLoadError
} from './serviceManifestTypes';

const DEFAULT_MANIFEST_PATH = path.resolve(__dirname, '..', '..', 'service-manifest.json');

const HEALTH_INTERVAL_MS = Number(process.env.SERVICE_HEALTH_INTERVAL_MS ?? 30_000);
const HEALTH_TIMEOUT_MS = Number(process.env.SERVICE_HEALTH_TIMEOUT_MS ?? 5_000);
const OPENAPI_REFRESH_INTERVAL_MS = Number(process.env.SERVICE_OPENAPI_REFRESH_INTERVAL_MS ?? 15 * 60_000);

type ManifestEntry = LoadedManifestEntry;

type ManifestMap = Map<string, ManifestEntry>;

type ManifestLoadResult = {
  entries: ManifestMap;
  networks: LoadedServiceNetwork[];
  errors: ManifestLoadError[];
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

let manifestEntries: ManifestMap = new Map();
let manifestNetworks: LoadedServiceNetwork[] = [];
let poller: PollerController | null = null;
let isPolling = false;
const repositoryToServiceSlug = new Map<string, string>();

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1', '0.0.0.0']);

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

function resolveManifestPaths(options?: { includeDefault?: boolean }): string[] {
  const includeDefault = options?.includeDefault ?? true;
  const configured = process.env.SERVICE_MANIFEST_PATH ?? '';
  const extras = configured
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  const defaults = includeDefault ? [DEFAULT_MANIFEST_PATH] : [];
  const paths = [...defaults, ...extras];
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const manifestPath of paths) {
    if (seen.has(manifestPath)) {
      continue;
    }
    seen.add(manifestPath);
    deduped.push(manifestPath);
  }
  return deduped;
}

type EnvVar = ManifestEnvVarInput;

function normalizeEnvReference(entry: ManifestEnvVarInput['fromService']): ManifestEnvVarInput['fromService'] | undefined {
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

function cloneEnvVars(env?: ManifestEnvVarInput[] | null): ManifestEnvVarInput[] | undefined {
  if (!env || !Array.isArray(env)) {
    return undefined;
  }
  return env
    .filter((entry): entry is ManifestEnvVarInput => Boolean(entry && typeof entry.key === 'string'))
    .map((entry) => {
      const key = entry.key.trim();
      if (!key) {
        return { key: '' } as ManifestEnvVarInput;
      }
      const clone: ManifestEnvVarInput = { key };
      if (Object.prototype.hasOwnProperty.call(entry, 'value')) {
        clone.value = entry.value;
      }
      const ref = normalizeEnvReference(entry.fromService);
      if (ref) {
        clone.fromService = ref;
      }
      return clone;
    })
    .filter((entry) => entry.key.length > 0);
}

function toLaunchEnvVars(env?: ManifestEnvVarInput[] | null): LaunchEnvVar[] {
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

async function readManifestFile(
  manifestPath: string
): Promise<{ entries: ManifestEntry[]; networks: LoadedServiceNetwork[] }> {
  try {
    const contents = await fs.readFile(manifestPath, 'utf8');
    const parsed = manifestFileSchema.parse(JSON.parse(contents));
    if (Array.isArray(parsed)) {
      return {
        entries: parsed.map((entry) => ({
          ...entry,
          slug: entry.slug.trim().toLowerCase(),
          env: cloneEnvVars(entry.env),
          sources: [manifestPath],
          baseUrlSource: 'manifest' as const
        })),
        networks: []
      };
    }

    const services = (parsed.services ?? []).map((entry) => ({
      ...entry,
      slug: entry.slug.trim().toLowerCase(),
      env: cloneEnvVars(entry.env),
      sources: [manifestPath],
      baseUrlSource: 'manifest' as const
    }));

    const networks = (parsed.networks ?? []).map((network) => ({
      ...network,
      id: network.id.trim().toLowerCase(),
      services: network.services.map((service) => ({
        ...service,
        serviceSlug: service.serviceSlug.trim().toLowerCase(),
        dependsOn: service.dependsOn?.map((dep) => dep.trim().toLowerCase()) ?? undefined,
        env: cloneEnvVars(service.env),
        app: {
          ...service.app,
          id: service.app.id.trim().toLowerCase(),
          tags: cloneTags(service.app.tags),
          launchEnv: cloneEnvVars(service.app.launchEnv)
        }
      })),
      env: cloneEnvVars(network.env),
      tags: cloneTags(network.tags),
      sources: [manifestPath]
    }));

    return { entries: services, networks };
  } catch (err) {
    throw new Error(`Failed to load manifest at ${manifestPath}: ${(err as Error).message}`);
  }
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

function toMetadataObject(value: JsonValue | null): Record<string, JsonValue> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, JsonValue>) };
  }
  return {};
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

function buildManifestMetadata(entry: ManifestEntry) {
  return removeUndefined({
    source: entry.sources[entry.sources.length - 1] ?? null,
    sources: entry.sources,
    devCommand: entry.devCommand ?? null,
    workingDir: entry.workingDir ?? null,
    healthEndpoint: entry.healthEndpoint ?? null,
    openapiPath: entry.openapiPath ?? null,
    baseUrlSource: entry.baseUrlSource,
    env: entry.env ?? null
  });
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
    const metadata = toMetadataObject(existing?.metadata ?? null);
    const previousManifest = metadata.manifest;
    const manifestMeta = buildManifestMetadata(entry);
    const comparablePrevious = stripAppliedAt(previousManifest);
    const manifestChanged =
      JSON.stringify(comparablePrevious ?? null) !== JSON.stringify(manifestMeta);
    const appliedAt =
      !manifestChanged && previousManifest && typeof previousManifest === 'object'
        ? ((previousManifest as Record<string, JsonValue>).appliedAt as string | undefined) ?? new Date().toISOString()
        : new Date().toISOString();

    metadata.manifest = {
      ...manifestMeta,
      appliedAt
    };

    if (Object.prototype.hasOwnProperty.call(entry, 'metadata')) {
      metadata.config = entry.metadata ?? null;
    }

    const upsertPayload: ServiceUpsertInput = {
      slug: entry.slug,
      displayName: entry.displayName,
      kind: entry.kind,
      baseUrl: entry.baseUrl,
      metadata,
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
      source: metadata.manifest?.source ?? null
    });
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
}): Promise<RepositoryRecord> {
  const repositoryId = options.id;
  const envTemplates = options.envTemplates;
  const tagsWithSource = options.tags.map((tag) => ({ ...tag, source: 'manifest' as const }));
  const existing = await getRepositoryById(repositoryId);

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
      launchEnvTemplates: envTemplates
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
    launchEnvTemplates: envTemplates
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

async function ensureNetworkFromManifest(network: LoadedServiceNetwork) {
  const networkId = network.id;
  const manifestSource = network.sources[network.sources.length - 1] ?? null;
  const manifestTags = network.tags
    ? network.tags.map((tag) => ({ key: tag.key, value: tag.value }))
    : [];
  const networkTags = normalizeTags([
    ...manifestTags,
    { key: 'category', value: 'service-network' }
  ]);
  const networkEnv = toLaunchEnvVars(network.env ?? []);

  await ensureRepositoryFromManifest({
    id: networkId,
    name: network.name,
    description: network.description,
    repoUrl: network.repoUrl,
    dockerfilePath: network.dockerfilePath,
    tags: networkTags,
    envTemplates: networkEnv,
    sourceLabel: manifestSource
  });

  await upsertServiceNetwork({ repositoryId: networkId, manifestSource });

  const memberInputs: ServiceNetworkMemberInput[] = [];
  let defaultOrder = 0;

  for (const service of network.services) {
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

async function syncNetworksFromManifest(networks: LoadedServiceNetwork[]) {
  const desired = new Set<string>();
  for (const network of networks) {
    if (!network?.id) {
      continue;
    }
    desired.add(network.id);
    try {
      await ensureNetworkFromManifest(network);
    } catch (err) {
      log('error', 'failed to sync service network', {
        networkId: network.id,
        error: (err as Error).message
      });
    }
  }

  const existing = await listServiceNetworkRepositoryIds();
  for (const repositoryId of existing) {
    if (desired.has(repositoryId)) {
      continue;
    }
    await deleteServiceNetwork(repositoryId);
    log('info', 'removed service network not present in manifest', { networkId: repositoryId });
  }
}

function toPlainObject(value: JsonValue | null | undefined): Record<string, JsonValue> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, JsonValue>) };
  }
  return {};
}

async function updateServiceManifestAppReferences(networks: LoadedServiceNetwork[]) {
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

  repositoryToServiceSlug.clear();
  for (const [slug, apps] of serviceToApps) {
    for (const appId of apps) {
      repositoryToServiceSlug.set(appId, slug);
    }
  }

  const slugs = new Set<string>([...manifestEntries.keys(), ...serviceToApps.keys()]);
  for (const slug of slugs) {
    const service = await getServiceBySlug(slug);
    if (!service) {
      continue;
    }

    const metadata = toMetadataObject(service.metadata ?? null);
    const manifestMeta = toPlainObject(metadata.manifest as JsonValue | null | undefined);
    const apps = serviceToApps.get(slug);
    if (apps && apps.size > 0) {
      manifestMeta.apps = Array.from(apps).sort();
    } else {
      delete manifestMeta.apps;
    }
    metadata.manifest = manifestMeta;

    const nextMetadata = Object.keys(metadata).length > 0 ? (metadata as JsonValue) : null;
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
    const metadata = toMetadataObject(service.metadata ?? null);
    const manifestMeta = toPlainObject(metadata.manifest as JsonValue | null | undefined);
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

  return null;
}

function buildRuntimeMetadata(runtime: ServiceRuntimeSnapshot) {
  return removeUndefined({
    repositoryId: runtime.repositoryId,
    launchId: runtime.launchId ?? null,
    instanceUrl: runtime.instanceUrl ?? null,
    baseUrl: runtime.baseUrl ?? null,
    previewUrl: runtime.previewUrl ?? runtime.instanceUrl ?? runtime.baseUrl ?? null,
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

  const metadata = toMetadataObject(service.metadata ?? null);
  metadata.runtime = buildRuntimeMetadata(runtime);
  const nextMetadata = Object.keys(metadata).length > 0 ? (metadata as JsonValue) : null;
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

  const metadata = toMetadataObject(service.metadata ?? null);
  const runtimeMeta = toPlainObject(metadata.runtime as JsonValue | null | undefined);
  if (Object.keys(runtimeMeta).length === 0) {
    return;
  }

  const currentLaunchId = typeof runtimeMeta.launchId === 'string' ? runtimeMeta.launchId.trim() : '';
  const expectedLaunchId = options?.launchId ?? null;
  if (expectedLaunchId && currentLaunchId && currentLaunchId !== expectedLaunchId) {
    return;
  }

  delete metadata.runtime;
  const nextMetadata = Object.keys(metadata).length > 0 ? (metadata as JsonValue) : null;
  await setServiceStatus(slug, { metadata: nextMetadata });
}

async function loadManifest(): Promise<ManifestLoadResult> {
  const collected: ManifestEntry[] = [];
  const collectedNetworks: LoadedServiceNetwork[] = [];
  const errors: ManifestLoadError[] = [];

  const configPaths = resolveServiceConfigPaths();
  const configResult = await loadServiceConfigurations(configPaths);
  collected.push(...configResult.entries.map((entry) => ({ ...entry })));
  collectedNetworks.push(...configResult.networks.map((network) => ({ ...network })));
  errors.push(...configResult.errors);
  for (const error of configResult.errors) {
    log('warn', 'failed to load service manifest', {
      path: error.source,
      error: error.error.message
    });
  }

  const includeDefaultManifest = configResult.usedConfigs.length === 0;
  const manifestPaths = resolveManifestPaths({ includeDefault: includeDefaultManifest });

  for (const manifestPath of manifestPaths) {
    try {
      const manifestData = await readManifestFile(manifestPath);
      for (const entry of manifestData.entries) {
        collected.push({ ...entry });
      }
      for (const network of manifestData.networks) {
        collectedNetworks.push({ ...network });
      }
    } catch (err) {
      const loadError: ManifestLoadError = { source: manifestPath, error: err as Error };
      errors.push(loadError);
      log('warn', 'failed to load service manifest', { path: manifestPath, error: (err as Error).message });
    }
  }

  const merged = mergeManifestEntries(collected.map((entry) => applyEnvOverrides(entry)));
  manifestEntries = merged;
  manifestNetworks = collectedNetworks;
  await applyManifestToDatabase(merged);
  await syncNetworksFromManifest(manifestNetworks);
  await updateServiceManifestAppReferences(manifestNetworks);

  return { entries: merged, networks: manifestNetworks, errors };
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
  const manifest = manifestEntries.get(service.slug);
  const healthEndpoint = manifest?.healthEndpoint ?? '/healthz';
  const metadata = toMetadataObject(service.metadata ?? null);
  const runtimeMeta = toPlainObject(metadata.runtime as JsonValue | null | undefined);
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

  await finalizeHealthUpdate(service, manifest, metadata, selected);
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

  poller?.stop();
  poller = null;
  if (enablePolling) {
    poller = startPolling();
  }
  return {
    refreshManifest: loadManifest,
    stop() {
      poller?.stop();
      poller = null;
    },
    getManifestEntry(slug: string) {
      return manifestEntries.get(slug);
    }
  };
}

export function getServiceManifest(slug: string) {
  return manifestEntries.get(slug) ?? null;
}

export async function ensureServicesFromManifest() {
  await loadManifest();
}
