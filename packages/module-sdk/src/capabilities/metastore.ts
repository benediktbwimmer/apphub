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

export interface MetastoreCapability {
  upsertRecord(input: UpsertRecordInput): Promise<void>;
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
    }
  } satisfies MetastoreCapability;
}
