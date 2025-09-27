import { z } from 'zod';

export const filestoreBackendKindSchema = z.enum(['local', 's3']);
export type FilestoreBackendKind = z.infer<typeof filestoreBackendKindSchema>;

export const filestoreBackendAccessModeSchema = z.enum(['rw', 'ro']);
export type FilestoreBackendAccessMode = z.infer<typeof filestoreBackendAccessModeSchema>;

export const filestoreBackendMountStateSchema = z.enum(['active', 'inactive', 'offline', 'degraded', 'error', 'unknown']);
export type FilestoreBackendMountState = z.infer<typeof filestoreBackendMountStateSchema>;

const labeledStringSchema = z.string().trim().min(1).max(64);

export const filestoreBackendMountSchema = z.object({
  id: z.number().int().positive(),
  mountKey: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(128).nullable(),
  description: z.string().trim().min(1).max(1024).nullable(),
  contact: z.string().trim().min(1).max(256).nullable(),
  labels: z.array(labeledStringSchema).max(32),
  backendKind: filestoreBackendKindSchema,
  accessMode: filestoreBackendAccessModeSchema,
  state: filestoreBackendMountStateSchema,
  stateReason: z.string().trim().min(1).max(256).nullable(),
  rootPath: z.string().trim().min(1).max(2048).nullable(),
  bucket: z.string().trim().min(1).max(256).nullable(),
  prefix: z.string().trim().max(512).nullable(),
  lastHealthCheckAt: z.string().nullable(),
  lastHealthStatus: z.string().trim().min(1).max(128).nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type FilestoreBackendMount = z.infer<typeof filestoreBackendMountSchema>;

const mutationBaseSchema = z.object({
  displayName: z.string().trim().min(1).max(128).nullable().optional(),
  description: z.string().trim().min(1).max(1024).nullable().optional(),
  contact: z.string().trim().min(1).max(256).nullable().optional(),
  labels: z.array(labeledStringSchema).max(32).optional(),
  state: filestoreBackendMountStateSchema.optional(),
  stateReason: z.string().trim().min(1).max(256).nullable().optional(),
  accessMode: filestoreBackendAccessModeSchema.optional(),
  rootPath: z.string().trim().min(1).max(2048).nullable().optional(),
  bucket: z.string().trim().min(1).max(256).nullable().optional(),
  prefix: z.string().trim().max(512).nullable().optional()
});

export const filestoreBackendMountCreateSchema = mutationBaseSchema
  .extend({
    mountKey: z.string().trim().min(1).max(128),
    backendKind: filestoreBackendKindSchema,
    state: filestoreBackendMountStateSchema.default('active'),
    accessMode: filestoreBackendAccessModeSchema.default('rw')
  })
  .superRefine((value, ctx) => {
    if (value.backendKind === 'local') {
      if (!value.rootPath || value.rootPath.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'rootPath is required for local mounts',
          path: ['rootPath']
        });
      }
    }
    if (value.backendKind === 's3') {
      if (!value.bucket || value.bucket.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'bucket is required for s3 mounts',
          path: ['bucket']
        });
      }
    }
  });
export type FilestoreBackendMountCreateInput = z.infer<typeof filestoreBackendMountCreateSchema>;

export const filestoreBackendMountUpdateSchema = mutationBaseSchema
  .extend({
    mountKey: z.string().trim().min(1).max(128).optional()
  })
  .superRefine((value, ctx) => {
    const keys = Object.keys(value).filter((key) => (value as Record<string, unknown>)[key] !== undefined);
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'provide at least one field to update'
      });
    }
  });
export type FilestoreBackendMountUpdateInput = z.infer<typeof filestoreBackendMountUpdateSchema>;

export const filestoreBackendMountListFiltersSchema = z.object({
  search: z.string().trim().min(1).max(256).nullable(),
  kinds: z.array(filestoreBackendKindSchema),
  states: z.array(filestoreBackendMountStateSchema),
  accessModes: z.array(filestoreBackendAccessModeSchema)
});
export type FilestoreBackendMountListFilters = z.infer<typeof filestoreBackendMountListFiltersSchema>;

export const filestoreBackendMountEnvelopeSchema = z.object({
  data: filestoreBackendMountSchema
});

export const filestoreBackendMountListEnvelopeSchema = z.object({
  data: z.object({
    mounts: z.array(filestoreBackendMountSchema),
    pagination: z.object({
      total: z.number().nonnegative(),
      limit: z.number().int().positive(),
      offset: z.number().int().nonnegative(),
      nextOffset: z.number().int().nonnegative().nullable()
    }),
    filters: filestoreBackendMountListFiltersSchema
  })
});
export type FilestoreBackendMountList = z.infer<typeof filestoreBackendMountListEnvelopeSchema>['data'];
