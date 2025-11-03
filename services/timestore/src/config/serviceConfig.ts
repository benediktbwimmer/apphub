import path from 'node:path';
import { z } from 'zod';
import { fieldDefinitionSchema, type FieldDefinition } from '../ingestion/types';

type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type QueryExecutionBackendKind = 'clickhouse';

type StorageDriver = 'clickhouse';

export interface QueryExecutionBackendConfig {
  name: string;
  kind: QueryExecutionBackendKind;
  queueName?: string;
  maxPartitionFanout?: number;
  maxWorkerConcurrency?: number;
}

export interface QueryExecutionConfig {
  defaultBackend: string;
  backends: QueryExecutionBackendConfig[];
}

export interface PartitionIndexColumnConfig {
  name: string;
  histogram: boolean;
  bloom: boolean;
}

export interface StreamingConnectorConfig {
  id: string;
  driver: 'file';
  path: string;
  pollIntervalMs: number;
  batchSize: number;
  dedupeWindowMs: number;
  checkpointPath?: string;
  startAtOldest: boolean;
  dlqPath?: string | null;
}

export interface BulkConnectorConfig {
  id: string;
  driver: 'file';
  directory: string;
  filePattern: string;
  pollIntervalMs: number;
  chunkSize: number;
  checkpointPath?: string;
  deleteAfterLoad: boolean;
  renameOnSuccess: boolean;
  dlqPath?: string | null;
}

export interface ConnectorBackpressureConfig {
  highWatermark: number;
  lowWatermark: number;
  minPauseMs: number;
  maxPauseMs: number;
}

export interface IngestionConnectorConfig {
  enabled: boolean;
  streaming: StreamingConnectorConfig[];
  bulk: BulkConnectorConfig[];
  backpressure: ConnectorBackpressureConfig;
}

export interface StagingFlushConfig {
  maxRows: number;
  maxBytes: number;
  maxAgeMs: number;
  eagerWhenBytesOnly: boolean;
}

export interface StagingSpoolConfig {
  directory: string;
  maxDatasetBytes: number;
  maxTotalBytes: number;
  maxPendingPerDataset: number;
  flush: StagingFlushConfig;
}

export interface StreamingBatcherConfig {
  id: string;
  topic: string;
  groupId: string;
  datasetSlug: string;
  datasetName: string;
  tableName: string;
  schema: {
    fields: FieldDefinition[];
  };
  timeField: string;
  orderingField: string;
  windowSeconds: number;
  maxRowsPerPartition: number;
  maxBatchLatencyMs: number;
  partitionKey: Record<string, string>;
  partitionAttributes: Record<string, string>;
  startFromEarliest: boolean;
}

export interface StreamingHotBufferConfig {
  enabled: boolean;
  retentionSeconds: number;
  maxRowsPerDataset: number;
  maxTotalRows?: number;
  refreshWatermarkMs: number;
  fallbackMode: 'parquet_only' | 'error';
}

export interface StreamingRuntimeConfig {
  brokerUrl: string | null;
  batchers: StreamingBatcherConfig[];
  hotBuffer: StreamingHotBufferConfig;
}

const retentionRuleSchema = z.object({
  maxAgeHours: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional()
});

const lifecycleSchema = z.object({
  enabled: z.boolean(),
  queueName: z.string().min(1),
  intervalSeconds: z.number().int().positive(),
  jitterSeconds: z.number().int().nonnegative(),
  jobConcurrency: z.number().int().positive(),
  compaction: z.object({
    smallPartitionBytes: z.number().int().positive(),
    targetPartitionBytes: z.number().int().positive(),
    maxPartitionsPerGroup: z.number().int().positive(),
    chunkPartitionLimit: z.number().int().positive(),
    checkpointTtlHours: z.number().int().positive(),
    maxChunkRetries: z.number().int().positive()
  }),
  retention: z.object({
    defaultRules: retentionRuleSchema,
    deleteGraceMinutes: z.number().int().nonnegative()
  }),
  exports: z.object({
    enabled: z.boolean(),
    outputFormat: z.literal('parquet'),
    outputPrefix: z.string().min(1),
    minIntervalHours: z.number().int().positive()
  }),
  postgresMigration: z.object({
    enabled: z.boolean(),
    batchSize: z.number().int().positive(),
    maxAgeHours: z.number().int().positive(),
    gracePeriodhours: z.number().int().nonnegative(),
    targetTable: z.string().min(1),
    watermarkTable: z.string().min(1)
  }).optional()
});

const cacheSchema = z.object({
  enabled: z.boolean(),
  directory: z.string().min(1),
  maxBytes: z.number().int().positive()
});

const manifestCacheSchema = z.object({
  enabled: z.boolean(),
  redisUrl: z.string().min(1),
  keyPrefix: z.string().min(1),
  ttlSeconds: z.number().int().positive(),
  inline: z.boolean()
});

const queryExecutionBackendSchema = z.object({
  name: z.string().min(1),
  kind: z.literal('clickhouse'),
  queueName: z.string().min(1).optional(),
  maxPartitionFanout: z.number().int().positive().optional(),
  maxWorkerConcurrency: z.number().int().positive().optional()
});

const queryExecutionSchema = z.object({
  defaultBackend: z.string().min(1),
  backends: z.array(queryExecutionBackendSchema).min(1)
});

const metricsSchema = z.object({
  enabled: z.boolean(),
  collectDefaultMetrics: z.boolean(),
  prefix: z.string().min(1),
  scope: z.string().min(1).nullable()
});

const tracingSchema = z.object({
  enabled: z.boolean(),
  serviceName: z.string().min(1)
});

const sqlSchema = z.object({
  maxQueryLength: z.number().int().positive(),
  statementTimeoutMs: z.number().int().positive(),
  runtimeCacheTtlMs: z.number().int().nonnegative(),
  runtimeIncrementalCacheEnabled: z.boolean().default(true),
  maxExpressionDepth: z.number().int().positive()
});

const partitionIndexColumnSchema = z.object({
  name: z.string().min(1),
  histogram: z.boolean().default(false),
  bloom: z.boolean().default(false)
});

const partitionIndexSchema = z.object({
  columns: z.array(partitionIndexColumnSchema),
  histogramBins: z.number().int().positive(),
  bloomFalsePositiveRate: z.number().positive().max(0.5)
});

const streamingConnectorSchema = z
  .object({
    id: z.string().min(1),
    driver: z.literal('file').default('file'),
    path: z.string().min(1),
    pollIntervalMs: z.number().int().positive().default(500),
    batchSize: z.number().int().positive().default(500),
    dedupeWindowMs: z.number().int().nonnegative().default(5 * 60_000),
    checkpointPath: z.string().min(1).optional(),
    startAtOldest: z.boolean().default(true),
    dlqPath: z.string().min(1).nullable().optional()
  })
  .transform((value) => {
    const normalized: StreamingConnectorConfig = {
      id: value.id,
      driver: 'file',
      path: value.path,
      pollIntervalMs: value.pollIntervalMs,
      batchSize: value.batchSize,
      dedupeWindowMs: value.dedupeWindowMs,
      startAtOldest: value.startAtOldest,
      dlqPath: value.dlqPath ?? null
    };
    if (value.checkpointPath) {
      normalized.checkpointPath = value.checkpointPath;
    }
    return normalized;
  });

const streamingBatcherSchema = z
  .object({
    id: z.string().min(1),
    topic: z.string().min(1),
    groupId: z.string().min(1).optional(),
    datasetSlug: z.string().min(1),
    datasetName: z.string().min(1).optional(),
    tableName: z.string().min(1).max(120).optional(),
    schema: z.object({
      fields: z.array(fieldDefinitionSchema).min(1)
    }),
    timeField: z.string().min(1),
    orderingField: z.string().min(1).optional(),
    windowSeconds: z.number().int().positive().default(60),
    maxRowsPerPartition: z.number().int().positive().default(10_000),
    maxBatchLatencyMs: z.number().int().positive().default(60_000),
    partitionKey: z.record(z.string(), z.string()).default({}),
    partitionAttributes: z.record(z.string(), z.string()).default({}),
    startFromEarliest: z.boolean().default(false)
  })
  .transform((value) => {
    const tableName = value.tableName
      ? value.tableName
      : value.datasetSlug.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 120);
    const datasetName = value.datasetName ?? value.datasetSlug;
    return {
      id: value.id,
      topic: value.topic,
      groupId: value.groupId ?? `timestore-stream-batcher-${value.id}`,
      datasetSlug: value.datasetSlug,
      datasetName,
      tableName,
      schema: value.schema,
      timeField: value.timeField,
      orderingField: value.orderingField ?? value.timeField,
      windowSeconds: value.windowSeconds,
      maxRowsPerPartition: value.maxRowsPerPartition,
      maxBatchLatencyMs: value.maxBatchLatencyMs,
      partitionKey: value.partitionKey,
      partitionAttributes: value.partitionAttributes,
      startFromEarliest: value.startFromEarliest
    } satisfies StreamingBatcherConfig;
  });

const streamingHotBufferSchema = z
  .object({
    enabled: z.boolean(),
    retentionSeconds: z.number().int().positive().default(300),
    maxRowsPerDataset: z.number().int().positive().default(10_000),
    maxTotalRows: z.number().int().positive().optional(),
    refreshWatermarkMs: z.number().int().positive().default(5_000),
    fallbackMode: z.enum(['parquet_only', 'error']).default('parquet_only')
  })
  .transform((value) => {
    const normalized: StreamingHotBufferConfig = {
      enabled: value.enabled,
      retentionSeconds: value.retentionSeconds,
      maxRowsPerDataset: value.maxRowsPerDataset,
      refreshWatermarkMs: value.refreshWatermarkMs,
      fallbackMode: value.fallbackMode
    };
    if (value.maxTotalRows !== undefined) {
      normalized.maxTotalRows = value.maxTotalRows;
    }
    return normalized;
  });

const streamingRuntimeSchema = z.object({
  brokerUrl: z.string().min(1).nullable(),
  batchers: z.array(streamingBatcherSchema),
  hotBuffer: streamingHotBufferSchema
});

const bulkConnectorSchema = z
  .object({
    id: z.string().min(1),
    driver: z.literal('file').default('file'),
    directory: z.string().min(1),
    filePattern: z.string().min(1).default('*.json'),
    pollIntervalMs: z.number().int().positive().default(5_000),
    chunkSize: z.number().int().positive().default(10_000),
    checkpointPath: z.string().min(1).optional(),
    deleteAfterLoad: z.boolean().default(false),
    renameOnSuccess: z.boolean().default(true),
    dlqPath: z.string().min(1).nullable().optional()
  })
  .transform((value) => {
    const normalized: BulkConnectorConfig = {
      id: value.id,
      driver: 'file',
      directory: value.directory,
      filePattern: value.filePattern,
      pollIntervalMs: value.pollIntervalMs,
      chunkSize: value.chunkSize,
      deleteAfterLoad: value.deleteAfterLoad,
      renameOnSuccess: value.renameOnSuccess,
      dlqPath: value.dlqPath ?? null
    };
    if (value.checkpointPath) {
      normalized.checkpointPath = value.checkpointPath;
    }
    return normalized;
  });

const backpressureConfigSchema = z
  .object({
    highWatermark: z.number().int().nonnegative().default(500),
    lowWatermark: z.number().int().nonnegative().default(250),
    minPauseMs: z.number().int().positive().default(500),
    maxPauseMs: z.number().int().positive().default(30_000)
  })
  .superRefine((value, ctx) => {
    if (value.lowWatermark > value.highWatermark) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'lowWatermark must be less than or equal to highWatermark'
      });
    }
    if (value.minPauseMs > value.maxPauseMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'minPauseMs must be less than or equal to maxPauseMs'
      });
  }
})
  .transform((value) => ({
    highWatermark: value.highWatermark,
    lowWatermark: value.lowWatermark,
    minPauseMs: value.minPauseMs,
    maxPauseMs: value.maxPauseMs
  } satisfies ConnectorBackpressureConfig));

const ingestionConnectorSchema = z.object({
  enabled: z.boolean(),
  streaming: z.array(streamingConnectorSchema),
  bulk: z.array(bulkConnectorSchema),
  backpressure: backpressureConfigSchema
});

const filestoreSchema = z.object({
  enabled: z.boolean(),
  redisUrl: z.string().min(1),
  channel: z.string().min(1),
  datasetSlug: z.string().min(1),
  datasetName: z.string().min(1),
  tableName: z.string().min(1),
  retryDelayMs: z.number().int().positive(),
  inline: z.boolean()
});

const auditLogSchema = z.object({
  ttlHours: z.number().int().positive(),
  cleanupIntervalSeconds: z.number().int().positive(),
  deleteBatchSize: z.number().int().positive()
});

const clickhouseSchema = z.object({
  host: z.string().min(1),
  httpPort: z.number().int().positive(),
  nativePort: z.number().int().positive(),
  username: z.string().min(1),
  password: z.string(),
  database: z.string().min(1),
  secure: z.boolean()
});

const configSchema = z.object({
  host: z.string(),
  port: z.number().int().nonnegative(),
  logLevel: z.custom<LogLevel>((value) =>
    value === 'fatal' ||
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug' ||
    value === 'trace'
  ),
  database: z.object({
    url: z.string().min(1),
    schema: z.string().min(1),
    maxConnections: z.number().int().positive(),
    idleTimeoutMs: z.number().int().nonnegative(),
    connectionTimeoutMs: z.number().int().nonnegative()
  }),
  storage: z.object({
    driver: z.literal('clickhouse')
  }),
  query: z.object({
    cache: cacheSchema,
    manifestCache: manifestCacheSchema,
    execution: queryExecutionSchema
  }),
  ingestion: z.object({
    connectors: ingestionConnectorSchema
  }),
  streaming: streamingRuntimeSchema,
  partitionIndex: partitionIndexSchema,
  sql: sqlSchema,
  lifecycle: lifecycleSchema,
  observability: z.object({
    metrics: metricsSchema,
    tracing: tracingSchema
  }),
  filestore: filestoreSchema,
  auditLog: auditLogSchema,
  features: z.object({
    streaming: z.object({
      enabled: z.boolean()
    })
  }),
  clickhouse: clickhouseSchema
});

export type ServiceConfig = z.infer<typeof configSchema>;

let cachedConfig: ServiceConfig | null = null;

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function allowInlineMode(): boolean {
  return parseBoolean(process.env.APPHUB_ALLOW_INLINE_MODE, false);
}

function assertInlineAllowed(context: string): void {
  if (!allowInlineMode()) {
    throw new Error(`${context} requested inline mode but APPHUB_ALLOW_INLINE_MODE is not enabled`);
  }
}

function resolveCacheDirectory(envValue: string | undefined): string {
  if (envValue) {
    return envValue;
  }
  return path.resolve(process.cwd(), 'services', 'data', 'timestore', 'cache');
}

function parseList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePartitionIndexJson(value: string | undefined): PartitionIndexColumnConfig[] | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const columns: PartitionIndexColumnConfig[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }
      const name = typeof entry.name === 'string' ? entry.name.trim() : '';
      if (!name) {
        continue;
      }
      columns.push({
        name,
        histogram: entry.histogram === true,
        bloom: entry.bloom === true
      });
    }
    return dedupePartitionIndexColumns(columns);
  } catch (error) {
    console.warn('[timestore] failed to parse TIMESTORE_PARTITION_INDEX_CONFIG', error);
    return null;
  }
}

function dedupePartitionIndexColumns(columns: PartitionIndexColumnConfig[]): PartitionIndexColumnConfig[] {
  const byName = new Map<string, PartitionIndexColumnConfig>();
  for (const column of columns) {
    const name = column.name.trim();
    if (!name) {
      continue;
    }
    const existing = byName.get(name);
    if (existing) {
      byName.set(name, {
        name,
        histogram: existing.histogram || column.histogram,
        bloom: existing.bloom || column.bloom
      });
    } else {
      byName.set(name, {
        name,
        histogram: Boolean(column.histogram),
        bloom: Boolean(column.bloom)
      });
    }
  }
  return Array.from(byName.values());
}

function resolvePartitionIndexColumns(env: {
  configJson?: string;
  columns?: string;
  histogramColumns?: string;
  bloomColumns?: string;
}): PartitionIndexColumnConfig[] {
  const fromJson = parsePartitionIndexJson(env.configJson);
  if (fromJson && fromJson.length > 0) {
    return fromJson;
  }

  const columns = new Set(parseList(env.columns));
  const histogramColumns = new Set(parseList(env.histogramColumns));
  const bloomColumns = new Set(parseList(env.bloomColumns));

  if (columns.size === 0 && histogramColumns.size === 0 && bloomColumns.size === 0) {
    return [];
  }

  const combinedNames = new Set<string>([
    ...Array.from(columns),
    ...Array.from(histogramColumns),
    ...Array.from(bloomColumns)
  ]);
  const results: PartitionIndexColumnConfig[] = [];
  combinedNames.forEach((name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    results.push({
      name: trimmed,
      histogram: histogramColumns.has(trimmed),
      bloom: bloomColumns.has(trimmed)
    });
  });
  return dedupePartitionIndexColumns(results);
}

function parseExecutionBackendList(raw: string | undefined): QueryExecutionBackendConfig[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const results: QueryExecutionBackendConfig[] = [];
    for (const entry of parsed) {
      try {
        const normalized = queryExecutionBackendSchema.parse(entry);
        results.push(normalized);
      } catch (error) {
        console.warn('[timestore] skipped invalid execution backend configuration entry', error);
      }
    }
    return results;
  } catch (error) {
    console.warn('[timestore] failed to parse TIMESTORE_QUERY_EXECUTION_BACKENDS', error);
    return [];
  }
}

function normalizeExecutionConfig(
  backends: QueryExecutionBackendConfig[],
  defaultBackend: string
): QueryExecutionConfig {
  const fallbackBackends: QueryExecutionBackendConfig[] = [
    { name: 'clickhouse-default', kind: 'clickhouse' }
  ];

  const normalizedBackends = new Map<string, QueryExecutionBackendConfig>();
  for (const backend of backends) {
    normalizedBackends.set(backend.name, backend);
  }

  for (const fallback of fallbackBackends) {
    if (!normalizedBackends.has(fallback.name)) {
      normalizedBackends.set(fallback.name, fallback);
    }
  }

  const preferredDefault = defaultBackend.trim().length > 0 ? defaultBackend : fallbackBackends[0].name;
  const effectiveDefault = normalizedBackends.has(preferredDefault) ? preferredDefault : fallbackBackends[0].name;

  if (!normalizedBackends.has(preferredDefault) && preferredDefault !== fallbackBackends[0].name) {
    console.warn(
      `[timestore] execution backend '${preferredDefault}' not found; falling back to '${fallbackBackends[0].name}'`
    );
  }

  return {
    defaultBackend: effectiveDefault,
    backends: Array.from(normalizedBackends.values())
  } satisfies QueryExecutionConfig;
}

function parseConnectorList<T>(
  raw: string | undefined,
  schema: z.ZodTypeAny,
  kind: 'streaming' | 'bulk'
): T[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[timestore] ${kind} connector configuration must be an array`);
      return [];
    }
    const results: T[] = [];
    for (const entry of parsed) {
      try {
        results.push(schema.parse(entry) as T);
      } catch (error) {
        console.warn(`[timestore] skipped invalid ${kind} connector configuration entry`, error);
      }
    }
    return results;
  } catch (error) {
    console.warn(`[timestore] failed to parse ${kind} connector configuration`, error);
    return [];
  }
}

function parseStreamingConnectors(raw: string | undefined): StreamingConnectorConfig[] {
  return parseConnectorList<StreamingConnectorConfig>(raw, streamingConnectorSchema, 'streaming');
}

function parseBulkConnectors(raw: string | undefined): BulkConnectorConfig[] {
  return parseConnectorList<BulkConnectorConfig>(raw, bulkConnectorSchema, 'bulk');
}

function parseStreamingBatchers(raw: string | undefined): StreamingBatcherConfig[] {
  if (!raw) {
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed === '""') {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    return z.array(streamingBatcherSchema).parse(parsed);
  } catch (error) {
    console.warn('[timestore] failed to parse streaming batcher configuration', error);
    return [];
  }
}

function resolveStreamTopic(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = env[key];
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function field(name: string, type: FieldDefinition['type']): FieldDefinition {
  return { name, type } satisfies FieldDefinition;
}

function buildDefaultStreamingBatchers(env: NodeJS.ProcessEnv): StreamingBatcherConfig[] {
  const workflowRunsTopic = resolveStreamTopic(env, 'APPHUB_STREAM_TOPIC_WORKFLOW_RUNS', 'apphub.workflows.runs');
  const workflowEventsTopic = resolveStreamTopic(env, 'APPHUB_STREAM_TOPIC_WORKFLOW_EVENTS', 'apphub.workflows.events');
  const jobRunsTopic = resolveStreamTopic(env, 'APPHUB_STREAM_TOPIC_JOB_RUNS', 'apphub.jobs.runs');
  const ingestionTopic = resolveStreamTopic(env, 'APPHUB_STREAM_TOPIC_INGESTION', 'apphub.ingestion.telemetry');
  const coreEventsTopic = resolveStreamTopic(env, 'APPHUB_STREAM_TOPIC_CORE_EVENTS', 'apphub.core.events');

  const defaults: StreamingBatcherConfig[] = [
    {
      id: 'workflow-runs-stream',
      topic: workflowRunsTopic,
      groupId: 'timestore-stream-batcher-workflow-runs',
      datasetSlug: 'workflow_runs_stream',
      datasetName: 'Workflow Runs (Streaming)',
      tableName: 'workflow_runs_stream',
      schema: {
        fields: [
          field('source', 'string'),
          field('emittedAt', 'timestamp'),
          field('ingressSequence', 'string'),
          field('kafkaPartition', 'string'),
          field('kafkaOffset', 'string'),
          field('eventType', 'string'),
          field('workflowDefinitionId', 'string'),
          field('workflowRunId', 'string'),
          field('status', 'string'),
          field('runKey', 'string'),
          field('triggeredBy', 'string'),
          field('startedAt', 'timestamp'),
          field('completedAt', 'timestamp'),
          field('updatedAt', 'timestamp'),
          field('durationMs', 'integer'),
          field('payloadJson', 'string')
        ]
      },
      timeField: 'emittedAt',
      orderingField: 'ingressSequence',
      windowSeconds: 60,
      maxRowsPerPartition: 1_000,
      maxBatchLatencyMs: 30_000,
      partitionKey: { dataset: 'workflow_runs_stream' },
      partitionAttributes: { source: 'streaming' },
      startFromEarliest: true
    },
    {
      id: 'workflow-events-stream',
      topic: workflowEventsTopic,
      groupId: 'timestore-stream-batcher-workflow-events',
      datasetSlug: 'workflow_events_stream',
      datasetName: 'Workflow Events (Streaming)',
      tableName: 'workflow_events_stream',
      schema: {
        fields: [
          field('source', 'string'),
          field('emittedAt', 'timestamp'),
          field('ingressSequence', 'string'),
          field('kafkaPartition', 'string'),
          field('kafkaOffset', 'string'),
          field('eventType', 'string'),
          field('eventSource', 'string'),
          field('workflowEventId', 'string'),
          field('occurredAt', 'timestamp'),
          field('receivedAt', 'timestamp'),
          field('correlationId', 'string'),
          field('severity', 'string'),
          field('workflowDefinitionId', 'string'),
          field('workflowRunId', 'string'),
          field('workflowRunStepId', 'string'),
          field('jobRunId', 'string'),
          field('jobSlug', 'string'),
          field('workflowRunKey', 'string'),
          field('derivedType', 'string'),
          field('payloadJson', 'string'),
          field('metadataJson', 'string'),
          field('derivedPayloadJson', 'string'),
          field('linksJson', 'string')
        ]
      },
      timeField: 'emittedAt',
      orderingField: 'ingressSequence',
      windowSeconds: 60,
      maxRowsPerPartition: 1_000,
      maxBatchLatencyMs: 30_000,
      partitionKey: { dataset: 'workflow_events_stream' },
      partitionAttributes: { source: 'streaming' },
      startFromEarliest: true
    },
    {
      id: 'job-runs-stream',
      topic: jobRunsTopic,
      groupId: 'timestore-stream-batcher-job-runs',
      datasetSlug: 'job_runs_stream',
      datasetName: 'Job Runs (Streaming)',
      tableName: 'job_runs_stream',
      schema: {
        fields: [
          field('source', 'string'),
          field('emittedAt', 'timestamp'),
          field('ingressSequence', 'string'),
          field('kafkaPartition', 'string'),
          field('kafkaOffset', 'string'),
          field('eventType', 'string'),
          field('jobDefinitionId', 'string'),
          field('jobRunId', 'string'),
          field('status', 'string'),
          field('attempt', 'integer'),
          field('retryCount', 'integer'),
          field('scheduledAt', 'timestamp'),
          field('startedAt', 'timestamp'),
          field('completedAt', 'timestamp'),
          field('updatedAt', 'timestamp'),
          field('durationMs', 'integer'),
          field('failureReason', 'string'),
          field('payloadJson', 'string')
        ]
      },
      timeField: 'emittedAt',
      orderingField: 'ingressSequence',
      windowSeconds: 60,
      maxRowsPerPartition: 1_000,
      maxBatchLatencyMs: 30_000,
      partitionKey: { dataset: 'job_runs_stream' },
      partitionAttributes: { source: 'streaming' },
      startFromEarliest: true
    },
    {
      id: 'ingestion-events-stream',
      topic: ingestionTopic,
      groupId: 'timestore-stream-batcher-ingestion-events',
      datasetSlug: 'ingestion_events_stream',
      datasetName: 'Ingestion Events (Streaming)',
      tableName: 'ingestion_events_stream',
      schema: {
        fields: [
          field('source', 'string'),
          field('emittedAt', 'timestamp'),
          field('ingressSequence', 'string'),
          field('kafkaPartition', 'string'),
          field('kafkaOffset', 'string'),
          field('eventType', 'string'),
          field('ingestionId', 'integer'),
          field('repositoryId', 'string'),
          field('status', 'string'),
          field('attempt', 'integer'),
          field('commitSha', 'string'),
          field('durationMs', 'integer'),
          field('message', 'string'),
          field('createdAt', 'timestamp'),
          field('payloadJson', 'string')
        ]
      },
      timeField: 'emittedAt',
      orderingField: 'ingressSequence',
      windowSeconds: 60,
      maxRowsPerPartition: 1_000,
      maxBatchLatencyMs: 30_000,
      partitionKey: { dataset: 'ingestion_events_stream' },
      partitionAttributes: { source: 'streaming' },
      startFromEarliest: true
    },
    {
      id: 'core-events-stream',
      topic: coreEventsTopic,
      groupId: 'timestore-stream-batcher-core-events',
      datasetSlug: 'core_events_stream',
      datasetName: 'Core Events (Streaming)',
      tableName: 'core_events_stream',
      schema: {
        fields: [
          field('source', 'string'),
          field('emittedAt', 'timestamp'),
          field('ingressSequence', 'string'),
          field('kafkaPartition', 'string'),
          field('kafkaOffset', 'string'),
          field('eventType', 'string'),
          field('payloadJson', 'string')
        ]
      },
      timeField: 'emittedAt',
      orderingField: 'ingressSequence',
      windowSeconds: 60,
      maxRowsPerPartition: 1_000,
      maxBatchLatencyMs: 30_000,
      partitionKey: { dataset: 'core_events_stream' },
      partitionAttributes: { source: 'streaming' },
      startFromEarliest: true
    }
  ];

  return defaults;
}

function parseConnectorBackpressure(raw: string | undefined): ConnectorBackpressureConfig {
  if (!raw) {
    return backpressureConfigSchema.parse({});
  }
  try {
    const parsed = JSON.parse(raw);
    return backpressureConfigSchema.parse(parsed);
  } catch (error) {
    console.warn('[timestore] failed to parse connector backpressure configuration', error);
    return backpressureConfigSchema.parse({});
  }
}

export function loadServiceConfig(): ServiceConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const env = process.env;
  const redisUrlEnv = env.REDIS_URL;
  if (!redisUrlEnv || !redisUrlEnv.trim()) {
    throw new Error('REDIS_URL must be set to a redis:// connection string for timestore');
  }
  if (redisUrlEnv.trim() === 'inline') {
    assertInlineAllowed('REDIS_URL');
  }
  const host = env.TIMESTORE_HOST || env.HOST || '127.0.0.1';
  const port = parseNumber(env.TIMESTORE_PORT || env.PORT, 4200);
  const logLevel = (env.TIMESTORE_LOG_LEVEL || 'info') as LogLevel;
  const databaseUrl = env.TIMESTORE_DATABASE_URL || env.DATABASE_URL || 'postgres://apphub:apphub@127.0.0.1:5432/apphub';
  const schema = env.TIMESTORE_PG_SCHEMA || 'timestore';
  const maxConnections = parseNumber(env.TIMESTORE_PGPOOL_MAX || env.PGPOOL_MAX, 5);
  const idleTimeoutMs = parseNumber(env.TIMESTORE_PGPOOL_IDLE_TIMEOUT_MS || env.PGPOOL_IDLE_TIMEOUT_MS, 30_000);
  const connectionTimeoutMs = parseNumber(
    env.TIMESTORE_PGPOOL_CONNECTION_TIMEOUT_MS || env.PGPOOL_CONNECTION_TIMEOUT_MS,
    10_000
  );
  const clickhouseHost = env.TIMESTORE_CLICKHOUSE_HOST || 'clickhouse';
  const clickhouseHttpPort = parseNumber(env.TIMESTORE_CLICKHOUSE_HTTP_PORT, 8123);
  const clickhouseNativePort = parseNumber(env.TIMESTORE_CLICKHOUSE_NATIVE_PORT, 9000);
  const clickhouseUsername = env.TIMESTORE_CLICKHOUSE_USER || 'apphub';
  const clickhousePassword = env.TIMESTORE_CLICKHOUSE_PASSWORD || 'apphub';
  const clickhouseDatabase = env.TIMESTORE_CLICKHOUSE_DATABASE || 'apphub';
  const clickhouseSecure = parseBoolean(env.TIMESTORE_CLICKHOUSE_SECURE, false);
  const queryCacheEnabled = parseBoolean(env.TIMESTORE_QUERY_CACHE_ENABLED, true);
  const queryCacheDirectory = resolveCacheDirectory(env.TIMESTORE_QUERY_CACHE_DIR);
  const queryCacheMaxBytes = parseNumber(env.TIMESTORE_QUERY_CACHE_MAX_BYTES, 5 * 1024 * 1024 * 1024);
  const sqlMaxQueryLength = parseNumber(env.TIMESTORE_SQL_MAX_LENGTH, 10_000);
  const sqlStatementTimeoutMs = parseNumber(env.TIMESTORE_SQL_TIMEOUT_MS, 30_000);
  const sqlRuntimeCacheTtlMs = parseNumber(env.TIMESTORE_SQL_RUNTIME_CACHE_TTL_MS, 30_000);
  const sqlRuntimeIncrementalEnabled = parseBoolean(
    env.TIMESTORE_SQL_RUNTIME_INCREMENTAL_ENABLED,
    true
  );
  const sqlMaxExpressionDepth = parseNumber(env.TIMESTORE_SQL_MAX_EXPRESSION_DEPTH, 10_000);
  const manifestCacheEnabled = parseBoolean(env.TIMESTORE_MANIFEST_CACHE_ENABLED, true);
  const manifestCacheRedisSource = env.TIMESTORE_MANIFEST_CACHE_REDIS_URL || env.REDIS_URL;
  if (!manifestCacheRedisSource || !manifestCacheRedisSource.trim()) {
    throw new Error('Set TIMESTORE_MANIFEST_CACHE_REDIS_URL or REDIS_URL to a redis:// connection string');
  }
  const manifestCacheRedisUrl = manifestCacheRedisSource.trim();
  const manifestCacheKeyPrefix = env.TIMESTORE_MANIFEST_CACHE_KEY_PREFIX || 'timestore:manifest';
  const manifestCacheTtlSeconds = parseNumber(env.TIMESTORE_MANIFEST_CACHE_TTL_SECONDS, 300);
  const manifestCacheInline = manifestCacheRedisUrl === 'inline';
  if (manifestCacheInline) {
    assertInlineAllowed('TIMESTORE_MANIFEST_CACHE_REDIS_URL');
  }
  const partitionIndexConfigJson = env.TIMESTORE_PARTITION_INDEX_CONFIG;
  const partitionIndexColumnsEnv = env.TIMESTORE_PARTITION_INDEX_COLUMNS;
  const partitionIndexHistogramColumns = env.TIMESTORE_PARTITION_HISTOGRAM_COLUMNS;
  const partitionIndexBloomColumns = env.TIMESTORE_PARTITION_BLOOM_COLUMNS;
  const partitionIndexHistogramBins = parseNumber(env.TIMESTORE_PARTITION_HISTOGRAM_BINS, 16);
  const partitionIndexBloomFprRaw = env.TIMESTORE_PARTITION_BLOOM_FPR;

  const lifecycleEnabled = parseBoolean(env.TIMESTORE_LIFECYCLE_ENABLED, true);
  const lifecycleQueueName = env.TIMESTORE_LIFECYCLE_QUEUE_NAME || 'timestore_lifecycle_queue';
  const lifecycleIntervalSeconds = parseNumber(env.TIMESTORE_LIFECYCLE_INTERVAL_SECONDS, 300);
  const lifecycleJitterSeconds = parseNumber(env.TIMESTORE_LIFECYCLE_JITTER_SECONDS, 30);
  const lifecycleConcurrency = parseNumber(env.TIMESTORE_LIFECYCLE_CONCURRENCY, 1);
  const lifecycleSmallPartitionBytes = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_SMALL_BYTES, 20 * 1024 * 1024);
  const lifecycleTargetPartitionBytes = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_TARGET_BYTES, 200 * 1024 * 1024);
  const lifecycleMaxPartitionsPerGroup = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_MAX_PARTITIONS, 16);
  const lifecycleChunkPartitionLimit = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_CHUNK_PARTITIONS, 48);
  const lifecycleCheckpointTtlHours = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_CHECKPOINT_TTL_HOURS, 24);
  const lifecycleMaxChunkRetries = parseNumber(env.TIMESTORE_LIFECYCLE_COMPACTION_MAX_CHUNK_RETRIES, 3);
  const lifecycleDefaultMaxAgeHours = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_MAX_AGE_HOURS, 720);
  const lifecycleDefaultMaxTotalBytes = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_MAX_TOTAL_BYTES, 500 * 1024 * 1024 * 1024);
  const lifecycleDeleteGraceMinutes = parseNumber(env.TIMESTORE_LIFECYCLE_RETENTION_DELETE_GRACE_MINUTES, 5);
  const lifecycleExportsEnabled = parseBoolean(env.TIMESTORE_LIFECYCLE_EXPORTS_ENABLED, true);
  const lifecycleExportPrefix = env.TIMESTORE_LIFECYCLE_EXPORT_PREFIX || 'exports';
  const lifecycleExportMinIntervalHours = parseNumber(env.TIMESTORE_LIFECYCLE_EXPORT_MIN_INTERVAL_HOURS, 24);
  const postgresMigrationEnabled = parseBoolean(env.TIMESTORE_POSTGRES_MIGRATION_ENABLED, true);
  const postgresMigrationBatchSize = parseNumber(env.TIMESTORE_POSTGRES_MIGRATION_BATCH_SIZE, 10000);
  const postgresMigrationMaxAgeHours = parseNumber(env.TIMESTORE_POSTGRES_MIGRATION_MAX_AGE_HOURS, 24 * 7);
  const postgresMigrationGracePeriodHours = parseNumber(env.TIMESTORE_POSTGRES_MIGRATION_GRACE_PERIOD_HOURS, 24);
  const postgresMigrationTargetTable = env.TIMESTORE_POSTGRES_MIGRATION_TARGET_TABLE || 'migrated_data';
  const postgresMigrationWatermarkTable = env.TIMESTORE_POSTGRES_MIGRATION_WATERMARK_TABLE || 'migration_watermarks';
  const metricsEnabled = parseBoolean(env.TIMESTORE_METRICS_ENABLED, true);
  const metricsCollectDefault = parseBoolean(env.TIMESTORE_METRICS_COLLECT_DEFAULT, true);
  const metricsPrefix = env.TIMESTORE_METRICS_PREFIX || 'timestore_';
  const metricsScope = env.TIMESTORE_METRICS_SCOPE || env.TIMESTORE_ADMIN_SCOPE || env.TIMESTORE_REQUIRE_SCOPE || null;
  const tracingEnabled = parseBoolean(env.TIMESTORE_TRACING_ENABLED, false);
  const tracingServiceName = env.TIMESTORE_TRACING_SERVICE_NAME || 'timestore';
  const filestoreEnabled = parseBoolean(env.TIMESTORE_FILESTORE_SYNC_ENABLED, true);
  const filestoreRedisSource = env.FILESTORE_REDIS_URL || env.REDIS_URL;
  if (!filestoreRedisSource || !filestoreRedisSource.trim()) {
    throw new Error('Set FILESTORE_REDIS_URL or REDIS_URL to a redis:// connection string');
  }
  const filestoreRedisUrl = filestoreRedisSource.trim();
  const filestoreChannel = env.FILESTORE_EVENTS_CHANNEL || 'apphub:filestore';
  const filestoreDatasetSlug = env.TIMESTORE_FILESTORE_DATASET_SLUG || 'filestore_activity';
  const filestoreDatasetName = env.TIMESTORE_FILESTORE_DATASET_NAME || 'Filestore Activity';
  const filestoreTableName = env.TIMESTORE_FILESTORE_TABLE_NAME || 'filestore_activity';
  const filestoreRetryMs = parseNumber(env.TIMESTORE_FILESTORE_RETRY_MS, 3_000);
  const filestoreInline = filestoreRedisUrl === 'inline';
  if (filestoreInline) {
    assertInlineAllowed('FILESTORE_REDIS_URL');
  }
  const auditTtlDays = parseNumber(env.TIMESTORE_AUDIT_TTL_DAYS, 7);
  const auditCleanupIntervalSeconds = parseNumber(
    env.TIMESTORE_AUDIT_CLEANUP_INTERVAL_SECONDS,
    3_600
  );
  const auditCleanupBatchSize = parseNumber(env.TIMESTORE_AUDIT_CLEANUP_BATCH_SIZE, 1_000);
  const auditTtlHours = Math.max(1, Math.round((auditTtlDays > 0 ? auditTtlDays : 7) * 24));
  const auditCleanupInterval = auditCleanupIntervalSeconds > 0 ? auditCleanupIntervalSeconds : 3_600;
  const auditBatchSize = auditCleanupBatchSize > 0 ? auditCleanupBatchSize : 1_000;
  const executionDefaultBackendRaw = env.TIMESTORE_QUERY_EXECUTION_DEFAULT;
  const executionDefaultBackend = executionDefaultBackendRaw && executionDefaultBackendRaw.trim().length > 0
    ? executionDefaultBackendRaw.trim()
    : 'clickhouse-default';
  const executionBackends = parseExecutionBackendList(env.TIMESTORE_QUERY_EXECUTION_BACKENDS);
  const executionConfig = normalizeExecutionConfig(executionBackends, executionDefaultBackend);

  const streamingFeatureEnabled = parseBoolean(env.APPHUB_STREAMING_ENABLED, false);
  const streamingConnectors = parseStreamingConnectors(env.TIMESTORE_STREAMING_CONNECTORS);
  const bulkConnectors = parseBulkConnectors(env.TIMESTORE_BULK_CONNECTORS);
  const streamingBatchers = (() => {
    const rawBatchers = env.TIMESTORE_STREAMING_BATCHERS;
    if (rawBatchers !== undefined) {
      const parsed = parseStreamingBatchers(rawBatchers);
      if (parsed.length > 0) {
        return parsed;
      }
      const normalized = rawBatchers.trim();
      if (normalized.length > 0 && normalized !== '""') {
        return [];
      }
    }
    return buildDefaultStreamingBatchers(env);
  })();
  const streamingBrokerUrlRaw = env.APPHUB_STREAM_BROKER_URL;
  const streamingBrokerUrl = streamingBrokerUrlRaw && streamingBrokerUrlRaw.trim().length > 0
    ? streamingBrokerUrlRaw.trim()
    : null;
  const streamingBufferEnabled = parseBoolean(env.TIMESTORE_STREAMING_BUFFER_ENABLED, streamingFeatureEnabled);
  const streamingBufferRetentionSeconds = parseNumber(env.TIMESTORE_STREAMING_BUFFER_RETENTION_SECONDS, 120);
  const streamingBufferMaxRowsPerDataset = parseNumber(env.TIMESTORE_STREAMING_BUFFER_MAX_ROWS_PER_DATASET, 10_000);
  const streamingBufferMaxTotalRowsRaw = env.TIMESTORE_STREAMING_BUFFER_MAX_TOTAL_ROWS;
  const streamingBufferMaxTotalRows = streamingBufferMaxTotalRowsRaw
    ? Math.max(0, parseNumber(streamingBufferMaxTotalRowsRaw, 0))
    : 0;
  const streamingBufferRefreshMs = parseNumber(env.TIMESTORE_STREAMING_BUFFER_REFRESH_MS, 5_000);
  const streamingBufferFallbackRaw = (env.TIMESTORE_STREAMING_BUFFER_FALLBACK || 'parquet_only')
    .trim()
    .toLowerCase();
  const streamingBufferFallback: 'parquet_only' | 'error' = streamingBufferFallbackRaw === 'error'
    ? 'error'
    : 'parquet_only';
  const connectorBackpressure = parseConnectorBackpressure(env.TIMESTORE_CONNECTOR_BACKPRESSURE);
  const connectorsEnabled = parseBoolean(
    env.TIMESTORE_CONNECTORS_ENABLED,
    streamingConnectors.length > 0 || bulkConnectors.length > 0
  );
  const connectorsConfig: IngestionConnectorConfig = {
    enabled: connectorsEnabled && (streamingConnectors.length > 0 || bulkConnectors.length > 0),
    streaming: streamingConnectors,
    bulk: bulkConnectors,
    backpressure: connectorBackpressure
  };

  const partitionIndexColumns = resolvePartitionIndexColumns({
    configJson: partitionIndexConfigJson,
    columns: partitionIndexColumnsEnv,
    histogramColumns: partitionIndexHistogramColumns,
    bloomColumns: partitionIndexBloomColumns
  });
  const histogramBins = partitionIndexHistogramBins > 0 ? partitionIndexHistogramBins : 16;
  const parsedBloomFpr = partitionIndexBloomFprRaw ? Number.parseFloat(partitionIndexBloomFprRaw) : NaN;
  const bloomFalsePositiveRate = Number.isFinite(parsedBloomFpr) && parsedBloomFpr > 0 && parsedBloomFpr <= 0.5
    ? parsedBloomFpr
    : 0.01;

  const candidateConfig = {
    host,
    port,
    logLevel,
    database: {
      url: databaseUrl,
      schema,
      maxConnections,
      idleTimeoutMs,
      connectionTimeoutMs
    },
    storage: {
      driver: 'clickhouse' as StorageDriver
    },
    query: {
      cache: {
        enabled: queryCacheEnabled,
        directory: queryCacheDirectory,
        maxBytes: queryCacheMaxBytes > 0 ? queryCacheMaxBytes : 1 * 1024 * 1024
      },
      manifestCache: {
        enabled: manifestCacheEnabled,
        redisUrl: manifestCacheRedisUrl,
        keyPrefix: manifestCacheKeyPrefix,
        ttlSeconds: manifestCacheTtlSeconds > 0 ? manifestCacheTtlSeconds : 60,
        inline: manifestCacheInline
      },
      execution: executionConfig
    },
    ingestion: {
      connectors: connectorsConfig
    },
    streaming: {
      brokerUrl: streamingBrokerUrl,
      batchers: streamingBatchers as StreamingBatcherConfig[],
      hotBuffer: {
        enabled: streamingBufferEnabled,
        retentionSeconds: streamingBufferRetentionSeconds > 0
          ? streamingBufferRetentionSeconds
          : 120,
        maxRowsPerDataset: streamingBufferMaxRowsPerDataset > 0
          ? streamingBufferMaxRowsPerDataset
          : 10_000,
        maxTotalRows: streamingBufferMaxTotalRows > 0 ? streamingBufferMaxTotalRows : undefined,
        refreshWatermarkMs: streamingBufferRefreshMs > 0 ? streamingBufferRefreshMs : 5_000,
        fallbackMode: streamingBufferFallback
      }
    },
    partitionIndex: {
      columns: partitionIndexColumns,
      histogramBins,
      bloomFalsePositiveRate
    },
    sql: {
      maxQueryLength: sqlMaxQueryLength > 0 ? sqlMaxQueryLength : 10_000,
      statementTimeoutMs: sqlStatementTimeoutMs > 0 ? sqlStatementTimeoutMs : 30_000,
      runtimeCacheTtlMs: sqlRuntimeCacheTtlMs >= 0 ? sqlRuntimeCacheTtlMs : 0,
      runtimeIncrementalCacheEnabled: sqlRuntimeIncrementalEnabled,
      maxExpressionDepth: sqlMaxExpressionDepth > 0 ? sqlMaxExpressionDepth : 10_000
    },
    lifecycle: {
      enabled: lifecycleEnabled,
      queueName: lifecycleQueueName,
      intervalSeconds: lifecycleIntervalSeconds,
      jitterSeconds: lifecycleJitterSeconds,
      jobConcurrency: lifecycleConcurrency,
      compaction: {
        smallPartitionBytes: lifecycleSmallPartitionBytes,
        targetPartitionBytes: lifecycleTargetPartitionBytes,
        maxPartitionsPerGroup: lifecycleMaxPartitionsPerGroup,
        chunkPartitionLimit: lifecycleChunkPartitionLimit > 0 ? lifecycleChunkPartitionLimit : 48,
        checkpointTtlHours: lifecycleCheckpointTtlHours > 0 ? lifecycleCheckpointTtlHours : 24,
        maxChunkRetries: lifecycleMaxChunkRetries > 0 ? lifecycleMaxChunkRetries : 3
      },
      retention: {
        defaultRules: {
          maxAgeHours: lifecycleDefaultMaxAgeHours > 0 ? lifecycleDefaultMaxAgeHours : undefined,
          maxTotalBytes: lifecycleDefaultMaxTotalBytes > 0 ? lifecycleDefaultMaxTotalBytes : undefined
        },
        deleteGraceMinutes: lifecycleDeleteGraceMinutes
      },
      exports: {
        enabled: lifecycleExportsEnabled,
        outputFormat: 'parquet',
        outputPrefix: lifecycleExportPrefix,
        minIntervalHours: lifecycleExportMinIntervalHours
      },
      postgresMigration: {
        enabled: postgresMigrationEnabled,
        batchSize: postgresMigrationBatchSize,
        maxAgeHours: postgresMigrationMaxAgeHours,
        gracePeriodhours: postgresMigrationGracePeriodHours,
        targetTable: postgresMigrationTargetTable,
        watermarkTable: postgresMigrationWatermarkTable
      }
    },
    observability: {
      metrics: {
        enabled: metricsEnabled,
        collectDefaultMetrics: metricsCollectDefault,
        prefix: metricsPrefix,
        scope: metricsScope
      },
      tracing: {
        enabled: tracingEnabled,
        serviceName: tracingServiceName
      }
    },
    auditLog: {
      ttlHours: auditTtlHours,
      cleanupIntervalSeconds: auditCleanupInterval,
      deleteBatchSize: auditBatchSize
    },
    filestore: {
      enabled: filestoreEnabled,
      redisUrl: filestoreRedisUrl,
      channel: filestoreChannel,
      datasetSlug: filestoreDatasetSlug,
      datasetName: filestoreDatasetName,
      tableName: filestoreTableName,
      retryDelayMs: filestoreRetryMs > 0 ? filestoreRetryMs : 3_000,
      inline: filestoreInline
    },
    features: {
      streaming: {
        enabled: streamingFeatureEnabled
      }
    },
    clickhouse: {
      host: clickhouseHost,
      httpPort: clickhouseHttpPort > 0 ? clickhouseHttpPort : 8123,
      nativePort: clickhouseNativePort > 0 ? clickhouseNativePort : 9000,
      username: clickhouseUsername,
      password: clickhousePassword,
      database: clickhouseDatabase,
      secure: clickhouseSecure
    }
  } satisfies ServiceConfig;

  const parsed = configSchema.parse(candidateConfig);
  cachedConfig = parsed;
  return parsed;
}

export function resetCachedServiceConfig(): void {
  cachedConfig = null;
}
