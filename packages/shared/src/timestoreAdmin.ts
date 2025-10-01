import { z } from 'zod';

export const datasetStatusSchema = z.enum(['active', 'inactive']);

const scopeArraySchema = z
  .array(z.string().min(1).max(128))
  .max(16)
  .transform((value) => value.map((entry) => entry.trim()))
  .refine((value) => value.every((entry) => entry.length > 0), {
    message: 'Scopes must be non-empty strings'
  });

export const datasetIamConfigSchema = z
  .object({
    readScopes: scopeArraySchema.optional(),
    writeScopes: scopeArraySchema.optional()
  })
  .strict();

const datasetExecutionMetadataSchema = z
  .object({
    backend: z.string().min(1),
    options: z.record(z.unknown()).optional()
  })
  .strict();

export const datasetMetadataSchema = z
  .object({
    iam: datasetIamConfigSchema.nullable().optional(),
    execution: z.union([datasetExecutionMetadataSchema, z.null()]).optional()
  })
  .catchall(z.unknown());

export const datasetRecordSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  status: datasetStatusSchema,
  writeFormat: z.literal('parquet'),
  defaultStorageTargetId: z.string().nullable(),
  metadata: datasetMetadataSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
});

export const createDatasetRequestSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9-_.]+$/i, 'Slug may only include letters, numbers, dashes, underscores, and dots'),
  name: z.string().min(1).max(160),
  description: z.string().max(1000).nullable().optional(),
  status: datasetStatusSchema.optional(),
  writeFormat: z.literal('parquet').optional(),
  defaultStorageTargetId: z.string().min(1).nullable().optional(),
  metadata: datasetMetadataSchema.optional(),
  idempotencyKey: z.string().min(4).max(100).optional()
});

export const patchDatasetRequestSchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    description: z.string().max(1000).nullable().optional(),
    status: datasetStatusSchema.optional(),
    defaultStorageTargetId: z.string().min(1).nullable().optional(),
    metadata: datasetMetadataSchema.optional(),
    ifMatch: z.string().min(1).optional()
  })
  .refine((value) => {
    const keys = Object.keys(value).filter((key) => key !== 'ifMatch');
    return keys.length > 0;
  }, {
    message: 'At least one field must be provided to update'
  });

export const archiveDatasetRequestSchema = z.object({
  reason: z.string().max(500).optional(),
  ifMatch: z.string().min(1).optional()
});

export const datasetResponseSchema = z.object({
  dataset: datasetRecordSchema,
  etag: z.string().min(1)
});

const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO-8601 timestamp'
  });

export const datasetAccessAuditEventSchema = z.object({
  id: z.string().min(1),
  datasetId: z.string().min(1).nullable(),
  datasetSlug: z.string().min(1),
  actorId: z.string().min(1).nullable(),
  actorScopes: z.array(z.string().min(1)),
  action: z.string().min(1),
  success: z.boolean(),
  metadata: z.record(z.unknown()),
  createdAt: isoDateTimeSchema
});

export const datasetAccessAuditListQuerySchema = z.object({
  limit: z.number().min(1).max(200).optional(),
  cursor: z.string().min(1).optional(),
  actions: z.array(z.string().min(1)).optional(),
  success: z.boolean().optional(),
  startTime: isoDateTimeSchema.optional(),
  endTime: isoDateTimeSchema.optional()
});

export const datasetAccessAuditListResponseSchema = z.object({
  events: z.array(datasetAccessAuditEventSchema),
  nextCursor: z.string().min(1).nullable()
});

export type DatasetStatus = z.infer<typeof datasetStatusSchema>;
export type DatasetIamConfig = z.infer<typeof datasetIamConfigSchema>;
export type DatasetExecutionMetadata = z.infer<typeof datasetExecutionMetadataSchema>;
export type DatasetMetadata = z.infer<typeof datasetMetadataSchema>;
export type DatasetRecord = z.infer<typeof datasetRecordSchema>;
export type CreateDatasetRequest = z.infer<typeof createDatasetRequestSchema>;
export type PatchDatasetRequest = z.infer<typeof patchDatasetRequestSchema>;
export type ArchiveDatasetRequest = z.infer<typeof archiveDatasetRequestSchema>;
export type DatasetAccessAuditEvent = z.infer<typeof datasetAccessAuditEventSchema>;
export type DatasetAccessAuditListQuery = z.infer<typeof datasetAccessAuditListQuerySchema>;
export type DatasetAccessAuditListResponse = z.infer<typeof datasetAccessAuditListResponseSchema>;
