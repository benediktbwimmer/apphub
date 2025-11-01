import { z } from 'zod';
import type {
  NumberPartitionKeyPredicate,
  PartitionFilters,
  PartitionKeyPredicate,
  ColumnPredicate,
  StringPartitionKeyPredicate,
  TimestampPartitionKeyPredicate,
  BooleanColumnPredicate
} from '../types/partitionFilters';

const commonAggregations = z.object({
  fn: z.enum(['avg', 'min', 'max', 'sum', 'median']),
  column: z.string().min(1),
  alias: z.string().min(1).optional()
});

const countAggregation = z.object({
  fn: z.literal('count'),
  column: z.string().min(1).optional(),
  alias: z.string().min(1).optional()
});

const countDistinctAggregation = z.object({
  fn: z.literal('count_distinct'),
  column: z.string().min(1),
  alias: z.string().min(1).optional()
});

const percentileAggregation = z.object({
  fn: z.literal('percentile'),
  column: z.string().min(1),
  percentile: z.number().min(0).max(1),
  alias: z.string().min(1).optional()
});

export const aggregationSchema = z.union([
  commonAggregations,
  countAggregation,
  countDistinctAggregation,
  percentileAggregation
]);

export type AggregationInput = z.infer<typeof aggregationSchema>;

export const downsampleSchema = z.object({
  intervalUnit: z.enum(['second', 'minute', 'hour', 'day', 'week', 'month']).default('minute'),
  intervalSize: z.number().int().positive().default(1),
  aggregations: z.array(aggregationSchema).min(1)
});

const timestampLiteralSchema = z.string().min(1).refine(isValidIsoTimestamp, {
  message: 'partition timestamp filters must use ISO-8601 strings'
});

const stringPartitionPredicateSchema = z
  .object({
    type: z.literal('string').default('string'),
    eq: z.string().min(1).optional(),
    in: z.array(z.string().min(1)).min(1).optional()
  })
  .refine(hasStringComparator, {
    message: 'string partition filters require eq or in predicates'
  });

const numberPartitionPredicateSchema = z
  .object({
    type: z.literal('number'),
    eq: z.number().optional(),
    in: z.array(z.number()).min(1).optional(),
    gt: z.number().optional(),
    gte: z.number().optional(),
    lt: z.number().optional(),
    lte: z.number().optional()
  })
  .refine(hasNumericOrRangeComparator, {
    message: 'number partition filters require at least one predicate'
  });

const timestampPartitionPredicateSchema = z
  .object({
    type: z.literal('timestamp'),
    eq: timestampLiteralSchema.optional(),
    in: z.array(timestampLiteralSchema).min(1).optional(),
    gt: timestampLiteralSchema.optional(),
    gte: timestampLiteralSchema.optional(),
    lt: timestampLiteralSchema.optional(),
    lte: timestampLiteralSchema.optional()
  })
  .refine(hasTimestampComparator, {
    message: 'timestamp partition filters require at least one predicate'
  });

const booleanColumnPredicateSchema = z
  .object({
    type: z.literal('boolean'),
    eq: z.boolean().optional(),
    in: z.array(z.boolean()).min(1).optional()
  })
  .refine(hasBooleanComparator, {
    message: 'boolean column filters require eq or in predicates'
  });

type RawPartitionKeyFilterValue =
  | z.infer<typeof stringPartitionPredicateSchema>
  | z.infer<typeof numberPartitionPredicateSchema>
  | z.infer<typeof timestampPartitionPredicateSchema>
  | string[];

const partitionKeyFiltersSchema = z
  .record(
    z.union([
      stringPartitionPredicateSchema,
      numberPartitionPredicateSchema,
      timestampPartitionPredicateSchema,
      z.array(z.string().min(1)).min(1)
    ])
  )
  .transform(normalizePartitionKeyFilters);

const columnPredicateSchema = z.union([
  stringPartitionPredicateSchema,
  numberPartitionPredicateSchema,
  timestampPartitionPredicateSchema,
  booleanColumnPredicateSchema
]);

const columnFiltersSchema = z.record(z.string(), columnPredicateSchema).optional();

export const partitionFilterSchema = z
  .object({
    partitionKey: partitionKeyFiltersSchema.optional(),
    columns: columnFiltersSchema
  })
  .transform<PartitionFilters>((value) => {
    const filters: PartitionFilters = {};
    if (value.partitionKey) {
      filters.partitionKey = value.partitionKey;
    }
    if (value.columns) {
      filters.columns = value.columns as Record<string, ColumnPredicate>;
    }
    return filters;
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
  limit: z.number().int().positive().max(500_000).optional()
});

export type QueryRequest = z.infer<typeof queryRequestSchema>;
export type DownsampleInput = z.infer<typeof downsampleSchema>;
export type DownsampleAggregationInput = AggregationInput;

export const queryResponseSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(z.string()),
  mode: z.enum(['raw', 'downsampled'])
});

export type QueryResponse = z.infer<typeof queryResponseSchema>;

function hasStringComparator(predicate: StringPartitionKeyPredicate): boolean {
  return typeof predicate.eq === 'string' || hasValues(predicate.in);
}

function hasNumericOrRangeComparator(predicate: NumberPartitionKeyPredicate): boolean {
  return (
    predicate.eq !== undefined ||
    hasValues(predicate.in) ||
    predicate.gt !== undefined ||
    predicate.gte !== undefined ||
    predicate.lt !== undefined ||
    predicate.lte !== undefined
  );
}

function hasTimestampComparator(predicate: TimestampPartitionKeyPredicate): boolean {
  return (
    typeof predicate.eq === 'string' ||
    hasValues(predicate.in) ||
    typeof predicate.gt === 'string' ||
    typeof predicate.gte === 'string' ||
    typeof predicate.lt === 'string' ||
    typeof predicate.lte === 'string'
  );
}

function hasBooleanComparator(predicate: BooleanColumnPredicate): boolean {
  return predicate.eq !== undefined || hasValues(predicate.in);
}

function hasValues<T>(values: readonly T[] | undefined): values is readonly T[] {
  return Array.isArray(values) && values.length > 0;
}

function isValidIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function normalizePartitionKeyFilters(
  filters: Record<string, RawPartitionKeyFilterValue>
): Record<string, PartitionKeyPredicate> {
  const normalized: Record<string, PartitionKeyPredicate> = {};
  for (const [key, rawValue] of Object.entries(filters)) {
    if (Array.isArray(rawValue)) {
      normalized[key] = {
        type: 'string',
        in: [...rawValue]
      } satisfies PartitionKeyPredicate;
      continue;
    }

    if (rawValue.type === 'string') {
      normalized[key] = {
        type: 'string',
        ...(typeof rawValue.eq === 'string' ? { eq: rawValue.eq } : {}),
        ...(hasValues(rawValue.in) ? { in: [...rawValue.in] } : {})
      } satisfies PartitionKeyPredicate;
      continue;
    }

    if (rawValue.type === 'number') {
      normalized[key] = {
        type: 'number',
        ...(rawValue.eq !== undefined ? { eq: rawValue.eq } : {}),
        ...(hasValues(rawValue.in) ? { in: [...rawValue.in] } : {}),
        ...(rawValue.gt !== undefined ? { gt: rawValue.gt } : {}),
        ...(rawValue.gte !== undefined ? { gte: rawValue.gte } : {}),
        ...(rawValue.lt !== undefined ? { lt: rawValue.lt } : {}),
        ...(rawValue.lte !== undefined ? { lte: rawValue.lte } : {})
      } satisfies PartitionKeyPredicate;
      continue;
    }

    normalized[key] = {
      type: 'timestamp',
      ...(typeof rawValue.eq === 'string' ? { eq: rawValue.eq } : {}),
      ...(hasValues(rawValue.in) ? { in: [...rawValue.in] } : {}),
      ...(typeof rawValue.gt === 'string' ? { gt: rawValue.gt } : {}),
      ...(typeof rawValue.gte === 'string' ? { gte: rawValue.gte } : {}),
      ...(typeof rawValue.lt === 'string' ? { lt: rawValue.lt } : {}),
      ...(typeof rawValue.lte === 'string' ? { lte: rawValue.lte } : {})
    } satisfies PartitionKeyPredicate;
  }
  return normalized;
}
