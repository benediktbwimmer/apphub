import { requestJson } from './http';
import { TIMESTORE_BASE_URL, OPERATOR_TOKEN } from './env';

export interface TimestoreClientOptions {
  baseUrl?: string;
  token?: string;
}

export interface DatasetQueryRequest {
  timeRange: {
    start: string;
    end: string;
  };
  timestampColumn?: string;
  columns?: string[] | null;
  limit?: number;
  downsample?: {
    intervalUnit?: 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month';
    intervalSize?: number;
    aggregations: Array<{
      fn: 'avg' | 'min' | 'max' | 'sum' | 'median' | 'count' | 'count_distinct' | 'percentile';
      column?: string;
      alias?: string;
      percentile?: number;
    }>;
  } | null;
  filters?: Record<string, unknown> | null;
}

export interface DatasetQueryResponse {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  mode: string;
  warnings?: string[];
  streaming?: Record<string, unknown> | null;
  sources?: {
    published: {
      rows: number;
      partitions: number;
    };
    staging: {
      rows: number;
    };
    hotBuffer: {
      rows: number;
    };
  };
}

type DatasetQueryPayload =
  | { data: DatasetQueryResponse }
  | DatasetQueryResponse;

export interface DatasetIngestionRequest {
  datasetName?: string;
  storageTargetId?: string;
  tableName?: string;
  schema: {
    fields: Array<{ name: string; type: string }>;
    evolution?: Record<string, unknown>;
  };
  partition: {
    key: Record<string, string>;
    attributes?: Record<string, string>;
    timeRange: {
      start: string;
      end: string;
    };
  };
  rows: Array<Record<string, unknown>>;
  idempotencyKey?: string;
}

export interface DatasetRecordSummary {
  id: string;
  slug: string;
  name: string;
  status: string;
  writeFormat: string;
  updatedAt: string;
  createdAt?: string;
  defaultStorageTargetId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DatasetDetailResponse {
  dataset: DatasetRecordSummary & {
    description: string | null;
    metadata: Record<string, unknown> | null;
  };
  etag?: string;
}

export interface DatasetManifestPartition {
  id: string;
  filePath: string;
  rowCount: number;
  storageTargetId?: string;
}

export interface DatasetManifestPayload {
  datasetId: string;
  manifest?: {
    id: string;
    version: number;
    manifestShard?: string | null;
    totalRows?: number;
    partitions: DatasetManifestPartition[];
  };
  manifests?: Array<{
    id: string;
    version: number;
    manifestShard?: string | null;
    totalRows?: number;
    partitions: DatasetManifestPartition[];
  }>;
  staging?: {
    totalRows: number;
    batches: Array<{
      batchId: string;
      tableName: string;
      rowCount: number;
      timeRange: {
        start: string;
        end: string;
      };
      stagedAt: string;
      schema: Array<{
        name: string;
        type: string;
      }>;
    }>;
  };
}

export type DatasetFlushResponse =
  | {
      mode: 'inline';
      status: 'noop' | 'flushed';
      batches: number;
      rows: number;
      manifest: {
        id: string;
        version: number;
        shard: string | null;
      } | null;
    }
  | {
      mode: 'queued';
      status: 'queued';
      jobId: string;
      datasetSlug?: string;
    };

export interface SqlReadResponse {
  executionId: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
  warnings?: string[];
  statistics?: {
    rowCount: number;
    elapsedMs?: number;
  };
}

export interface SqlExecResponse {
  command: string;
  rowCount: number;
}

export interface SqlSchemaResponse {
  fetchedAt: string;
  tables: Array<{
    name: string;
    description?: string | null;
    columns: Array<Record<string, unknown>>;
    partitionKeys?: string[];
  }>;
  warnings?: string[];
}

export interface StreamingStatusResponse {
  enabled: boolean;
  state: 'disabled' | 'ready' | 'degraded' | 'unconfigured';
  reason: string | null;
  broker: Record<string, unknown>;
  batchers: Record<string, unknown>;
  hotBuffer: {
    enabled: boolean;
    state: 'disabled' | 'ready' | 'unavailable';
    datasets: number;
    healthy: boolean;
    lastRefreshAt: string | null;
    lastIngestAt: string | null;
  };
}

export interface HotBufferUpdateRequest {
  watermark?: string;
  rows?: Array<{
    timestamp: string;
    payload: Record<string, unknown>;
  }>;
  enabled?: boolean;
  state?: 'ready' | 'unavailable';
  clear?: boolean;
}

export class TimestoreClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(options: TimestoreClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? TIMESTORE_BASE_URL;
    this.token = options.token ?? OPERATOR_TOKEN;
  }

  private resolve(pathname: string): string {
    return new URL(pathname, `${this.baseUrl.replace(/\/+$/, '')}/`).toString();
  }

  private authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  async ingestDataset(slug: string, request: DatasetIngestionRequest): Promise<number> {
    const response = await requestJson<Record<string, unknown>>(
      this.resolve(`/datasets/${slug}/ingest`),
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: request,
        expectedStatus: [200, 201, 202]
      }
    );
    return response.status;
  }

  async queryDataset(slug: string, request: DatasetQueryRequest): Promise<DatasetQueryResponse> {
    const response = await requestJson<DatasetQueryPayload>(
      this.resolve(`/datasets/${slug}/query`),
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: request,
        expectedStatus: 200
      }
    );
    const payload = response.payload;
    if ('data' in payload) {
      return payload.data;
    }
    return payload as DatasetQueryResponse;
  }

  async getDataset(idOrSlug: string): Promise<DatasetDetailResponse> {
    const response = await requestJson<DatasetDetailResponse>(
      this.resolve(`/admin/datasets/${idOrSlug}`),
      {
        headers: this.authHeaders(),
        expectedStatus: 200
      }
    );
    return response.payload;
  }

  async listDatasets(): Promise<DatasetRecordSummary[]> {
    const response = await requestJson<{ datasets: DatasetRecordSummary[] }>(
      this.resolve('/admin/datasets'),
      {
        headers: this.authHeaders(),
        expectedStatus: 200
      }
    );
    return response.payload.datasets ?? [];
  }

  async getDatasetManifest(idOrSlug: string): Promise<DatasetManifestPayload | null> {
    const response = await requestJson<DatasetManifestPayload | { error: string }>(
      this.resolve(`/admin/datasets/${idOrSlug}/manifest`),
      {
        headers: this.authHeaders(),
        expectedStatus: [200, 404]
      }
    );
    if (response.status === 404) {
      return null;
    }
    return response.payload as DatasetManifestPayload;
  }

  async getSqlSchema(): Promise<SqlSchemaResponse> {
    const response = await requestJson<SqlSchemaResponse>(this.resolve('/sql/schema'), {
      headers: this.authHeaders(),
      expectedStatus: 200
    });
    return response.payload;
  }

  async sqlRead(sql: string): Promise<SqlReadResponse> {
    const response = await requestJson<SqlReadResponse>(this.resolve('/sql/read'), {
      method: 'POST',
      headers: this.authHeaders(),
      body: { sql },
      expectedStatus: 200
    });
    return response.payload;
  }

  async sqlExec(sql: string): Promise<SqlExecResponse> {
    const response = await requestJson<SqlExecResponse>(this.resolve('/sql/exec'), {
      method: 'POST',
      headers: this.authHeaders(),
      body: { sql },
      expectedStatus: 200
    });
    return response.payload;
  }

  async getStreamingStatus(): Promise<StreamingStatusResponse> {
    const response = await requestJson<StreamingStatusResponse>(
      this.resolve('/streaming/status'),
      {
        headers: this.authHeaders(),
        expectedStatus: 200
      }
    );
    return response.payload;
  }

  async updateHotBuffer(datasetSlug: string, payload: HotBufferUpdateRequest): Promise<void> {
    await requestJson<Record<string, unknown>>(
      this.resolve(`/__test__/streaming/hot-buffer/${datasetSlug}`),
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: payload,
        expectedStatus: 200
      }
    );
  }

  async triggerFlush(datasetIdOrSlug: string): Promise<DatasetFlushResponse> {
    const response = await requestJson<DatasetFlushResponse>(
      this.resolve(`/admin/datasets/${datasetIdOrSlug}/flush`),
      {
        method: 'POST',
        headers: this.authHeaders(),
        expectedStatus: [200, 202]
      }
    );
    return response.payload;
  }
}
