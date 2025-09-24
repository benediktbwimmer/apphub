import { API_BASE_URL } from '../config';
import {
  ApiError,
  ensureOk,
  parseJson,
  type AuthorizedFetch
} from '../workflows/api';
import { normalizeWorkflowRun } from '../workflows/normalizers';
import type { WorkflowRun } from '../workflows/types';
import { normalizeAssetGraphResponse } from './normalizers';
import type { AssetGraphData } from './types';

export type SavedPartitionParameters = {
  partitionKey: string | null;
  parameters: unknown;
  source: string | null;
  capturedAt: string;
  updatedAt: string;
};

export async function fetchAssetGraph(fetcher: AuthorizedFetch): Promise<AssetGraphData> {
  const response = await fetcher(`${API_BASE_URL}/assets/graph`);
  await ensureOk(response, 'Failed to load asset graph');
  const payload = await parseJson<{ data?: unknown }>(response);
  const normalized = normalizeAssetGraphResponse(payload);
  if (!normalized) {
    throw new ApiError('Failed to parse asset graph', response.status, payload);
  }
  return normalized;
}

export async function markAssetPartitionStale(
  fetcher: AuthorizedFetch,
  slug: string,
  assetId: string,
  options: { partitionKey?: string | null; note?: string | null } = {}
): Promise<void> {
  const body: Record<string, string> = {};
  if (options.partitionKey && options.partitionKey.length > 0) {
    body.partitionKey = options.partitionKey;
  }
  if (options.note && options.note.length > 0) {
    body.note = options.note;
  }
  const url = `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/stale`;
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await ensureOk(response, 'Failed to mark asset partition stale');
}

export async function clearAssetPartitionStale(
  fetcher: AuthorizedFetch,
  slug: string,
  assetId: string,
  partitionKey?: string | null
): Promise<void> {
  const query = partitionKey ? `?partitionKey=${encodeURIComponent(partitionKey)}` : '';
  const url = `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/stale${query}`;
  const response = await fetcher(url, { method: 'DELETE' });
  await ensureOk(response, 'Failed to clear asset partition stale flag');
}

export async function triggerWorkflowRun(
  fetcher: AuthorizedFetch,
  slug: string,
  options: { partitionKey?: string | null; triggeredBy?: string | null; parameters?: unknown } = {}
): Promise<WorkflowRun> {
  const body: Record<string, unknown> = {
    triggeredBy: options.triggeredBy ?? 'assets-ui'
  };
  if (options.partitionKey && options.partitionKey.length > 0) {
    body.partitionKey = options.partitionKey;
  }
  if (options.parameters !== undefined) {
    body.parameters = options.parameters;
  }
  const response = await fetcher(`${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await ensureOk(response, 'Failed to trigger workflow run');
  const payload = await parseJson<{ data?: unknown }>(response);
  const runRecord = normalizeWorkflowRun(payload?.data);
  if (!runRecord) {
    throw new ApiError('Failed to parse workflow run response', response.status, payload);
  }
  return runRecord;
}

export async function saveAssetPartitionParameters(
  fetcher: AuthorizedFetch,
  slug: string,
  assetId: string,
  input: { partitionKey?: string | null; parameters: unknown }
): Promise<SavedPartitionParameters> {
  const url = `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/partition-parameters`;
  const body: Record<string, unknown> = {
    parameters: input.parameters
  };
  if (input.partitionKey === null) {
    body.partitionKey = null;
  } else if (typeof input.partitionKey === 'string' && input.partitionKey.length > 0) {
    body.partitionKey = input.partitionKey;
  }
  const response = await fetcher(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  await ensureOk(response, 'Failed to save partition parameters');
  const payload = await parseJson<{ data?: unknown }>(response);
  const data = (payload?.data ?? null) as Record<string, unknown> | null;
  const partitionKey = typeof data?.partitionKey === 'string' && data.partitionKey.length > 0 ? data.partitionKey : null;
  return {
    partitionKey,
    parameters: data?.parameters ?? null,
    source: typeof data?.source === 'string' ? data.source : null,
    capturedAt:
      typeof data?.capturedAt === 'string' ? data.capturedAt : new Date().toISOString(),
    updatedAt:
      typeof data?.updatedAt === 'string'
        ? data.updatedAt
        : typeof data?.capturedAt === 'string'
          ? data.capturedAt
          : new Date().toISOString()
  } satisfies SavedPartitionParameters;
}

export async function deleteAssetPartitionParameters(
  fetcher: AuthorizedFetch,
  slug: string,
  assetId: string,
  partitionKey?: string | null
): Promise<void> {
  const params = new URLSearchParams();
  if (typeof partitionKey === 'string' && partitionKey.length > 0) {
    params.set('partitionKey', partitionKey);
  }
  const query = params.toString();
  const url = `${API_BASE_URL}/workflows/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}/partition-parameters${query ? `?${query}` : ''}`;
  const response = await fetcher(url, { method: 'DELETE' });
  await ensureOk(response, 'Failed to delete partition parameters');
}
