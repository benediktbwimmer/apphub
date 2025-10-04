import { z } from 'zod';

export const ANALYTICS_RANGE_OPTIONS = ['24h', '7d', '30d'] as const;
export const ANALYTICS_BUCKET_OPTIONS = ['15m', 'hour', 'day'] as const;

export type AnalyticsRangeOption = (typeof ANALYTICS_RANGE_OPTIONS)[number];
export type AnalyticsBucketOption = (typeof ANALYTICS_BUCKET_OPTIONS)[number];
export type AnalyticsRangeKey = AnalyticsRangeOption | 'custom';

export const ANALYTICS_RANGE_HOURS: Record<AnalyticsRangeOption, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30
};

export const workflowAnalyticsQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    range: z.enum(ANALYTICS_RANGE_OPTIONS).optional(),
    bucket: z.enum(ANALYTICS_BUCKET_OPTIONS).optional()
  })
  .partial()
  .strict();

export type WorkflowAnalyticsQuery = z.infer<typeof workflowAnalyticsQuerySchema>;

export type NormalizedAnalyticsQuery = {
  rangeKey: AnalyticsRangeKey;
  bucketKey: AnalyticsBucketOption | null;
  options: { from: Date; to: Date; bucketInterval?: string };
};

export const ANALYTICS_ERROR_MESSAGES: Record<string, string> = {
  invalid_from: 'Invalid "from" timestamp',
  invalid_to: 'Invalid "to" timestamp',
  invalid_range: 'The "from" timestamp must be before "to"',
  invalid_bucket: 'Invalid bucket option'
};

export function parseIsoDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

export function mapBucketKeyToInterval(bucketKey: AnalyticsBucketOption | null | undefined):
  | { key: AnalyticsBucketOption; interval: string }
  | null {
  if (!bucketKey) {
    return null;
  }
  switch (bucketKey) {
    case '15m':
      return { key: '15m', interval: '15 minutes' };
    case 'hour':
      return { key: 'hour', interval: '1 hour' };
    case 'day':
      return { key: 'day', interval: '1 day' };
    default:
      return null;
  }
}

export function mapIntervalToBucketKey(interval: string | null | undefined): AnalyticsBucketOption | null {
  if (!interval) {
    return null;
  }
  switch (interval) {
    case '15 minutes':
      return '15m';
    case '1 hour':
      return 'hour';
    case '1 day':
      return 'day';
    default:
      return null;
  }
}

export function normalizeAnalyticsQuery(
  query: WorkflowAnalyticsQuery
): { ok: true; value: NormalizedAnalyticsQuery } | { ok: false; error: string } {
  const toDate = parseIsoDate(query.to);
  if (query.to && !toDate) {
    return { ok: false, error: 'invalid_to' };
  }
  const fromDate = parseIsoDate(query.from);
  if (query.from && !fromDate) {
    return { ok: false, error: 'invalid_from' };
  }

  let rangeKey: AnalyticsRangeKey = query.range ?? '7d';
  let to = toDate ?? new Date();
  let from = fromDate ?? null;

  if (fromDate || toDate) {
    rangeKey = query.range ?? 'custom';
  }

  const effectiveRange: AnalyticsRangeOption =
    rangeKey === 'custom' ? '7d' : (rangeKey as AnalyticsRangeOption);

  if (!from) {
    const hours = ANALYTICS_RANGE_HOURS[effectiveRange] ?? ANALYTICS_RANGE_HOURS['7d'];
    from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  }

  if (from.getTime() >= to.getTime()) {
    return { ok: false, error: 'invalid_range' };
  }

  const bucketConfig = mapBucketKeyToInterval(query.bucket ?? null);
  if (query.bucket && !bucketConfig) {
    return { ok: false, error: 'invalid_bucket' };
  }

  return {
    ok: true,
    value: {
      rangeKey,
      bucketKey: bucketConfig?.key ?? null,
      options: bucketConfig
        ? { from, to, bucketInterval: bucketConfig.interval }
        : { from, to }
    }
  };
}
