import { z } from 'zod';

export const filestoreRollupStateSchema = z.enum(['up_to_date', 'pending', 'stale', 'invalid']);

const metadataValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const filestoreMetadataFilterSchema = z
  .object({
    key: z.string().trim().min(1, 'Metadata key is required'),
    value: metadataValueSchema
  })
  .strict();

const numericRangeSchema = z
  .object({
    min: z
      .number({ invalid_type_error: 'Minimum must be a number' })
      .finite()
      .int()
      .min(0, 'Minimum must be non-negative')
      .optional(),
    max: z
      .number({ invalid_type_error: 'Maximum must be a number' })
      .finite()
      .int()
      .min(0, 'Maximum must be non-negative')
      .optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasMin = typeof value.min === 'number';
    const hasMax = typeof value.max === 'number';
    if (!hasMin && !hasMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one bound'
      });
      return;
    }
    if (hasMin && hasMax && (value.min as number) > (value.max as number)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Minimum cannot exceed maximum'
      });
    }
  });

const datetimeStringSchema = z.string().transform((value, ctx) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Timestamp must not be empty'
    });
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Timestamp must be ISO-8601 compliant'
    });
  }
  return trimmed;
});

const dateRangeSchema = z
  .object({
    after: datetimeStringSchema.optional(),
    before: datetimeStringSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasAfter = typeof value.after === 'string' && value.after.length > 0;
    const hasBefore = typeof value.before === 'string' && value.before.length > 0;
    if (!hasAfter && !hasBefore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one bound'
      });
      return;
    }
    if (hasAfter && hasBefore) {
      const afterDate = new Date(value.after as string);
      const beforeDate = new Date(value.before as string);
      if (afterDate > beforeDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'After must be before the upper bound'
        });
      }
    }
  });

const rollupStatsFilterSchema = z
  .object({
    states: z.array(filestoreRollupStateSchema).min(1).optional(),
    minChildCount: z.number().int().min(0).optional(),
    maxChildCount: z.number().int().min(0).optional(),
    minFileCount: z.number().int().min(0).optional(),
    maxFileCount: z.number().int().min(0).optional(),
    minDirectoryCount: z.number().int().min(0).optional(),
    maxDirectoryCount: z.number().int().min(0).optional(),
    minSizeBytes: z.number().int().min(0).optional(),
    maxSizeBytes: z.number().int().min(0).optional(),
    lastCalculatedAfter: datetimeStringSchema.optional(),
    lastCalculatedBefore: datetimeStringSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const fields = [
      value.states,
      value.minChildCount,
      value.maxChildCount,
      value.minFileCount,
      value.maxFileCount,
      value.minDirectoryCount,
      value.maxDirectoryCount,
      value.minSizeBytes,
      value.maxSizeBytes,
      value.lastCalculatedAfter,
      value.lastCalculatedBefore
    ];
    if (!fields.some((entry) => entry !== undefined && entry !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one rollup constraint'
      });
      return;
    }

    const ensureRange = (
      min: number | undefined,
      max: number | undefined,
      label: string
    ) => {
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} minimum cannot exceed maximum`
        });
      }
    };

    ensureRange(value.minChildCount, value.maxChildCount, 'Child count');
    ensureRange(value.minFileCount, value.maxFileCount, 'File count');
    ensureRange(value.minDirectoryCount, value.maxDirectoryCount, 'Directory count');
    ensureRange(value.minSizeBytes, value.maxSizeBytes, 'Size bytes');

    if (value.lastCalculatedAfter && value.lastCalculatedBefore) {
      const afterDate = new Date(value.lastCalculatedAfter);
      const beforeDate = new Date(value.lastCalculatedBefore);
      if (afterDate > beforeDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Rollup window start must be before the end'
        });
      }
    }
  });

export const filestoreNodeFiltersSchema = z
  .object({
    query: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1, 'Query must not be empty'))
      .optional(),
    metadata: z.array(filestoreMetadataFilterSchema).max(16).optional(),
    size: numericRangeSchema.optional(),
    lastSeenAt: dateRangeSchema.optional(),
    rollup: rollupStatsFilterSchema.optional()
  })
  .strict();

export type FilestoreRollupState = z.infer<typeof filestoreRollupStateSchema>;
export type FilestoreMetadataFilter = z.infer<typeof filestoreMetadataFilterSchema>;
export type FilestoreNumericRangeFilter = z.infer<typeof numericRangeSchema>;
export type FilestoreDateRangeFilter = z.infer<typeof dateRangeSchema>;
export type FilestoreRollupFilter = z.infer<typeof rollupStatsFilterSchema>;
export type FilestoreNodeFilters = z.infer<typeof filestoreNodeFiltersSchema>;

export function isFilestoreNodeFiltersEmpty(filters: FilestoreNodeFilters | null | undefined): boolean {
  if (!filters) {
    return true;
  }
  const { query, metadata, size, lastSeenAt, rollup } = filters;
  if (query && query.trim().length > 0) {
    return false;
  }
  if (metadata && metadata.length > 0) {
    return false;
  }
  if (size) {
    return false;
  }
  if (lastSeenAt) {
    return false;
  }
  if (rollup) {
    return false;
  }
  return true;
}

export function parseFilestoreNodeFilters(input: unknown): FilestoreNodeFilters {
  if (!input || (typeof input === 'object' && Object.keys(input as Record<string, unknown>).length === 0)) {
    return {};
  }
  return filestoreNodeFiltersSchema.parse(input);
}

export type FilestoreNodeFiltersParseResult = ReturnType<typeof filestoreNodeFiltersSchema.safeParse>;

export function safeParseFilestoreNodeFilters(input: unknown): FilestoreNodeFiltersParseResult {
  if (!input || (typeof input === 'object' && Object.keys(input as Record<string, unknown>).length === 0)) {
    return { success: true, data: {} as FilestoreNodeFilters };
  }
  return filestoreNodeFiltersSchema.safeParse(input);
}

export function decodeFilestoreNodeFiltersParam(value: string | null | undefined): FilestoreNodeFilters | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    const result = safeParseFilestoreNodeFilters(parsed);
    if (result.success) {
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeFilestoreNodeFiltersParam(filters: FilestoreNodeFilters | null | undefined): string | null {
  if (!filters || isFilestoreNodeFiltersEmpty(filters)) {
    return null;
  }
  return JSON.stringify(filters);
}
