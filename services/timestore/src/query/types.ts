import { z } from 'zod';

export const aggregationFunctionSchema = z.enum(['avg', 'min', 'max', 'sum']);

export const downsampleSchema = z.object({
  intervalUnit: z.enum(['second', 'minute', 'hour', 'day', 'week', 'month']).default('minute'),
  intervalSize: z.number().int().positive().default(1),
  aggregations: z
    .array(
      z.object({
        column: z.string().min(1),
        fn: aggregationFunctionSchema,
        alias: z.string().min(1).optional()
      })
    )
    .min(1)
});

export const partitionFilterSchema = z.object({
  partitionKey: z.record(z.array(z.string().min(1))).optional()
});

export const queryRequestSchema = z.object({
  timeRange: z.object({
    start: z.string().min(1),
    end: z.string().min(1)
  }),
  timestampColumn: z.string().min(1).default('timestamp'),
  columns: z.array(z.string().min(1)).optional(),
  filters: partitionFilterSchema.optional(),
  downsample: downsampleSchema.optional(),
  limit: z.number().int().positive().max(10000).optional()
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type DownsampleInput = z.infer<typeof downsampleSchema>;

export const queryResponseSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(z.string()),
  mode: z.enum(['raw', 'downsampled'])
});

export type QueryResponse = z.infer<typeof queryResponseSchema>;
