import { z, type ZodTypeAny } from 'zod';

export const recordStreamActionSchema = z.enum(['created', 'updated', 'deleted']);

export const recordStreamEventSchema = z.object({
  action: recordStreamActionSchema,
  namespace: z.string(),
  key: z.string(),
  version: z.number().nullable(),
  occurredAt: z.string(),
  updatedAt: z.string().nullable(),
  deletedAt: z.string().nullable(),
  actor: z.string().nullable(),
  mode: z.enum(['soft', 'hard']).optional()
});

export type MetastoreRecordStreamEvent = z.infer<typeof recordStreamEventSchema>;

export const recordMetadataSchema = z.object({}).passthrough();

export const schemaFieldDefinitionSchema = z
  .object({
    path: z.string(),
    type: z.string(),
    description: z.string().optional(),
    required: z.boolean().optional(),
    repeated: z.boolean().optional(),
    constraints: z.record(z.string(), z.unknown()).optional(),
    hints: z.record(z.string(), z.unknown()).optional(),
    examples: z.array(z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type MetastoreSchemaFieldDefinition = z.infer<typeof schemaFieldDefinitionSchema>;

export const schemaDefinitionSchema = z
  .object({
    schemaHash: z.string(),
    name: z.string().optional(),
    description: z.string().optional(),
    version: z.union([z.string(), z.number()]).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    fields: z.array(schemaFieldDefinitionSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
    cache: z.enum(['database', 'cache']).optional()
  })
  .strict();

export type MetastoreSchemaDefinition = z.infer<typeof schemaDefinitionSchema>;

export type MetastoreSchemaFetchResult =
  | { status: 'found'; schema: MetastoreSchemaDefinition }
  | { status: 'missing'; message: string };

type WithRecordIdentity<T> = Omit<T, 'id' | 'recordKey'> & {
  id: string;
  key: string;
  recordKey: string;
};

function normalizeRecordSchema<T extends ZodTypeAny>(
  schema: T
): z.ZodEffects<T, WithRecordIdentity<z.infer<T>>, z.infer<T>> {
  return schema.transform((value) => {
    const record = value as z.infer<T> & {
      id?: string | number | null;
      namespace: string;
      key: string;
      recordKey?: string | null;
    };

    const recordKey = record.recordKey && record.recordKey.length > 0 ? record.recordKey : record.key;
    const idSource = record.id;
    const normalizedId =
      idSource === undefined || idSource === null ? `${record.namespace}:${recordKey}` : String(idSource);

    return {
      ...record,
      id: normalizedId,
      key: record.key,
      recordKey
    } satisfies WithRecordIdentity<z.infer<T>>;
  });
}

const recordBaseSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  namespace: z.string(),
  key: z.string(),
  recordKey: z.string().optional(),
  displayName: z.string().nullable().optional(),
  owner: z.string().nullable().optional(),
  schemaHash: z.string().nullable().optional(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable()
});

export const recordSummarySchema = normalizeRecordSchema(
  recordBaseSchema.extend({
    metadata: recordMetadataSchema.optional(),
    tags: z.array(z.string()).optional()
  })
);

export type MetastoreRecordSummary = z.infer<typeof recordSummarySchema>;

export const recordDetailSchema = normalizeRecordSchema(
  recordBaseSchema.extend({
    metadata: recordMetadataSchema,
    tags: z.array(z.string())
  })
);

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

const auditActionSchema = z.enum(['create', 'update', 'delete', 'restore']);

export type MetastoreAuditAction = z.infer<typeof auditActionSchema>;

export const auditEntrySchema = z.object({
  id: z.number().int().positive(),
  namespace: z.string(),
  recordKey: z.string(),
  action: auditActionSchema,
  actor: z.string().nullable(),
  previousVersion: z.number().int().positive().nullable(),
  version: z.number().int().positive().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  previousMetadata: z.record(z.string(), z.unknown()).nullable(),
  tags: z.array(z.string()).nullable(),
  previousTags: z.array(z.string()).nullable(),
  owner: z.string().nullable(),
  previousOwner: z.string().nullable(),
  schemaHash: z.string().nullable(),
  previousSchemaHash: z.string().nullable(),
  createdAt: z.string(),
  correlationId: z.string().nullable().optional()
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

export type MetastoreAuditResponse = z.infer<typeof auditResponseSchema>;

const metadataDiffValueSchema = z.object({
  path: z.string(),
  value: z.unknown()
});

const metadataDiffChangeSchema = z.object({
  path: z.string(),
  before: z.unknown(),
  after: z.unknown()
});

export const auditMetadataDiffSchema = z.object({
  added: z.array(metadataDiffValueSchema),
  removed: z.array(metadataDiffValueSchema),
  changed: z.array(metadataDiffChangeSchema)
});

export type MetastoreAuditMetadataDiff = z.infer<typeof auditMetadataDiffSchema>;

export const auditTagsDiffSchema = z.object({
  added: z.array(z.string()),
  removed: z.array(z.string())
});

export type MetastoreAuditTagsDiff = z.infer<typeof auditTagsDiffSchema>;

export const auditScalarDiffSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    before: schema.nullable(),
    after: schema.nullable(),
    changed: z.boolean()
  });

export const auditSnapshotSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).nullable(),
  tags: z.array(z.string()),
  owner: z.string().nullable(),
  schemaHash: z.string().nullable()
});

export const auditDiffSchema = z.object({
  audit: z.object({
    id: z.number().int().positive(),
    namespace: z.string(),
    key: z.string(),
    action: auditActionSchema,
    actor: z.string().nullable(),
    previousVersion: z.number().int().positive().nullable(),
    version: z.number().int().positive().nullable(),
    createdAt: z.string()
  }),
  metadata: auditMetadataDiffSchema,
  tags: auditTagsDiffSchema,
  owner: auditScalarDiffSchema(z.string()),
  schemaHash: auditScalarDiffSchema(z.string()),
  snapshots: z.object({
    current: auditSnapshotSchema,
    previous: auditSnapshotSchema
  })
});

export type MetastoreAuditDiff = z.infer<typeof auditDiffSchema>;

export const upsertPayloadSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  owner: z.string().nullable().optional(),
  schemaHash: z.string().nullable().optional(),
  expectedVersion: z.number().optional()
});

export type MetastoreUpsertPayload = z.infer<typeof upsertPayloadSchema>;

export const restorePayloadSchema = z
  .object({
    auditId: z.number().int().positive().optional(),
    version: z.number().int().positive().optional(),
    expectedVersion: z.number().optional()
  })
  .refine((value) => value.auditId !== undefined || value.version !== undefined, {
    message: 'Either auditId or version must be provided'
  })
  .refine((value) => !(value.auditId !== undefined && value.version !== undefined), {
    message: 'Specify either auditId or version, not both'
  });

export type MetastoreRestorePayload = z.infer<typeof restorePayloadSchema>;

export const patchPayloadSchema = z.object({
  metadata: z.record(z.string(), z.unknown()).optional(),
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
    metadata: z.record(z.string(), z.unknown()).optional(),
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

export const restoreResponseSchema = z.object({
  restored: z.boolean(),
  record: recordDetailSchema,
  restoredFrom: z.object({
    auditId: z.number().int().positive(),
    version: z.number().int().positive().nullable()
  })
});

export type MetastoreRestoreResponse = z.infer<typeof restoreResponseSchema>;

export const filestoreHealthSnapshotSchema = z.object({
  status: z.enum(['disabled', 'ok', 'stalled']),
  enabled: z.boolean(),
  inline: z.boolean(),
  thresholdSeconds: z.number().int().min(1),
  lagSeconds: z.number().nullable(),
  lastEvent: z.object({
    type: z.string().nullable(),
    observedAt: z.string().nullable(),
    receivedAt: z.string().nullable()
  }),
  retries: z.object({
    connect: z.number().int().nonnegative(),
    processing: z.number().int().nonnegative(),
    total: z.number().int().nonnegative()
  })
});

export type MetastoreFilestoreHealth = z.infer<typeof filestoreHealthSnapshotSchema>;

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
