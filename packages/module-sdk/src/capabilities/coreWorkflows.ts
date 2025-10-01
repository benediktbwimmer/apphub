import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface CoreWorkflowsCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface ListWorkflowAssetPartitionsInput {
  workflowSlug: string;
  assetId: string;
  lookback?: number;
  principal?: string;
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
  return {
    async listAssetPartitions(
      input: ListWorkflowAssetPartitionsInput
    ): Promise<ListWorkflowAssetPartitionsResponse> {
      const response = await httpRequest<ListWorkflowAssetPartitionsResponse>({
        baseUrl: config.baseUrl,
        path: `/workflows/${encodeURIComponent(input.workflowSlug)}/assets/${encodeURIComponent(input.assetId)}/partitions`,
        method: 'GET',
        query: input.lookback !== undefined ? { lookback: input.lookback } : undefined,
        authToken: config.token,
        principal: input.principal,
        fetchImpl: config.fetchImpl
      });
      return response.data ?? {};
    },

    async enqueueWorkflowRun(
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
    },

    async getWorkflowRun(input: GetWorkflowRunInput): Promise<GetWorkflowRunResponse> {
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
  } satisfies CoreWorkflowsCapability;
}
