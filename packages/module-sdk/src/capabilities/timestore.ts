import { CapabilityRequestError } from '../errors';
import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

type TimestoreFieldType = 'timestamp' | 'string' | 'double' | 'integer' | 'boolean';

export interface TimestoreCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface TableSchemaField {
  name: string;
  type: TimestoreFieldType;
}

export interface SchemaEvolutionOptions {
  defaults?: Record<string, unknown>;
  backfill?: boolean;
}

export interface DatasetSchema {
  fields: TableSchemaField[];
  evolution?: SchemaEvolutionOptions;
}

export interface PartitionDefinition {
  key: Record<string, string>;
  attributes?: Record<string, string>;
  timeRange: {
    start: string;
    end: string;
  };
}

export interface IngestRecordsInput {
  datasetSlug: string;
  datasetName?: string;
  storageTargetId?: string;
  tableName?: string;
  schema: DatasetSchema;
  partition: PartitionDefinition;
  rows: Array<Record<string, unknown>>;
  idempotencyKey?: string;
  principal?: string;
  actor?: {
    id: string;
    scopes?: string[];
  };
}

export interface DatasetRecord {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  status?: 'active' | 'inactive';
  writeFormat?: string;
  defaultStorageTargetId?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface IngestRecordsResult {
  mode: 'inline' | 'queued';
  manifest?: Record<string, unknown> | null;
  dataset?: DatasetRecord | null;
  storageTarget?: Record<string, unknown> | null;
  jobId?: string | null;
}

export interface PartitionBuildInput {
  datasetSlug: string;
  partitionKey: string;
  principal?: string;
  idempotencyKey?: string;
}

export interface QueryDatasetInput {
  datasetSlug: string;
  timeRange: {
    start: string;
    end: string;
  };
  timestampColumn?: string;
  columns?: string[];
  filters?: Record<string, unknown>;
  downsample?: Record<string, unknown>;
  limit?: number;
  principal?: string;
}

export interface QueryDatasetResult {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  mode: 'raw' | 'downsampled';
}

export interface GetDatasetInput {
  datasetId?: string;
  datasetSlug?: string;
  principal?: string;
  searchLimit?: number;
}

interface IngestApiResponse {
  mode?: 'inline' | 'queued';
  manifest?: Record<string, unknown> | null;
  dataset?: DatasetRecord | null;
  storageTarget?: Record<string, unknown> | null;
  jobId?: string | null;
}

interface DatasetListResponse {
  datasets?: DatasetRecord[];
  nextCursor?: string | null;
}

interface DatasetEnvelope {
  dataset?: DatasetRecord;
}

const DEFAULT_DATASET_SEARCH_LIMIT = 20;

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, '');
}

function sanitizeRequestBody<T extends Record<string, unknown>>(body: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined) {
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeRequestBody(value as Record<string, unknown>);
      continue;
    }
    result[key] = value;
  }
  return result as T;
}

export interface TimestoreCapability {
  ingestPartition(input: IngestRecordsInput): Promise<IngestRecordsResult>;
  ingestRecords(input: IngestRecordsInput): Promise<IngestRecordsResult>;
  triggerPartitionBuild(input: PartitionBuildInput): Promise<void>;
  queryDataset(input: QueryDatasetInput): Promise<QueryDatasetResult>;
  getDataset(input: GetDatasetInput): Promise<DatasetRecord | null>;
}

export function createTimestoreCapability(config: TimestoreCapabilityConfig): TimestoreCapability {
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  async function ingest(input: IngestRecordsInput): Promise<IngestRecordsResult> {
    const payload = sanitizeRequestBody({
      datasetName: input.datasetName,
      storageTargetId: input.storageTargetId,
      tableName: input.tableName,
      schema: input.schema,
      partition: input.partition,
      rows: input.rows,
      idempotencyKey: input.idempotencyKey,
      actor: input.actor
    });

    const response = await httpRequest<IngestApiResponse>({
      baseUrl,
      path: `/v1/datasets/${encodeURIComponent(input.datasetSlug)}/ingest`,
      method: 'POST',
      authToken: config.token,
      principal: input.principal,
      idempotencyKey: input.idempotencyKey,
      fetchImpl: config.fetchImpl,
      body: payload,
      expectJson: true
    });

    const data = response.data ?? {};
    const mode = data.mode === 'queued' ? 'queued' : 'inline';
    return {
      mode,
      manifest: data.manifest ?? null,
      dataset: data.dataset ?? null,
      storageTarget: data.storageTarget ?? null,
      jobId: data.jobId ?? null
    } satisfies IngestRecordsResult;
  }

  return {
    ingestPartition: ingest,
    ingestRecords: ingest,

    async triggerPartitionBuild(input: PartitionBuildInput): Promise<void> {
      await httpRequest({
        baseUrl,
        path: `/v1/datasets/${encodeURIComponent(input.datasetSlug)}/partitions/${encodeURIComponent(input.partitionKey)}/build`,
        method: 'POST',
        authToken: config.token,
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        expectJson: true
      });
    },

    async queryDataset(input: QueryDatasetInput): Promise<QueryDatasetResult> {
      const body = sanitizeRequestBody({
        timeRange: input.timeRange,
        timestampColumn: input.timestampColumn,
        columns: input.columns,
        filters: input.filters,
        downsample: input.downsample,
        limit: input.limit
      });

      const response = await httpRequest<QueryDatasetResult>({
        baseUrl,
        path: `/v1/datasets/${encodeURIComponent(input.datasetSlug)}/query`,
        method: 'POST',
        authToken: config.token,
        principal: input.principal,
        fetchImpl: config.fetchImpl,
        body,
        expectJson: true
      });

      const result = response.data ?? { rows: [], columns: [], mode: 'raw' };
      return {
        rows: Array.isArray(result.rows) ? result.rows : [],
        columns: Array.isArray(result.columns) ? result.columns : [],
        mode: result.mode === 'downsampled' ? 'downsampled' : 'raw'
      } satisfies QueryDatasetResult;
    },

    async getDataset(input: GetDatasetInput): Promise<DatasetRecord | null> {
      const principal = input.principal;
      if (input.datasetId) {
        try {
          const response = await httpRequest<DatasetEnvelope>({
            baseUrl,
            path: `/admin/datasets/${encodeURIComponent(input.datasetId)}`,
            method: 'GET',
            authToken: config.token,
            principal,
            fetchImpl: config.fetchImpl,
            expectJson: true
          });
          return response.data?.dataset ?? null;
        } catch (error) {
          if (error instanceof CapabilityRequestError && error.status === 404) {
            return null;
          }
          throw error;
        }
      }

      const slug = input.datasetSlug?.trim();
      if (!slug) {
        throw new Error('getDataset requires datasetId or datasetSlug');
      }

      try {
        const response = await httpRequest<DatasetListResponse>({
          baseUrl,
          path: '/admin/datasets',
          method: 'GET',
          authToken: config.token,
          principal,
          fetchImpl: config.fetchImpl,
          query: {
            limit: input.searchLimit ?? DEFAULT_DATASET_SEARCH_LIMIT,
            search: slug
          },
          expectJson: true
        });

        const datasets = Array.isArray(response.data?.datasets) ? response.data?.datasets ?? [] : [];
        return datasets.find((candidate) => candidate.slug === slug) ?? null;
      } catch (error) {
        if (error instanceof CapabilityRequestError && error.status === 404) {
          return null;
        }
        throw error;
      }
    }
  } satisfies TimestoreCapability;
}
