import type { ModuleResourceContext, ModuleResourcesResponse, ModuleSummary } from './types';
import type { AuthorizedFetch as CoreAuthorizedFetch } from '../lib/apiClient';

export type AuthorizedFetch = CoreAuthorizedFetch;

type FetchOptions = {
  signal?: AbortSignal;
};

function mapModuleSummary(input: unknown): ModuleSummary | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const record = input as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : null;
  if (!id) {
    return null;
  }
  const displayName = typeof record.displayName === 'string' ? record.displayName : null;
  const description = typeof record.description === 'string' ? record.description : null;
  const keywords = Array.isArray(record.keywords)
    ? record.keywords.filter((value): value is string => typeof value === 'string')
    : [];
  const latestVersion = typeof record.latestVersion === 'string' ? record.latestVersion : null;
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString();
  const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt;
  return {
    id,
    displayName,
    description,
    keywords,
    latestVersion,
    createdAt,
    updatedAt
  } satisfies ModuleSummary;
}

function mapModuleResourceContext(input: unknown): ModuleResourceContext | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const record = input as Record<string, unknown>;
  const moduleId = typeof record.moduleId === 'string' ? record.moduleId : null;
  const resourceType = typeof record.resourceType === 'string' ? record.resourceType : null;
  const resourceId = typeof record.resourceId === 'string' ? record.resourceId : null;
  if (!moduleId || !resourceType || !resourceId) {
    return null;
  }
  return {
    moduleId,
    moduleVersion: typeof record.moduleVersion === 'string' ? record.moduleVersion : null,
    resourceType: resourceType as ModuleResourceContext['resourceType'],
    resourceId,
    resourceSlug: typeof record.resourceSlug === 'string' ? record.resourceSlug : null,
    resourceName: typeof record.resourceName === 'string' ? record.resourceName : null,
    resourceVersion: typeof record.resourceVersion === 'string' ? record.resourceVersion : null,
    isShared: Boolean(record.isShared),
    metadata: record.metadata ?? null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString()
  } satisfies ModuleResourceContext;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error('Unexpected response type from server');
  }
  return response.json();
}

export async function fetchModules(
  authorizedFetch: AuthorizedFetch,
  options: FetchOptions = {}
): Promise<ModuleSummary[]> {
  const response = await authorizedFetch('/modules', {
    method: 'GET',
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(`Failed to load modules (${response.status})`);
  }

  const payload = await parseJsonResponse(response);
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : null;
  if (!Array.isArray(data)) {
    return [];
  }
  return data
    .map((entry) => mapModuleSummary(entry))
    .filter((entry): entry is ModuleSummary => entry !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModuleResources(
  authorizedFetch: AuthorizedFetch,
  moduleId: string,
  options: FetchOptions = {}
): Promise<ModuleResourcesResponse> {
  const response = await authorizedFetch(`/modules/${encodeURIComponent(moduleId)}/resources`, {
    method: 'GET',
    signal: options.signal
  });

  if (!response.ok) {
    throw new Error(`Failed to load module resources (${response.status})`);
  }

  const payload = await parseJsonResponse(response);
  const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : null;
  if (!data || typeof data !== 'object') {
    return { moduleId, resourceType: null, resources: [] } satisfies ModuleResourcesResponse;
  }

  const result = data as Partial<ModuleResourcesResponse>;
  const resources = Array.isArray(result.resources) ? result.resources : [];
  return {
    moduleId: typeof result.moduleId === 'string' ? result.moduleId : moduleId,
    resourceType: (typeof result.resourceType === 'string' ? result.resourceType : null) as ModuleResourcesResponse['resourceType'],
    resources: resources
      .map((entry) => mapModuleResourceContext(entry))
      .filter((entry): entry is ModuleResourceContext => entry !== null)
  } satisfies ModuleResourcesResponse;
}
