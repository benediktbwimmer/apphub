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
}

export interface DatasetQueryResponse {
  data: {
    rows: Array<Record<string, unknown>>;
    columns: string[];
    mode: string;
  };
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

  async queryDataset(slug: string, request: DatasetQueryRequest): Promise<DatasetQueryResponse['data']> {
    const response = await requestJson<DatasetQueryResponse>(
      this.resolve(`/datasets/${slug}/query`),
      {
        method: 'POST',
        headers: this.authHeaders(),
        body: request,
        expectedStatus: 200
      }
    );
    return response.payload.data;
  }
}
