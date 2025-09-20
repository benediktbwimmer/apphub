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
} from './db';
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
    const existing = getServiceBySlug(entry.slug);
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

    const record = upsertService(upsertPayload);
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
  const existing = getRepositoryById(repositoryId);

  if (!existing) {
    log('info', 'registering manifest repository', {
      repositoryId,
      repoUrl: options.repoUrl,
      source: options.sourceLabel ?? null
    });
    const record = addRepository({
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

  const updated = upsertRepository({
    id: repositoryId,
    name: options.name,
    description: options.description,
    repoUrl: options.repoUrl,
    dockerfilePath: options.dockerfilePath,
    launchEnvTemplates: envTemplates
  });

  if (options.tags.length > 0) {
    replaceRepositoryTags(repositoryId, options.tags, { clearExisting: false, source: 'manifest' });
  }

  if (envTemplates.length > 0) {
    updateRepositoryLaunchEnvTemplates(repositoryId, envTemplates);
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

  upsertServiceNetwork({ repositoryId: networkId, manifestSource });

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
    const memberEnv = toLaunchEnvVars(service.env ?? service.app.launchEnv ?? []);

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

  replaceServiceNetworkMembers(networkId, memberInputs);
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

  const existing = listServiceNetworkRepositoryIds();
  for (const repositoryId of existing) {
    if (desired.has(repositoryId)) {
      continue;
    }
    deleteServiceNetwork(repositoryId);
    log('info', 'removed service network not present in manifest', { networkId: repositoryId });
  }
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
  try {
    const parsed = parseYaml(text) as Record<string, unknown> | undefined;
    const maybeVersion = parsed && typeof parsed === 'object' ? (parsed.info as Record<string, unknown> | undefined) : undefined;
    if (maybeVersion && typeof maybeVersion.version === 'string') {
      version = maybeVersion.version;
    }
  } catch (err) {
    log('warn', 'failed to parse OpenAPI document', { url, error: (err as Error).message });
  }
  return {
    hash,
    version,
    bytes: Buffer.byteLength(text, 'utf8')
  };
}

async function checkServiceHealth(service: ServiceRecord) {
  const manifest = manifestEntries.get(service.slug);
  const healthEndpoint = manifest?.healthEndpoint ?? '/healthz';
  const healthUrl = resolveUrl(service.baseUrl, healthEndpoint);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  const started = Date.now();
  let outcome: HealthCheckOutcome;

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
      outcome = {
        status: 'healthy',
        statusMessage: null,
        latencyMs,
        statusCode: response.status,
        openapi: null
      };
    } else {
      const body = await response.text();
      const message = body ? `${response.status} ${response.statusText}: ${body.slice(0, 240)}` : `${response.status} ${response.statusText}`;
      outcome = {
        status: 'degraded',
        statusMessage: message,
        latencyMs,
        statusCode: response.status,
        openapi: null
      };
    }
  } catch (err) {
    const latencyMs = Date.now() - started;
    const message = err instanceof Error ? err.message : 'unknown error';
    outcome = {
      status: 'unreachable',
      statusMessage: message,
      latencyMs,
      error: err instanceof Error ? err : undefined,
      openapi: null
    };
  } finally {
    clearTimeout(timer);
  }

  const nowIso = new Date().toISOString();
  const metadata = toMetadataObject(service.metadata ?? null);
  metadata.health = removeUndefined({
    url: healthUrl,
    status: outcome.status,
    checkedAt: nowIso,
    latencyMs: outcome.latencyMs,
    statusCode: outcome.statusCode ?? null,
    error: outcome.statusMessage
  });

  if (outcome.status === 'healthy') {
    const openapiPath = manifest?.openapiPath ?? '/openapi.yaml';
    const openapiUrl = resolveUrl(service.baseUrl, openapiPath);
    const shouldRefetch = shouldRefreshOpenApi(service, metadata, Date.now(), openapiUrl);
    if (shouldRefetch) {
      const openapiController = new AbortController();
      const openapiTimer = setTimeout(() => openapiController.abort(), HEALTH_TIMEOUT_MS);
      try {
        const openapiResult = await fetchOpenApi(openapiUrl, openapiController.signal);
        outcome.openapi = {
          hash: openapiResult.hash,
          version: openapiResult.version,
          fetchedAt: nowIso,
          bytes: openapiResult.bytes,
          url: openapiUrl
        };
        metadata.openapi = outcome.openapi;
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

  const updateMetadata = metadata as JsonValue;

  const statusUpdate: Parameters<typeof setServiceStatus>[1] = {
    status: outcome.status,
    statusMessage: outcome.statusMessage,
    metadata: updateMetadata,
    baseUrl: service.baseUrl
  };

  if (manifest && Object.prototype.hasOwnProperty.call(manifest, 'capabilities')) {
    statusUpdate.capabilities = manifest.capabilities ?? null;
  }

  const updated = setServiceStatus(service.slug, statusUpdate);

  if (updated && service.status !== updated.status) {
    if (updated.status === 'healthy') {
      log('info', 'service is healthy', { slug: updated.slug, latencyMs: outcome.latencyMs });
    } else {
      log('warn', 'service health changed', {
        slug: updated.slug,
        status: updated.status,
        error: outcome.statusMessage
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
    const services = listServices();
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
  await loadManifest();
  if (options?.enablePolling === false) {
    poller?.stop();
    poller = null;
  } else {
    poller?.stop();
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
