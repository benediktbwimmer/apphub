import { z } from 'zod';

export const recordMetadataSchema = z.object({}).passthrough();

const recordBaseSchema = z.object({
  id: z.string(),
  namespace: z.string(),
  recordKey: z.string(),
  displayName: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  schemaHash: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable()
});

export const recordSummarySchema = recordBaseSchema.extend({
  metadata: recordMetadataSchema.optional(),
  tags: z.array(z.string()).optional()
});

export type MetastoreRecordSummary = z.infer<typeof recordSummarySchema>;

export const recordDetailSchema = recordBaseSchema.extend({
  metadata: recordMetadataSchema,
  tags: z.array(z.string())
});

export type MetastoreRecordDetail = z.infer<typeof recordDetailSchema>;

export const searchResponseSchema = z.object({
  pagination: z.object({
    total: z.number().nonnegative(),
    limit: z.number().positive(),
    offset: z.number().nonnegative()
  }),
  records: z.array(recordSummarySchema)
});

export type MetastoreSearchResponse = z.infer<typeof searchResponseSchema>;

export const recordResponseSchema = z.object({
  record: recordDetailSchema
});

export const auditEntrySchema = z.object({
  id: z.string(),
  namespace: z.string(),
  recordKey: z.string(),
  action: z.string(),
  actor: z.string().nullable(),
  version: z.number().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string()
});

export type MetastoreAuditEntry = z.infer<typeof auditEntrySchema>;

export const auditResponseSchema = z.object({
  pagination: z.object({
    total: z.number().nonnegative(),
    limit: z.number().positive(),
    offset: z.number().nonnegative()
  }),
  entries: z.array(auditEntrySchema)
});

export const upsertPayloadSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  owner: z.string().nullable().optional(),
  schemaHash: z.string().nullable().optional(),
  expectedVersion: z.number().optional()
});

export type MetastoreUpsertPayload = z.infer<typeof upsertPayloadSchema>;

export const patchPayloadSchema = z.object({
  metadata: z.record(z.unknown()).optional(),
  metadataUnset: z.array(z.string()).optional(),
  tags: z
    .object({
      set: z.array(z.string()).optional(),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional()
    })
    .optional(),
  owner: z.string().nullable().optional(),
  schemaHash: z.string().nullable().optional(),
  expectedVersion: z.number().optional()
});

export type MetastorePatchPayload = z.infer<typeof patchPayloadSchema>;

export const deletePayloadSchema = z.object({
  expectedVersion: z.number().optional()
});

export const bulkOperationSchema = z.union([
  z.object({
    type: z.literal('upsert'),
    namespace: z.string(),
    key: z.string(),
    metadata: z.record(z.unknown()).optional(),
    tags: z.array(z.string()).optional(),
    owner: z.string().nullable().optional(),
    schemaHash: z.string().nullable().optional(),
    expectedVersion: z.number().optional()
  }),
  z.object({
    type: z.literal('delete'),
    namespace: z.string(),
    key: z.string(),
    expectedVersion: z.number().optional()
  })
]);

export type BulkOperation = z.infer<typeof bulkOperationSchema>;

export const bulkRequestSchema = z.object({
  operations: z.array(bulkOperationSchema).min(1),
  continueOnError: z.boolean().optional()
});

export type BulkRequestPayload = z.infer<typeof bulkRequestSchema>;

export const bulkResponseSchema = z.object({
  operations: z.array(
    z.object({
      status: z.enum(['ok', 'error']),
      namespace: z.string().optional(),
      key: z.string().optional(),
      record: recordSummarySchema.optional(),
      created: z.boolean().optional(),
      error: z
        .object({
          statusCode: z.number().optional(),
          code: z.string().optional(),
          message: z.string().optional()
        })
        .optional()
    })
  )
});

export type BulkResponsePayload = z.infer<typeof bulkResponseSchema>;

export const namespaceOwnerCountSchema = z.object({
  owner: z.string(),
  count: z.number().int().nonnegative()
});

export const namespaceSummarySchema = z.object({
  name: z.string(),
  totalRecords: z.number().int().nonnegative(),
  deletedRecords: z.number().int().nonnegative(),
  lastUpdatedAt: z.string().nullable(),
  ownerCounts: z.array(namespaceOwnerCountSchema).optional()
});

export const namespaceListResponseSchema = z.object({
  pagination: z.object({
    total: z.number().nonnegative(),
    limit: z.number().positive(),
    offset: z.number().nonnegative(),
    nextOffset: z.number().nonnegative().optional()
  }),
  namespaces: z.array(namespaceSummarySchema)
});

export type MetastoreNamespaceOwnerCount = z.infer<typeof namespaceOwnerCountSchema>;

export type MetastoreNamespaceSummary = z.infer<typeof namespaceSummarySchema>;

export type MetastoreNamespaceListResponse = z.infer<typeof namespaceListResponseSchema>;
