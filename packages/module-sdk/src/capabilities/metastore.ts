import { CapabilityRequestError } from '../errors';
import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface MetastoreCapabilityConfig {
  baseUrl: string;
  namespace: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface UpsertRecordInput {
  key: string;
  metadata: Record<string, unknown>;
  version?: number;
  principal?: string;
  idempotencyKey?: string;
}

export interface GetRecordInput {
  key: string;
  principal?: string;
}

export interface GetRecordResult {
  metadata: Record<string, unknown>;
  version: number | null;
}

export interface SearchRecordsInput {
  limit?: number;
  sort?: Array<{ field: string; direction: 'asc' | 'desc' }>;
  filter?: Record<string, unknown>;
  principal?: string;
}

export interface SearchRecordsResult {
  records: Array<{ key: string; metadata: Record<string, unknown>; version: number | null }>;
}

export interface MetastoreCapability {
  upsertRecord(input: UpsertRecordInput): Promise<void>;
  getRecord(input: GetRecordInput): Promise<GetRecordResult | null>;
  searchRecords(input: SearchRecordsInput): Promise<SearchRecordsResult>;
}

function sanitizeKey(key: string): string {
  return key.replace(/\s+/g, '-').replace(/[^0-9A-Za-z._/\-]+/g, '-');
}

export function createMetastoreCapability(config: MetastoreCapabilityConfig): MetastoreCapability {
  return {
    async upsertRecord(input: UpsertRecordInput): Promise<void> {
      const sanitized = sanitizeKey(input.key.trim());
      await httpRequest({
        baseUrl: config.baseUrl,
        path: `/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(sanitized)}`,
        method: 'PUT',
        authToken: config.token,
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          metadata: input.metadata,
          version: input.version
        },
        expectJson: true
      });
    },

    async getRecord(input: GetRecordInput): Promise<GetRecordResult | null> {
      const sanitizedKey = sanitizeKey(input.key.trim());
      if (!sanitizedKey) {
        throw new Error('Metastore record key must not be empty');
      }

      try {
        const response = await httpRequest<{ data?: { metadata?: Record<string, unknown>; version?: number | null } | null }>(
          {
            baseUrl: config.baseUrl,
            path: `/records/${encodeURIComponent(config.namespace)}/${encodeURIComponent(sanitizedKey)}`,
            method: 'GET',
            authToken: config.token,
            principal: input.principal,
            fetchImpl: config.fetchImpl,
            expectJson: true
          }
        );

        const data = response.data?.data;
        if (!data) {
          return null;
        }
        return {
          metadata: (data.metadata ?? {}) as Record<string, unknown>,
          version: typeof data.version === 'number' ? Math.trunc(data.version) : null
        } satisfies GetRecordResult;
      } catch (error) {
        if (error instanceof CapabilityRequestError && error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async searchRecords(input: SearchRecordsInput): Promise<SearchRecordsResult> {
      const body = {
        namespace: config.namespace,
        limit: input.limit,
        sort: input.sort,
        filter: input.filter
      } satisfies Record<string, unknown>;

      const response = await httpRequest<{
        data?: {
          records?: Array<{ key?: string; metadata?: Record<string, unknown>; version?: number | null }>;
        } | null;
      }>({
        baseUrl: config.baseUrl,
        path: '/records/search',
        method: 'POST',
        authToken: config.token,
        principal: input.principal,
        fetchImpl: config.fetchImpl,
        body,
        expectJson: true
      });

      const records = Array.isArray(response.data?.data?.records)
        ? response.data?.data?.records ?? []
        : [];

      return {
        records: records
          .map((record) => {
            const key = typeof record.key === 'string' ? record.key.trim() : '';
            if (!key) {
              return null;
            }
            return {
              key,
              metadata: (record.metadata ?? {}) as Record<string, unknown>,
              version: typeof record.version === 'number' ? Math.trunc(record.version) : null
            };
          })
          .filter((entry): entry is { key: string; metadata: Record<string, unknown>; version: number | null } =>
            entry !== null
          )
      } satisfies SearchRecordsResult;
    }
  } satisfies MetastoreCapability;
}
