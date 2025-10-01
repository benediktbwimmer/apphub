import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface TimestoreCapabilityConfig {
  baseUrl: string;
  token?: TokenProvider;
  fetchImpl?: FetchLike;
}

export interface IngestRecordsInput {
  datasetSlug: string;
  records: unknown[];
  ingestionMode?: 'append' | 'replace';
  principal?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PartitionBuildInput {
  datasetSlug: string;
  partitionKey: string;
  principal?: string;
  idempotencyKey?: string;
}

export interface TimestoreCapability {
  ingestRecords(input: IngestRecordsInput): Promise<void>;
  triggerPartitionBuild(input: PartitionBuildInput): Promise<void>;
}

export function createTimestoreCapability(config: TimestoreCapabilityConfig): TimestoreCapability {
  return {
    async ingestRecords(input: IngestRecordsInput): Promise<void> {
      await httpRequest({
        baseUrl: config.baseUrl,
        path: `/v1/datasets/${encodeURIComponent(input.datasetSlug)}/ingest`,
        method: 'POST',
        authToken: config.token,
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          records: input.records,
          mode: input.ingestionMode ?? 'append',
          metadata: input.metadata
        },
        expectJson: true
      });
    },

    async triggerPartitionBuild(input: PartitionBuildInput): Promise<void> {
      await httpRequest({
        baseUrl: config.baseUrl,
        path: `/v1/datasets/${encodeURIComponent(input.datasetSlug)}/partitions/${encodeURIComponent(input.partitionKey)}/build`,
        method: 'POST',
        authToken: config.token,
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        expectJson: true
      });
    }
  } satisfies TimestoreCapability;
}
