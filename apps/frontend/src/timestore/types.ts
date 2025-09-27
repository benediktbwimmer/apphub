import { z } from 'zod';
import {
  archiveDatasetRequestSchema as sharedArchiveDatasetRequestSchema,
  createDatasetRequestSchema as sharedCreateDatasetRequestSchema,
  datasetAccessAuditEventSchema as sharedDatasetAccessAuditEventSchema,
  datasetAccessAuditListQuerySchema as sharedDatasetAccessAuditListQuerySchema,
  datasetAccessAuditListResponseSchema as sharedDatasetAccessAuditListResponseSchema,
  datasetIamConfigSchema as sharedDatasetIamConfigSchema,
  datasetMetadataSchema as sharedDatasetMetadataSchema,
  datasetRecordSchema as sharedDatasetRecordSchema,
  datasetResponseSchema as sharedDatasetResponseSchema,
  datasetStatusSchema as sharedDatasetStatusSchema,
  patchDatasetRequestSchema as sharedPatchDatasetRequestSchema
} from '@apphub/shared/timestoreAdmin';

const retentionRuleSchema = z.object({
  maxAgeHours: z.number().int().positive().optional(),
  maxTotalBytes: z.number().int().positive().optional()
});

export const retentionPolicySchema = z
  .object({
    mode: z.enum(['time', 'size', 'hybrid']).optional(),
    rules: retentionRuleSchema.default({}),
    deleteGraceMinutes: z.number().int().nonnegative().optional(),
    coldStorageAfterHours: z.number().int().positive().optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .passthrough();

export type RetentionPolicy = z.infer<typeof retentionPolicySchema>;

export const datasetIamConfigSchema = sharedDatasetIamConfigSchema;

export const datasetMetadataSchema = sharedDatasetMetadataSchema;

export const datasetRecordSchema = sharedDatasetRecordSchema.extend({
  displayName: z.string().nullable().optional()
});

export const datasetResponseSchema = sharedDatasetResponseSchema.extend({
  dataset: datasetRecordSchema
});

export const createDatasetRequestSchema = sharedCreateDatasetRequestSchema;

export const patchDatasetRequestSchema = sharedPatchDatasetRequestSchema;

export const archiveDatasetRequestSchema = sharedArchiveDatasetRequestSchema;

export const datasetAccessAuditEventSchema = sharedDatasetAccessAuditEventSchema;

export const datasetAccessAuditListQuerySchema = sharedDatasetAccessAuditListQuerySchema;

export const datasetAccessAuditListResponseSchema = sharedDatasetAccessAuditListResponseSchema.extend({
  events: z.array(datasetAccessAuditEventSchema)
});

export type DatasetStatus = z.infer<typeof sharedDatasetStatusSchema>;
export type DatasetIamConfig = z.infer<typeof datasetIamConfigSchema>;
export type DatasetMetadata = z.infer<typeof datasetMetadataSchema>;
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;
export type DatasetResponse = z.infer<typeof datasetResponseSchema>;
export type CreateDatasetRequest = z.infer<typeof createDatasetRequestSchema>;
export type PatchDatasetRequest = z.infer<typeof patchDatasetRequestSchema>;
export type ArchiveDatasetRequest = z.infer<typeof archiveDatasetRequestSchema>;
export type DatasetAccessAuditListQuery = z.infer<typeof datasetAccessAuditListQuerySchema>;
export type DatasetAccessAuditEvent = z.infer<typeof datasetAccessAuditEventSchema>;
export type DatasetAccessAuditListResponse = z.infer<typeof datasetAccessAuditListResponseSchema>;

export const datasetListResponseSchema = z.object({
  datasets: z.array(datasetRecordSchema),
  nextCursor: z.string().nullable().optional()
});

export type DatasetListResponse = z.infer<typeof datasetListResponseSchema>;

export const manifestPartitionSchema = z
  .object({
    id: z.string(),
    partitionKey: z.record(z.unknown()).catch({}),
    storageTargetId: z.string(),
    fileFormat: z.string(),
    filePath: z.string(),
    fileSizeBytes: z.number().nullable().optional(),
    rowCount: z.number().nullable().optional(),
    startTime: z.string(),
    endTime: z.string(),
    checksum: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    createdAt: z.string()
  })
  .passthrough();

export type ManifestPartition = z.infer<typeof manifestPartitionSchema>;

const datasetSchemaFieldSchema = z.object({
  name: z.string(),
  type: z.string()
});

export type DatasetSchemaField = z.infer<typeof datasetSchemaFieldSchema>;

export const manifestResponseSchema = z.object({
  datasetId: z.string(),
  manifest: z
    .object({
      id: z.string(),
      version: z.number(),
      createdAt: z.string(),
      schemaVersionId: z.string().nullable().optional(),
      schemaVersion: z
        .object({
          id: z.string(),
          version: z.number(),
          fields: z.array(datasetSchemaFieldSchema)
        })
        .nullable()
        .optional(),
      partitions: z.array(manifestPartitionSchema)
    })
    .passthrough()
});

export type ManifestResponse = z.infer<typeof manifestResponseSchema>;

export const lifecycleJobSchema = z.object({
  id: z.string(),
  jobKind: z.string(),
  datasetId: z.string().nullable(),
  operations: z.array(z.string()),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'skipped']),
  triggerSource: z.string(),
  scheduledFor: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  attempts: z.number(),
  error: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
});

export type LifecycleJobSummary = z.infer<typeof lifecycleJobSchema>;

const lifecycleOperationTotalsSchema = z.object({
  count: z.number().nonnegative(),
  bytes: z.number().nonnegative(),
  partitions: z.number().nonnegative()
});

export const lifecycleMetricsSnapshotSchema = z.object({
  jobsStarted: z.number().nonnegative(),
  jobsCompleted: z.number().nonnegative(),
  jobsFailed: z.number().nonnegative(),
  jobsSkipped: z.number().nonnegative(),
  lastRunAt: z.string().nullable(),
  lastErrorAt: z.string().nullable(),
  operationTotals: z.object({
    compaction: lifecycleOperationTotalsSchema,
    retention: lifecycleOperationTotalsSchema,
    parquetExport: lifecycleOperationTotalsSchema
  }),
  exportLatencyMs: z.array(z.number().nonnegative())
});

export type LifecycleMetricsSnapshot = z.infer<typeof lifecycleMetricsSnapshotSchema>;

export const lifecycleStatusResponseSchema = z.object({
  jobs: z.array(lifecycleJobSchema),
  metrics: lifecycleMetricsSnapshotSchema.optional()
});

export type LifecycleStatusResponse = z.infer<typeof lifecycleStatusResponseSchema>;

const datasetAccessMetadataSchema = z.record(z.unknown()).catch({});

export const datasetAccessAuditEventSchema = z
  .object({
    id: z.string(),
    datasetId: z.string().nullable(),
    datasetSlug: z.string(),
    actorId: z.string().nullable(),
    actorScopes: z.array(z.string()),
    action: z.string(),
    success: z.boolean(),
    metadata: datasetAccessMetadataSchema,
    createdAt: z.string()
  })
  .passthrough();

export type DatasetAccessAuditEvent = z.infer<typeof datasetAccessAuditEventSchema>;

export const datasetAccessAuditListResponseSchema = z.object({
  events: z.array(datasetAccessAuditEventSchema),
  nextCursor: z.string().nullable()
});

export type DatasetAccessAuditListResponse = z.infer<typeof datasetAccessAuditListResponseSchema>;

export const retentionResponseSchema = z.object({
  datasetId: z.string(),
  datasetSlug: z.string(),
  policy: retentionPolicySchema.nullable(),
  updatedAt: z.string().nullable(),
  effectivePolicy: retentionPolicySchema,
  defaultPolicy: retentionPolicySchema
});

export type RetentionResponse = z.infer<typeof retentionResponseSchema>;

export const lifecycleOperationResultSchema = z.object({
  operation: z.enum(['compaction', 'retention', 'parquetExport']),
  status: z.enum(['skipped', 'completed', 'failed']),
  message: z.string().nullable().optional()
});

export type LifecycleOperationResult = z.infer<typeof lifecycleOperationResultSchema>;

export const lifecycleMaintenanceReportSchema = z.object({
  jobId: z.string(),
  datasetId: z.string(),
  datasetSlug: z.string(),
  operations: z.array(lifecycleOperationResultSchema),
  auditLogEntries: z.array(z.unknown())
});

export type LifecycleMaintenanceReport = z.infer<typeof lifecycleMaintenanceReportSchema>;

export const lifecycleRunCompletedSchema = z.object({
  status: z.literal('completed'),
  report: lifecycleMaintenanceReportSchema
});

export const lifecycleRunQueuedSchema = z.object({
  status: z.literal('queued'),
  jobId: z.string()
});

export type LifecycleRunResponse = z.infer<typeof lifecycleRunCompletedSchema> | z.infer<typeof lifecycleRunQueuedSchema>;

export const queryResponseSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(z.string()),
  mode: z.enum(['raw', 'downsampled'])
});

export type QueryResponse = z.infer<typeof queryResponseSchema>;

export const sqlSchemaColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean().optional(),
  description: z.string().nullable().optional()
});

export type SqlSchemaColumn = z.infer<typeof sqlSchemaColumnSchema>;

export const sqlSchemaTableSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  partitionKeys: z.array(z.string()).optional(),
  columns: z.array(sqlSchemaColumnSchema)
});

export type SqlSchemaTable = z.infer<typeof sqlSchemaTableSchema>;

export const sqlSchemaResponseSchema = z.object({
  fetchedAt: z.string().optional(),
  version: z.string().optional(),
  tables: z.array(sqlSchemaTableSchema),
  warnings: z.array(z.string()).optional()
});

export type SqlSchemaResponse = z.infer<typeof sqlSchemaResponseSchema>;

export const sqlQueryColumnSchema = z.object({
  name: z.string(),
  type: z.string().nullable().optional()
});

export type SqlQueryColumn = z.infer<typeof sqlQueryColumnSchema>;

export const sqlQueryResultSchema = z.object({
  executionId: z.string().optional(),
  columns: z.array(sqlQueryColumnSchema),
  rows: z.array(z.record(z.string(), z.unknown())),
  truncated: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  statistics: z
    .object({
      rowCount: z.number().nonnegative().optional(),
      elapsedMs: z.number().nonnegative().optional()
    })
    .optional()
});

export type SqlQueryResult = z.infer<typeof sqlQueryResultSchema>;
