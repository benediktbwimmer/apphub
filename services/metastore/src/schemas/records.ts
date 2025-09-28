import { z } from 'zod';
import { parseFilterNode } from './filters';
import type { FilterNode, SortField } from '../search/types';

const namespaceSchema = z
  .string()
  .min(1, 'Namespace is required')
  .max(128, 'Namespace exceeds 128 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_-]*$/, 'Namespace may include alphanumeric, colon, underscore, and dash characters');

const keySchema = z
  .string()
  .min(1, 'Key is required')
  .max(256, 'Key exceeds 256 characters');

const metadataSchema = z.record(z.unknown(), {
  invalid_type_error: 'Metadata must be a JSON object'
});

const tagsSchema = z
  .array(
    z
      .string()
      .min(1)
      .max(64)
  )
  .max(128)
  .optional();

const tagsArraySchema = z
  .array(
    z
      .string()
      .min(1)
      .max(64)
  )
  .max(128);

const ownerSchema = z
  .string()
  .min(1)
  .max(256)
  .optional();

const schemaHashSchema = z
  .string()
  .min(6)
  .max(256)
  .optional();

const nullableSchemaHashSchema = schemaHashSchema.or(z.null()).optional();

const nullableOwnerSchema = ownerSchema.or(z.null()).optional();

const versionSchema = z
  .number()
  .int()
  .positive();

const sortFieldSchema = z.object({
  field: z.string().min(1),
  direction: z.enum(['asc', 'desc']).optional()
});

const projectionSchema = z.array(z.string().min(1)).max(32).optional();

const createRecordSchema = z.object({
  namespace: namespaceSchema,
  key: keySchema,
  metadata: metadataSchema,
  tags: tagsSchema,
  owner: ownerSchema,
  schemaHash: schemaHashSchema
});

const updateRecordSchema = z.object({
  metadata: metadataSchema,
  tags: tagsSchema,
  owner: ownerSchema,
  schemaHash: schemaHashSchema,
  expectedVersion: versionSchema.optional()
});

const deleteRecordSchema = z.object({
  expectedVersion: versionSchema.optional()
});

const searchSchema = z.object({
  namespace: namespaceSchema,
  filter: z.unknown().optional(),
  q: z.string().trim().min(1).max(512).optional(),
  preset: z.string().trim().min(1).max(64).optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  sort: z.array(sortFieldSchema).max(5).optional(),
  projection: projectionSchema
});

const bulkUpsertSchema = z.object({
  type: z.enum(['upsert', 'put', 'create']).optional(),
  namespace: namespaceSchema,
  key: keySchema,
  metadata: metadataSchema,
  tags: tagsSchema,
  owner: ownerSchema,
  schemaHash: schemaHashSchema,
  expectedVersion: versionSchema.optional()
});

const bulkDeleteSchema = z.object({
  type: z.literal('delete'),
  namespace: namespaceSchema,
  key: keySchema,
  expectedVersion: versionSchema.optional()
});

const bulkRequestSchema = z.object({
  operations: z.array(z.union([bulkUpsertSchema, bulkDeleteSchema])).min(1).max(100),
  continueOnError: z.boolean().optional()
});

const tagsPatchSchema = z
  .object({
    set: tagsArraySchema.optional(),
    add: tagsArraySchema.optional(),
    remove: tagsArraySchema.optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry && entry.length > 0), {
    message: 'tags patch requires at least one operation'
  })
  .optional();

const metadataUnsetSchema = z.array(z.string().min(1)).max(128).optional();

const patchRecordSchema = z
  .object({
    metadata: metadataSchema.optional(),
    metadataUnset: metadataUnsetSchema,
    tags: tagsPatchSchema,
    owner: nullableOwnerSchema,
    schemaHash: nullableSchemaHashSchema,
    expectedVersion: versionSchema.optional()
  })
  .refine(
    (value) =>
      Boolean(
        value.metadata ||
          (value.metadataUnset && value.metadataUnset.length > 0) ||
          value.tags ||
          value.owner !== undefined ||
          value.schemaHash !== undefined
      ),
    {
      message: 'At least one field (metadata, metadataUnset, tags, owner, schemaHash) must be provided'
    }
  );

const purgeRecordSchema = z.object({
  expectedVersion: versionSchema.optional()
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

export type CreateRecordPayload = z.infer<typeof createRecordSchema>;
export type UpdateRecordPayload = z.infer<typeof updateRecordSchema>;
export type DeleteRecordPayload = z.infer<typeof deleteRecordSchema>;
export type BulkOperationPayload = z.infer<typeof bulkUpsertSchema> | z.infer<typeof bulkDeleteSchema>;
export type BulkRequestPayload = z.infer<typeof bulkRequestSchema>;
export type PatchRecordPayload = z.infer<typeof patchRecordSchema>;
export type PurgeRecordPayload = z.infer<typeof purgeRecordSchema>;
export type AuditQueryPayload = z.infer<typeof auditQuerySchema>;

export function parseCreateRecordPayload(payload: unknown): CreateRecordPayload {
  return createRecordSchema.parse(payload);
}

export function parseUpdateRecordPayload(payload: unknown): UpdateRecordPayload {
  return updateRecordSchema.parse(payload);
}

export function parseDeleteRecordPayload(payload: unknown): DeleteRecordPayload {
  if (!payload) {
    return {};
  }
  return deleteRecordSchema.parse(payload);
}

export function parsePatchRecordPayload(payload: unknown): PatchRecordPayload {
  return patchRecordSchema.parse(payload);
}

export type ParsedSearchPayload = {
  namespace: string;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  filter?: FilterNode;
  q?: string;
  preset?: string;
  sort?: SortField[];
  projection?: string[];
};

export function parseSearchPayload(payload: unknown): ParsedSearchPayload {
  const parsed = searchSchema.parse(payload);
  let filter: FilterNode | undefined;
  if (parsed.filter !== undefined) {
    filter = parseFilterNode(parsed.filter);
  }

  const sort: SortField[] | undefined = parsed.sort?.map((entry) => ({
    field: entry.field,
    direction: entry.direction === 'asc' ? 'asc' : 'desc'
  }));

  return {
    namespace: parsed.namespace,
    includeDeleted: parsed.includeDeleted,
    limit: parsed.limit,
    offset: parsed.offset,
    filter,
    q: parsed.q,
    preset: parsed.preset,
    sort,
    projection: parsed.projection
  } satisfies ParsedSearchPayload;
}

export function parseBulkRequestPayload(payload: unknown): BulkRequestPayload {
  return bulkRequestSchema.parse(payload);
}

export function parsePurgeRecordPayload(payload: unknown): PurgeRecordPayload {
  if (!payload) {
    return {};
  }
  return purgeRecordSchema.parse(payload);
}

export function parseAuditQuery(query: unknown): AuditQueryPayload {
  if (!query) {
    return {};
  }
  return auditQuerySchema.parse(query);
}
