import type { WorkflowAssetPartitioning, WorkflowStepDefinition } from '../db/types';

type PartitionValidationResult =
  | { ok: true; key: string }
  | { ok: false; error: string };

type EnumerateOptions = {
  now?: Date;
  lookback?: number;
};

function cloneDate(source: Date): Date {
  return new Date(source.getTime());
}

function startOfIntervalUTC(date: Date, granularity: 'hour' | 'day' | 'week' | 'month'): Date {
  const clone = cloneDate(date);
  switch (granularity) {
    case 'hour':
      clone.setUTCMinutes(0, 0, 0);
      return clone;
    case 'day':
      clone.setUTCHours(0, 0, 0, 0);
      return clone;
    case 'week': {
      clone.setUTCHours(0, 0, 0, 0);
      const weekday = clone.getUTCDay();
      const offset = (weekday + 6) % 7; // Monday start
      clone.setUTCDate(clone.getUTCDate() - offset);
      return clone;
    }
    case 'month':
    default:
      clone.setUTCDate(1);
      clone.setUTCHours(0, 0, 0, 0);
      return clone;
  }
}

function subtractIntervalUTC(date: Date, granularity: 'hour' | 'day' | 'week' | 'month'): Date {
  const clone = cloneDate(date);
  switch (granularity) {
    case 'hour':
      clone.setUTCHours(clone.getUTCHours() - 1);
      break;
    case 'day':
      clone.setUTCDate(clone.getUTCDate() - 1);
      break;
    case 'week':
      clone.setUTCDate(clone.getUTCDate() - 7);
      break;
    case 'month':
    default:
      clone.setUTCMonth(clone.getUTCMonth() - 1);
      break;
  }
  return startOfIntervalUTC(clone, granularity);
}

function formatTimePartitionKey(
  partitioning: Extract<WorkflowAssetPartitioning, { type: 'timeWindow' }>,
  date: Date
): string {
  const iso = date.toISOString();
  const format = partitioning.format ?? null;
  if (!format) {
    return iso;
  }
  switch (format) {
    case 'YYYY-MM-DD':
      return iso.slice(0, 10);
    case 'YYYY-MM-DDTHH':
      return iso.slice(0, 13);
    case 'YYYY-MM-DDTHH:mm':
      return iso.slice(0, 16);
    default:
      return iso;
  }
}

function enumerateTimeWindowPartitions(
  partitioning: Extract<WorkflowAssetPartitioning, { type: 'timeWindow' }>,
  options: EnumerateOptions
): string[] {
  const now = options.now ?? new Date();
  const base = startOfIntervalUTC(now, partitioning.granularity);
  const defaultLookback = (() => {
    switch (partitioning.granularity) {
      case 'hour':
        return 24;
      case 'week':
        return 8;
      case 'month':
        return 12;
      case 'day':
      default:
        return 14;
    }
  })();
  const lookback = Math.max(1, Math.min(options.lookback ?? partitioning.lookbackWindows ?? defaultLookback, 10_000));

  const partitions: string[] = [];
  let cursor = base;
  for (let index = 0; index < lookback; index += 1) {
    partitions.push(formatTimePartitionKey(partitioning, cursor));
    cursor = subtractIntervalUTC(cursor, partitioning.granularity);
  }
  return partitions;
}

function enumerateStaticPartitions(
  partitioning: Extract<WorkflowAssetPartitioning, { type: 'static' }>
): string[] {
  return Array.from(new Set(partitioning.keys));
}

export function enumeratePartitionKeys(
  partitioning: WorkflowAssetPartitioning,
  options: EnumerateOptions = {}
): string[] {
  switch (partitioning.type) {
    case 'static':
      return enumerateStaticPartitions(partitioning);
    case 'timeWindow':
      return enumerateTimeWindowPartitions(partitioning, options);
    case 'dynamic':
    default:
      return [];
  }
}

function validateStaticKey(
  partitioning: Extract<WorkflowAssetPartitioning, { type: 'static' }>,
  key: string
): PartitionValidationResult {
  if (!key) {
    return { ok: false, error: 'Partition key is required for this asset' };
  }
  if (partitioning.keys.includes(key)) {
    return { ok: true, key };
  }
  return { ok: false, error: 'Partition key is not part of the configured set' };
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_HOUR_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}$/;
const DATE_MINUTE_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function validateTimeWindowKey(
  partitioning: Extract<WorkflowAssetPartitioning, { type: 'timeWindow' }>,
  key: string
): PartitionValidationResult {
  if (!key) {
    return { ok: false, error: 'Partition key is required for this asset' };
  }

  let parseTarget = key;
  const format = partitioning.format ?? null;
  if (format === 'YYYY-MM-DD') {
    if (!DATE_ONLY_REGEX.test(key)) {
      return { ok: false, error: 'Partition key must match YYYY-MM-DD' };
    }
    parseTarget = `${key}T00:00:00Z`;
  } else if (format === 'YYYY-MM-DDTHH') {
    if (!DATE_HOUR_REGEX.test(key)) {
      return { ok: false, error: 'Partition key must match YYYY-MM-DDTHH' };
    }
    parseTarget = `${key}:00:00Z`;
  } else if (format === 'YYYY-MM-DDTHH:mm') {
    if (!DATE_MINUTE_REGEX.test(key)) {
      return { ok: false, error: 'Partition key must match YYYY-MM-DDTHH:mm' };
    }
    parseTarget = `${key}:00Z`;
  }

  const parsed = new Date(parseTarget);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: 'Partition key must be an ISO-8601 timestamp' };
  }

  return { ok: true, key };
}

function validateDynamicKey(key: string): PartitionValidationResult {
  if (!key) {
    return { ok: false, error: 'Partition key is required for this asset' };
  }
  return { ok: true, key };
}

export function validatePartitionKey(
  partitioning: WorkflowAssetPartitioning | null | undefined,
  rawKey: string | null | undefined
): PartitionValidationResult {
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!partitioning) {
    return { ok: true, key };
  }

  switch (partitioning.type) {
    case 'static':
      return validateStaticKey(partitioning, key);
    case 'timeWindow':
      return validateTimeWindowKey(partitioning, key);
    case 'dynamic':
    default:
      return validateDynamicKey(key);
  }
}

export function collectPartitionedAssetsFromSteps(
  steps: WorkflowStepDefinition[]
): Map<string, WorkflowAssetPartitioning> {
  const partitions = new Map<string, WorkflowAssetPartitioning>();

  const register = (produces: WorkflowStepDefinition['produces']) => {
    if (!Array.isArray(produces)) {
      return;
    }
    for (const declaration of produces) {
      if (!declaration?.assetId || !declaration.partitioning) {
        continue;
      }
      partitions.set(declaration.assetId.toLowerCase(), declaration.partitioning);
    }
  };

  for (const step of steps) {
    register(step.produces);
    if (step.type === 'fanout') {
      register(step.template.produces);
    }
  }

  return partitions;
}

export function deriveTimeWindowPartitionKey(
  partitioning: Extract<WorkflowAssetPartitioning, { type: 'timeWindow' }>,
  reference: Date
): string {
  const start = startOfIntervalUTC(reference, partitioning.granularity);
  return formatTimePartitionKey(partitioning, start);
}

export type { PartitionValidationResult };
