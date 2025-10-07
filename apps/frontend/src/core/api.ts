import { ApiError } from '@apphub/shared/api/core';
import { createCoreClient } from '@apphub/shared/api';
import type { CancelablePromise } from '@apphub/shared/api/core';
import type { ApiRequestOptions } from '@apphub/shared/api/core/core/ApiRequestOptions';
import { resolveCancelable, type CancelablePromiseLike } from '../api/cancelable';
import { API_BASE_URL } from '../config';
import type {
  AppRecord,
  BuildListMeta,
  BuildSummary,
  IngestionEvent,
  LaunchRequestDraft,
  LaunchSummary,
  RelevanceSummary,
  SearchMeta,
  StatusFacet,
  TagFacet,
  TagSuggestion
} from './types';
import type { LaunchEnvVar } from './types';
import type { ServiceSummary } from '../services/types';

export class CoreApiError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'CoreApiError';
    this.status = status;
    this.details = details;
  }
}

type Token = string | null | undefined;

type CoreClientInstance = ReturnType<typeof createCoreClient>;

function getActiveModuleId(): string | null {
  if (typeof globalThis === 'undefined') {
    return null;
  }
  const raw = (globalThis as unknown as Record<string, unknown>).__APPHUB_ACTIVE_MODULE_ID;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createClient(token: Token): CoreClientInstance {
  return createCoreClient({
    baseUrl: API_BASE_URL,
    token: token ?? undefined,
    withCredentials: true,
    headers: () => {
      const moduleId = getActiveModuleId();
      if (!moduleId) {
        return {};
      }
      return { 'X-AppHub-Module-Id': moduleId };
    }
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function mapLaunchEnvVars(input: unknown): LaunchEnvVar[] | undefined {
  if (!Array.isArray(input) || input.length === 0) {
    return undefined;
  }
  const result: LaunchEnvVar[] = [];
  for (const entry of input) {
    if (!isRecord(entry)) {
      continue;
    }
    const keyRaw = entry.key;
    const valueRaw = entry.value;
    if (typeof keyRaw !== 'string') {
      continue;
    }
    const key = keyRaw.trim();
    if (!key) {
      continue;
    }
    const value = typeof valueRaw === 'string' ? valueRaw : '';
    result.push({ key, value });
  }
  return result;
}

function mapRelevance(input: unknown): RelevanceSummary | null {
  if (!isRecord(input) || !isRecord(input.components)) {
    return null;
  }
  const components = input.components as Record<string, unknown>;
  const normalizeComponent = (raw: unknown) => {
    if (!isRecord(raw)) {
      return { hits: 0, score: 0, weight: 0 };
    }
    return {
      hits: typeof raw.hits === 'number' ? raw.hits : 0,
      score: typeof raw.score === 'number' ? raw.score : 0,
      weight: typeof raw.weight === 'number' ? raw.weight : 0
    };
  };

  return {
    score: typeof input.score === 'number' ? input.score : 0,
    normalizedScore: typeof input.normalizedScore === 'number' ? input.normalizedScore : 0,
    components: {
      name: normalizeComponent(components.name),
      description: normalizeComponent(components.description),
      tags: normalizeComponent(components.tags)
    }
  } satisfies RelevanceSummary;
}

function mapPreviewTiles(input: unknown): AppRecord['previewTiles'] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const idRaw = item.id;
      const id = typeof idRaw === 'number' ? idRaw : Number(idRaw ?? 0);
      if (!Number.isFinite(id)) {
        return null;
      }
      return {
        id,
        kind: typeof item.kind === 'string' ? item.kind : 'unknown',
        title: typeof item.title === 'string' ? item.title : null,
        description: typeof item.description === 'string' ? item.description : null,
        src: typeof item.src === 'string' ? item.src : null,
        embedUrl: typeof item.embedUrl === 'string' ? item.embedUrl : null,
        posterUrl: typeof item.posterUrl === 'string' ? item.posterUrl : null,
        width: typeof item.width === 'number' ? item.width : null,
        height: typeof item.height === 'number' ? item.height : null,
        sortOrder: typeof item.sortOrder === 'number' ? item.sortOrder : 0,
        source: typeof item.source === 'string' ? item.source : 'unknown'
      };
    })
    .filter((tile): tile is AppRecord['previewTiles'][number] => tile !== null);
}

function mapTags(input: unknown): AppRecord['tags'] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      const key = typeof item.key === 'string' ? item.key : null;
      const value = typeof item.value === 'string' ? item.value : null;
      if (!key || value === null) {
        return null;
      }
      return { key, value };
    })
    .filter((tag): tag is AppRecord['tags'][number] => tag !== null);
}

function mapBuild(input: unknown): BuildSummary | null {
  if (!isRecord(input)) {
    return null;
  }
  const statusRaw = typeof input.status === 'string' ? input.status : 'pending';
  const allowedStatuses = new Set(['pending', 'running', 'succeeded', 'failed', 'canceled']);
  const status = allowedStatuses.has(statusRaw) ? (statusRaw as BuildSummary['status']) : 'failed';
  return {
    id: typeof input.id === 'string' ? input.id : String(input.id ?? ''),
    repositoryId: typeof input.repositoryId === 'string'
      ? input.repositoryId
      : String(input.repositoryId ?? ''),
    status,
    imageTag: typeof input.imageTag === 'string' ? input.imageTag : null,
    errorMessage: typeof input.errorMessage === 'string' ? input.errorMessage : null,
    commitSha: typeof input.commitSha === 'string' ? input.commitSha : null,
    gitBranch: typeof input.gitBranch === 'string' ? input.gitBranch : null,
    gitRef: typeof input.gitRef === 'string' ? input.gitRef : null,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    startedAt: typeof input.startedAt === 'string' ? input.startedAt : null,
    completedAt: typeof input.completedAt === 'string' ? input.completedAt : null,
    durationMs: typeof input.durationMs === 'number' ? input.durationMs : null,
    logsPreview: typeof input.logsPreview === 'string' ? input.logsPreview : null,
    logsTruncated: Boolean(input.logsTruncated),
    hasLogs: Boolean(input.hasLogs),
    logsSize: typeof input.logsSize === 'number' ? input.logsSize : 0
  } satisfies BuildSummary;
}

function mapLaunch(input: unknown): LaunchSummary | null {
  if (!isRecord(input)) {
    return null;
  }
  const statusRaw = typeof input.status === 'string' ? input.status : 'pending';
  const allowedStatuses = new Set([
    'pending',
    'starting',
    'running',
    'stopping',
    'stopped',
    'failed'
  ]);
  const status = allowedStatuses.has(statusRaw) ? (statusRaw as LaunchSummary['status']) : 'failed';
  return {
    id: typeof input.id === 'string' ? input.id : String(input.id ?? ''),
    status,
    buildId: typeof input.buildId === 'string' ? input.buildId : null,
    instanceUrl: typeof input.instanceUrl === 'string' ? input.instanceUrl : null,
    resourceProfile: typeof input.resourceProfile === 'string' ? input.resourceProfile : null,
    env: mapLaunchEnvVars(input.env) ?? [],
    command: typeof input.command === 'string' ? input.command : null,
    errorMessage: typeof input.errorMessage === 'string' ? input.errorMessage : null,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : new Date().toISOString(),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    startedAt: typeof input.startedAt === 'string' ? input.startedAt : null,
    stoppedAt: typeof input.stoppedAt === 'string' ? input.stoppedAt : null,
    expiresAt: typeof input.expiresAt === 'string' ? input.expiresAt : null,
    port: typeof input.port === 'number' ? input.port : null
  } satisfies LaunchSummary;
}

function mapRepository(input: unknown): AppRecord {
  const record = isRecord(input) ? input : {};
  const ingestStatusRaw = typeof record.ingestStatus === 'string' ? record.ingestStatus : 'pending';
  const allowedStatuses = new Set(['seed', 'pending', 'processing', 'ready', 'failed']);
  const ingestStatus = allowedStatuses.has(ingestStatusRaw)
    ? (ingestStatusRaw as AppRecord['ingestStatus'])
    : 'pending';

  return {
    id: typeof record.id === 'string' ? record.id : String(record.id ?? ''),
    name: typeof record.name === 'string' ? record.name : '',
    description: typeof record.description === 'string' ? record.description : '',
    repoUrl: typeof record.repoUrl === 'string' ? record.repoUrl : '',
    dockerfilePath: typeof record.dockerfilePath === 'string' ? record.dockerfilePath : 'Dockerfile',
    tags: mapTags(record.tags),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
    ingestStatus,
    ingestError: typeof record.ingestError === 'string' ? record.ingestError : null,
    ingestAttempts: typeof record.ingestAttempts === 'number' ? record.ingestAttempts : 0,
    latestBuild: mapBuild(record.latestBuild),
    latestLaunch: mapLaunch(record.latestLaunch),
    relevance: mapRelevance(record.relevance),
    previewTiles: mapPreviewTiles(record.previewTiles),
    metadataStrategy: record.metadataStrategy === 'explicit' ? 'explicit' : 'auto',
    availableEnv: mapLaunchEnvVars((record as Record<string, unknown>).availableEnv) ?? undefined,
    availableLaunchEnv: mapLaunchEnvVars((record as Record<string, unknown>).availableLaunchEnv) ?? undefined,
    launchEnvTemplates: mapLaunchEnvVars(record.launchEnvTemplates) ?? []
  };
}

function mapSearchFacets(input: unknown): {
  tags: TagFacet[];
  statuses: StatusFacet[];
  owners: TagFacet[];
  frameworks: TagFacet[];
} {
  const record = isRecord(input) ? input : {};
  const mapFacetList = (value: unknown): TagFacet[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }
        const key = typeof item.key === 'string' ? item.key : null;
        const valueStr = typeof item.value === 'string' ? item.value : null;
        const count = typeof item.count === 'number' ? item.count : 0;
        if (!key || valueStr === null) {
          return null;
        }
        return { key, value: valueStr, count } satisfies TagFacet;
      })
      .filter((facet): facet is TagFacet => facet !== null);
  };

  const mapStatusList = (value: unknown): StatusFacet[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    const allowed = new Set(['seed', 'pending', 'processing', 'ready', 'failed']);
    return value
      .map((item) => {
        if (!isRecord(item)) {
          return null;
        }
        const statusRaw = typeof item.status === 'string' ? item.status : null;
        const count = typeof item.count === 'number' ? item.count : 0;
        if (!statusRaw || !allowed.has(statusRaw)) {
          return null;
        }
        return { status: statusRaw as StatusFacet['status'], count } satisfies StatusFacet;
      })
      .filter((facet): facet is StatusFacet => facet !== null);
  };

  return {
    tags: mapFacetList(record.tags),
    statuses: mapStatusList(record.statuses),
    owners: mapFacetList(record.owners),
    frameworks: mapFacetList(record.frameworks)
  };
}

function mapSearchMeta(input: unknown): SearchMeta {
  if (!isRecord(input)) {
    return { tokens: [], sort: 'updated', weights: { name: 1, description: 1, tags: 1 } };
  }
  const sortRaw = typeof input.sort === 'string' ? input.sort : 'updated';
  const allowedSorts = new Set(['relevance', 'updated', 'name']);
  const sort = allowedSorts.has(sortRaw) ? (sortRaw as SearchMeta['sort']) : 'updated';
  const weightsRecord = isRecord(input.weights) ? (input.weights as Record<string, unknown>) : {};
  return {
    tokens: Array.isArray(input.tokens)
      ? input.tokens.filter((token): token is string => typeof token === 'string')
      : [],
    sort,
    weights: {
      name: typeof weightsRecord.name === 'number' ? weightsRecord.name : 1,
      description: typeof weightsRecord.description === 'number' ? weightsRecord.description : 1,
      tags: typeof weightsRecord.tags === 'number' ? weightsRecord.tags : 1
    }
  };
}

function mapBuildListMeta(input: unknown): BuildListMeta {
  const record = isRecord(input) ? input : {};
  return {
    total: typeof record.total === 'number' ? record.total : 0,
    count: typeof record.count === 'number' ? record.count : 0,
    limit: typeof record.limit === 'number' ? record.limit : 10,
    offset: typeof record.offset === 'number' ? record.offset : 0,
    nextOffset:
      typeof record.nextOffset === 'number'
        ? record.nextOffset
        : record.hasMore
          ? ((typeof record.offset === 'number' ? record.offset : 0) + (typeof record.count === 'number' ? record.count : 0))
          : null,
    hasMore: Boolean(record.hasMore)
  } satisfies BuildListMeta;
}

function mapIngestionEvent(record: unknown): IngestionEvent | null {
  if (!isRecord(record)) {
    return null;
  }
  const idRaw = record.id;
  if (typeof idRaw !== 'number') {
    return null;
  }
  return {
    id: idRaw,
    repositoryId:
      typeof record.repositoryId === 'string' ? record.repositoryId : String(record.repositoryId ?? ''),
    status: typeof record.status === 'string' ? record.status : 'unknown',
    message: typeof record.message === 'string' ? record.message : null,
    attempt: typeof record.attempt === 'number' ? record.attempt : null,
    commitSha: typeof record.commitSha === 'string' ? record.commitSha : null,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
  } satisfies IngestionEvent;
}

function mapService(record: unknown): ServiceSummary | null {
  if (!isRecord(record)) {
    return null;
  }
  return {
    id: typeof record.id === 'string' ? record.id : String(record.id ?? ''),
    slug: typeof record.slug === 'string' ? record.slug : '',
    displayName: typeof record.displayName === 'string' ? record.displayName : null,
    kind: typeof record.kind === 'string' ? record.kind : null,
    baseUrl: typeof record.baseUrl === 'string' ? record.baseUrl : null,
    status: typeof record.status === 'string' ? record.status : 'unknown',
    statusMessage: typeof record.statusMessage === 'string' ? record.statusMessage : null,
    capabilities: record.capabilities ?? null,
    metadata: (record.metadata as ServiceSummary['metadata']) ?? null,
    lastHealthyAt: typeof record.lastHealthyAt === 'string' ? record.lastHealthyAt : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
  } satisfies ServiceSummary;
}

function normalizeError(error: unknown): never {
  if (error instanceof CoreApiError) {
    throw error;
  }
  if (error instanceof ApiError) {
    const status = error.status ?? 500;
    const body = error.body;
    let message = error.message || `Core request failed with status ${status}`;
    if (typeof body === 'string') {
      const trimmed = body.trim();
      if (trimmed.length > 0) {
        message = trimmed;
      }
    } else if (isRecord(body)) {
      const container = body as Record<string, unknown>;
      const candidate = container.error ?? container.message;
      if (typeof candidate === 'string' && candidate.trim().length > 0) {
        message = candidate.trim();
      } else if (Array.isArray(container.formErrors)) {
        const first = container.formErrors.find(
          (entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
        );
        if (first) {
          message = first.trim();
        }
      }
    }
    throw new CoreApiError(message, status, body);
  }
  if (error instanceof Error) {
    throw error;
  }
  throw new CoreApiError(String(error), 500);
}

async function execute<T>(promise: CancelablePromiseLike<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await resolveCancelable(promise, signal);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    normalizeError(error);
  }
}

function extractErrorFromEnvelope(payload: unknown): CoreApiError | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
    return new CoreApiError(payload.error.trim(), 400, payload);
  }
  return null;
}

function ensureArray<T>(value: unknown, mapper: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: T[] = [];
  for (const entry of value) {
    const mapped = mapper(entry);
    if (mapped !== null) {
      result.push(mapped);
    }
  }
  return result;
}

export type SearchRepositoriesParams = {
  query?: string;
  tags?: string[];
  statuses?: string[];
  sort?: 'relevance' | 'updated' | 'name';
  ingestedAfter?: string;
  ingestedBefore?: string;
};

export type SearchRepositoriesResult = {
  repositories: AppRecord[];
  facets: {
    tags: TagFacet[];
    statuses: StatusFacet[];
    owners: TagFacet[];
    frameworks: TagFacet[];
  };
  total: number;
  meta: SearchMeta;
};

export async function searchRepositories(
  token: Token,
  params: SearchRepositoriesParams = {},
  options: { signal?: AbortSignal } = {}
): Promise<SearchRepositoriesResult> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: '/apps',
      query: {
        q: params.query,
        tags: params.tags?.join(' '),
        status: params.statuses?.join(','),
        sort: params.sort,
        ingestedAfter: params.ingestedAfter,
        ingestedBefore: params.ingestedBefore
      }
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  const payload = isRecord(response) ? response : {};
  const repositories = ensureArray(payload.data, (entry) => mapRepository(entry));
  const facets = mapSearchFacets(payload.facets);
  const total = typeof payload.total === 'number' ? payload.total : repositories.length;
  const meta = mapSearchMeta(payload.meta);

  return {
    repositories,
    facets,
    total,
    meta
  };
}

export async function suggestTags(
  token: Token,
  options: { prefix: string; limit?: number },
  requestOptions: { signal?: AbortSignal } = {}
): Promise<TagSuggestion[]> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: '/tags/suggest',
      query: {
        prefix: options.prefix,
        limit: options.limit ?? 12
      }
    }) as CancelablePromiseLike<unknown>,
    requestOptions.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  return ensureArray(response && (response as Record<string, unknown>).data, (entry) => {
    if (!isRecord(entry)) {
      return null;
    }
    const type = entry.type === 'pair' ? 'pair' : 'key';
    const value = typeof entry.value === 'string' ? entry.value : null;
    const label = typeof entry.label === 'string' ? entry.label : value;
    if (!value || !label) {
      return null;
    }
    return { type, value, label } satisfies TagSuggestion;
  });
}

export type ListBuildsParams = {
  appId: string;
  limit?: number;
  offset?: number;
};

export async function listBuilds(
  token: Token,
  params: ListBuildsParams,
  options: { signal?: AbortSignal } = {}
): Promise<{ builds: BuildSummary[]; meta: BuildListMeta }> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: `/apps/${encodeURIComponent(params.appId)}/builds`,
      query: {
        limit: params.limit,
        offset: params.offset
      }
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  const payload = isRecord(response) ? response : {};
  const builds = ensureArray(payload.data, (entry) => mapBuild(entry)).filter(
    (entry): entry is BuildSummary => entry !== null
  );
  const meta = mapBuildListMeta(payload.meta);

  return { builds, meta };
}

export async function fetchBuildLogs(
  token: Token,
  buildId: string,
  options: { signal?: AbortSignal } = {}
): Promise<{ logs: string; size: number; updatedAt: string | null; hasLogs: boolean; truncated: boolean }> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: `/builds/${encodeURIComponent(buildId)}/logs`
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  const data = isRecord(response) && isRecord(response.data) ? response.data : {};
  const logs = typeof data.logs === 'string' ? data.logs : '';
  const size = typeof data.logsSize === 'number' ? data.logsSize : logs.length;
  const updatedAt = typeof data.updatedAt === 'string' ? data.updatedAt : null;
  const truncated = Boolean(data.logsTruncated);
  const hasLogs = Boolean(data.hasLogs);

  return { logs, size, updatedAt, hasLogs, truncated };
}

export async function triggerBuild(
  token: Token,
  appId: string,
  body: { branch?: string; ref?: string },
  options: { signal?: AbortSignal } = {}
): Promise<BuildSummary> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: `/apps/${encodeURIComponent(appId)}/builds`,
      body,
      mediaType: 'application/json'
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  const build = mapBuild(envelope.data);
  if (!build) {
    throw new CoreApiError('Unable to parse build payload', 500, response);
  }
  return build;
}

export async function retryBuild(
  token: Token,
  buildId: string,
  options: { signal?: AbortSignal } = {}
): Promise<BuildSummary> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: `/builds/${encodeURIComponent(buildId)}/retry`
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  const build = mapBuild(envelope.data);
  if (!build) {
    throw new CoreApiError('Unable to parse retry build payload', 500, response);
  }
  return build;
}

export async function listLaunches(
  token: Token,
  appId: string,
  options: { signal?: AbortSignal; limit?: number } = {}
): Promise<LaunchSummary[]> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: `/apps/${encodeURIComponent(appId)}/launches`,
      query: {
        limit: options.limit
      }
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  return ensureArray(response && (response as Record<string, unknown>).data, (entry) =>
    mapLaunch(entry)
  ).filter((launch): launch is LaunchSummary => launch !== null);
}

export type LaunchResult = {
  repository?: AppRecord | null;
  launch?: LaunchSummary | null;
};

export async function launchApp(
  token: Token,
  appId: string,
  draft: LaunchRequestDraft,
  options: { signal?: AbortSignal } = {}
): Promise<LaunchResult> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: `/apps/${encodeURIComponent(appId)}/launch`,
      body: draft,
      mediaType: 'application/json'
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  const data = isRecord(envelope.data) ? envelope.data : {};
  return {
    repository: mapRepository(data.repository ?? null),
    launch: mapLaunch(data.launch ?? null)
  };
}

export async function stopLaunch(
  token: Token,
  appId: string,
  launchId: string,
  options: { signal?: AbortSignal } = {}
): Promise<LaunchResult> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: `/apps/${encodeURIComponent(appId)}/launches/${encodeURIComponent(launchId)}/stop`
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  const data = isRecord(envelope.data) ? envelope.data : {};
  return {
    repository: mapRepository(data.repository ?? null),
    launch: mapLaunch(data.launch ?? null)
  };
}

export async function fetchHistory(
  token: Token,
  appId: string,
  options: { signal?: AbortSignal } = {}
): Promise<IngestionEvent[]> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: `/apps/${encodeURIComponent(appId)}/history`
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  return ensureArray(response && (response as Record<string, unknown>).data, (entry) =>
    mapIngestionEvent(entry)
  ).filter((event): event is IngestionEvent => event !== null);
}

export async function retryIngestion(
  token: Token,
  appId: string,
  options: { signal?: AbortSignal } = {}
): Promise<AppRecord | null> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'POST',
      url: `/apps/${encodeURIComponent(appId)}/retry`
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  return envelope.data ? mapRepository(envelope.data) : null;
}

export async function fetchRepository(
  token: Token,
  appId: string,
  options: { signal?: AbortSignal } = {}
): Promise<AppRecord> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: `/apps/${encodeURIComponent(appId)}`
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  const repository = mapRepository(envelope.data);
  if (!repository) {
    throw new CoreApiError('Repository payload missing', 500, response);
  }
  return repository;
}

export async function listServices(
  token: Token,
  options: { signal?: AbortSignal } = {}
): Promise<ServiceSummary[]> {
  const client = createClient(token);
  const response = await execute(
    client.services.getServices({}) as CancelablePromise<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }

  const data = isRecord(response) ? response.data : null;
  return ensureArray(data, (entry) => mapService(entry)).filter(
    (service): service is ServiceSummary => service !== null
  );
}

export async function fetchQueueHealth(
  token: Token,
  options: { signal?: AbortSignal } = {}
): Promise<unknown> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: '/admin/queue-health'
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }
  return response && isRecord(response) ? response.data ?? response : response;
}

export async function fetchCoreMetrics(
  token: Token,
  options: { signal?: AbortSignal } = {}
): Promise<unknown> {
  const client = createClient(token);
  const response = await execute(
    client.request.request({
      method: 'GET',
      url: '/metrics'
    }) as CancelablePromiseLike<unknown>,
    options.signal
  );

  const error = extractErrorFromEnvelope(response);
  if (error) {
    throw error;
  }
  return response;
}

export interface SubmitRepositoryPayload {
  id: string;
  name: string;
  description: string;
  repoUrl: string;
  dockerfilePath: string;
  tags: Array<{ key: string; value: string }>;
  metadataStrategy?: 'auto' | 'explicit';
}

export async function submitRepository(
  token: Token,
  payload: SubmitRepositoryPayload,
  options: { signal?: AbortSignal } = {}
): Promise<AppRecord> {
  const response = await coreRequest<{ data?: unknown }>(token, {
    method: 'POST',
    url: '/apps',
    body: payload,
    signal: options.signal
  });

  const envelope = isRecord(response) ? response : {};
  const error = extractErrorFromEnvelope(envelope);
  if (error) {
    throw error;
  }
  const repository = mapRepository(envelope.data);
  if (!repository) {
    throw new CoreApiError('Repository payload missing', 500, response);
  }
  return repository;
}

type CoreRequestOptions = {
  method?: ApiRequestOptions['method'] | string;
  url: string;
  query?: ApiRequestOptions['query'];
  body?: ApiRequestOptions['body'];
  mediaType?: ApiRequestOptions['mediaType'];
  headers?: ApiRequestOptions['headers'];
  responseHeader?: ApiRequestOptions['responseHeader'];
  signal?: AbortSignal;
};

export async function coreRequest<T = unknown>(token: Token, options: CoreRequestOptions): Promise<T> {
  const client = createClient(token);
  const rawMethod = options.method ?? 'GET';
  const method = (typeof rawMethod === 'string' ? rawMethod.toUpperCase() : rawMethod) as ApiRequestOptions['method'];
  const shouldDefaultJson =
    options.body !== undefined &&
    options.body !== null &&
    !(options.body instanceof FormData) &&
    !options.mediaType;
  const mediaType = shouldDefaultJson ? 'application/json' : options.mediaType;
  const requestOptions: ApiRequestOptions = {
    method,
    url: options.url,
    query: options.query,
    body: options.body,
    mediaType,
    headers: options.headers,
    responseHeader: options.responseHeader
  };

  const promise = client.request.request(requestOptions) as CancelablePromiseLike<T>;
  return execute<T>(promise, options.signal);
}
