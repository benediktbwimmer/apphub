import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface CoreWorkflowsCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface WorkflowAssetSummary {
  partitionKey: string | null;
  producedAt: string | null;
  payload: unknown;
  metadata?: Record<string, unknown> | null;
}

export interface ListWorkflowAssetPartitionsInput {
  workflowSlug: string;
  assetId: string;
  lookback?: number;
  principal?: string;
  partitionKey?: string;
}

export type ListWorkflowAssetPartitionsResponse = Record<string, unknown> & {
  data?: {
    partitions?: unknown;
    [key: string]: unknown;
  };
};

export interface EnqueueWorkflowRunInput {
  workflowSlug: string;
  partitionKey: string;
  parameters?: Record<string, unknown>;
  runKey?: string | null;
  triggeredBy?: string | null;
  metadata?: Record<string, unknown>;
  principal?: string;
  idempotencyKey?: string;
}

export type EnqueueWorkflowRunResponse = Record<string, unknown> & {
  data?: Record<string, unknown> | undefined;
};

export interface GetWorkflowRunInput {
  runId: string;
  principal?: string;
}

export type GetWorkflowRunResponse = Record<string, unknown> & {
  data?: Record<string, unknown> | undefined;
};

export interface CoreWorkflowsCapability {
  listAssetPartitions(
    input: ListWorkflowAssetPartitionsInput
  ): Promise<ListWorkflowAssetPartitionsResponse>;
  enqueueWorkflowRun(input: EnqueueWorkflowRunInput): Promise<EnqueueWorkflowRunResponse>;
  getWorkflowRun(input: GetWorkflowRunInput): Promise<GetWorkflowRunResponse>;
  getLatestAsset(
    input: ListWorkflowAssetPartitionsInput
  ): Promise<WorkflowAssetSummary | null>;
}

function normalizePayload<T extends Record<string, unknown>>(value: T | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) {
      result[key] = entry;
    }
  }
  return result as T;
}

export function createCoreWorkflowsCapability(
  config: CoreWorkflowsCapabilityConfig
): CoreWorkflowsCapability {
  async function listAssetPartitions(
    input: ListWorkflowAssetPartitionsInput
  ): Promise<ListWorkflowAssetPartitionsResponse> {
    const query: Record<string, string | number> = {};
    if (input.lookback !== undefined) {
      query.lookback = input.lookback;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'partitionKey')) {
      query.partitionKey = input.partitionKey ?? '';
    }
    const response = await httpRequest<ListWorkflowAssetPartitionsResponse>({
      baseUrl: config.baseUrl,
      path: `/workflows/${encodeURIComponent(input.workflowSlug)}/assets/${encodeURIComponent(input.assetId)}/partitions`,
      method: 'GET',
      query: Object.keys(query).length > 0 ? query : undefined,
      authToken: config.token,
      principal: input.principal,
      fetchImpl: config.fetchImpl
    });
    return response.data ?? {};
  }

  async function enqueueWorkflowRun(
    input: EnqueueWorkflowRunInput
  ): Promise<EnqueueWorkflowRunResponse> {
    const payload = normalizePayload({
      partitionKey: input.partitionKey,
      parameters: input.parameters,
      runKey: input.runKey ?? undefined,
      triggeredBy: input.triggeredBy ?? undefined,
      metadata: input.metadata
    });

    const response = await httpRequest<EnqueueWorkflowRunResponse>({
      baseUrl: config.baseUrl,
      path: `/workflows/${encodeURIComponent(input.workflowSlug)}/run`,
      method: 'POST',
      authToken: config.token,
      principal: input.principal,
      idempotencyKey: input.idempotencyKey,
      body: payload,
      fetchImpl: config.fetchImpl
    });
    return response.data ?? {};
  }

  async function getWorkflowRun(input: GetWorkflowRunInput): Promise<GetWorkflowRunResponse> {
    const response = await httpRequest<GetWorkflowRunResponse>({
      baseUrl: config.baseUrl,
      path: `/workflow-runs/${encodeURIComponent(input.runId)}`,
      method: 'GET',
      authToken: config.token,
      principal: input.principal,
      fetchImpl: config.fetchImpl
    });
    return response.data ?? {};
  }

  async function getLatestAsset(
    input: ListWorkflowAssetPartitionsInput
  ): Promise<WorkflowAssetSummary | null> {
    function isRecord(value: unknown): value is Record<string, unknown> {
      return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function extractAsset(entry: unknown): Record<string, unknown> | null {
      if (!isRecord(entry)) {
        return null;
      }
      const nested = entry.asset;
      if (isRecord(nested)) {
        return nested;
      }
      // Some API responses flatten asset fields onto `latest`
      if ('assetId' in entry || 'partitionKey' in entry || 'partition_key' in entry) {
        return entry;
      }
      return null;
    }

    const { partitionKey } = input;
    const normalizeWindow = (value: string): string => value.replace(/[:\s]+/g, '-');
    const partitionKeyMatches = (requested: string, candidate: string | null): boolean => {
      if (!candidate) {
        return false;
      }
      if (candidate === requested) {
        return true;
      }
      if (!requested.includes('=') && candidate.includes('window=')) {
        const normalized = normalizeWindow(requested);
        return candidate.includes(`window=${normalized}`);
      }
      return false;
    };
    const lookback = input.lookback ?? 10;
    const response = await listAssetPartitions({
      ...input,
      lookback
    });
    const partitions = Array.isArray(response.data?.partitions)
      ? (response.data?.partitions as Array<Record<string, unknown>>)
      : [];

    let latest: WorkflowAssetSummary | null = null;
    for (const entry of partitions) {
      const latestEntry = entry.latest as Record<string, unknown> | undefined;
      const asset = extractAsset(latestEntry ?? null);
      if (!asset) {
        continue;
      }
      const producedAt = typeof asset.producedAt === 'string' ? asset.producedAt : null;
      if (!latest || (producedAt && latest.producedAt && producedAt > latest.producedAt)) {
        const entryPartitionKey =
          typeof asset.partitionKey === 'string'
            ? asset.partitionKey
            : typeof asset.partition_key === 'string'
              ? asset.partition_key
              : null;
        if (partitionKey && !partitionKeyMatches(partitionKey, entryPartitionKey)) {
          continue;
        }
        latest = {
          partitionKey: entryPartitionKey,
          producedAt,
          payload: asset.payload,
          metadata:
            isRecord(latestEntry?.metadata)
              ? (latestEntry?.metadata as Record<string, unknown>)
              : isRecord(asset.metadata)
                ? (asset.metadata as Record<string, unknown>)
              : undefined
        } satisfies WorkflowAssetSummary;
      }
    }
    return latest;
  }

  return {
    listAssetPartitions,
    enqueueWorkflowRun,
    getWorkflowRun,
    getLatestAsset
  } satisfies CoreWorkflowsCapability;
}
