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
  options: { partitionKey?: string | null; triggeredBy?: string | null } = {}
): Promise<WorkflowRun> {
  const body: Record<string, unknown> = {
    triggeredBy: options.triggeredBy ?? 'assets-ui'
  };
  if (options.partitionKey && options.partitionKey.length > 0) {
    body.partitionKey = options.partitionKey;
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
