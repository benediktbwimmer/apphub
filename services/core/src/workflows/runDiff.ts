import type {
  JsonValue,
  WorkflowExecutionHistoryRecord,
  WorkflowRunStepAssetRecord,
  WorkflowAssetStalePartitionRecord
} from '../db/types';

export type JsonDiffChange = 'added' | 'removed' | 'changed';

type JsonPathSegment = string | number;

export type JsonDiffEntry = {
  path: string;
  change: JsonDiffChange;
  before: JsonValue | null;
  after: JsonValue | null;
};

export type StatusDiffChange = 'identical' | 'baseOnly' | 'compareOnly' | 'changed';

export type StatusDiffEntry = {
  index: number;
  change: StatusDiffChange;
  base: WorkflowExecutionHistoryRecord | null;
  compare: WorkflowExecutionHistoryRecord | null;
};

export type AssetDiffChange = 'baseOnly' | 'compareOnly' | 'changed';

type AssetDescriptor = {
  assetId: string;
  partitionKey: string | null;
  stepId: string;
  producedAt: string | null;
  payload: JsonValue | null;
  freshness: JsonValue | null;
};

export type AssetDiffEntry = {
  change: AssetDiffChange;
  assetId: string;
  partitionKey: string | null;
  base: AssetDescriptor | null;
  compare: AssetDescriptor | null;
};

export type StaleAssetWarning = {
  assetId: string;
  partitionKey: string | null;
  stepId: string;
  requestedAt: string;
  requestedBy: string | null;
  note: string | null;
};

function toJsonPath(path: JsonPathSegment[]): string {
  if (path.length === 0) {
    return '$';
  }
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') {
        return `[${segment}]`;
      }
      return index === 0 ? segment : `.${segment}`;
    })
    .join('');
}

function isJsonObject(value: JsonValue | null | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqualJson(a: JsonValue | null | undefined, b: JsonValue | null | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (a === null || b === null) {
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqualJson(a[i] ?? null, b[i] ?? null)) {
        return false;
      }
    }
    return true;
  }
  if (isJsonObject(a) && isJsonObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (!deepEqualJson(a[key] ?? null, b[key] ?? null)) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function diffJsonInternal(
  before: JsonValue | null | undefined,
  after: JsonValue | null | undefined,
  path: JsonPathSegment[],
  result: JsonDiffEntry[]
): void {
  if (deepEqualJson(before ?? null, after ?? null)) {
    return;
  }

  const beforeIsArray = Array.isArray(before);
  const afterIsArray = Array.isArray(after);

  if (beforeIsArray && afterIsArray) {
    const maxLength = Math.max(before.length, after.length);
    for (let index = 0; index < maxLength; index += 1) {
      const beforeValue = before[index];
      const afterValue = after[index];
      if (beforeValue === undefined || afterValue === undefined) {
        result.push({
          path: toJsonPath([...path, index]),
          change: beforeValue === undefined ? 'added' : 'removed',
          before: (beforeValue as JsonValue | null | undefined) ?? null,
          after: (afterValue as JsonValue | null | undefined) ?? null
        });
      } else {
        diffJsonInternal(beforeValue, afterValue, [...path, index], result);
      }
    }
    return;
  }

  if (beforeIsArray !== afterIsArray) {
    result.push({
      path: toJsonPath(path),
      change: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
      before: (before as JsonValue | null | undefined) ?? null,
      after: (after as JsonValue | null | undefined) ?? null
    });
    return;
  }

  if (isJsonObject(before) && isJsonObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const beforeValue = before[key];
      const afterValue = after[key];
      if (beforeValue === undefined || afterValue === undefined) {
        if (!deepEqualJson(beforeValue ?? null, afterValue ?? null)) {
          result.push({
            path: toJsonPath([...path, key]),
            change: beforeValue === undefined ? 'added' : 'removed',
            before: (beforeValue as JsonValue | null | undefined) ?? null,
            after: (afterValue as JsonValue | null | undefined) ?? null
          });
        }
      } else {
        diffJsonInternal(beforeValue, afterValue, [...path, key], result);
      }
    }
    return;
  }

  result.push({
    path: toJsonPath(path),
    change: before === undefined ? 'added' : after === undefined ? 'removed' : 'changed',
    before: (before as JsonValue | null | undefined) ?? null,
    after: (after as JsonValue | null | undefined) ?? null
  });
}

export function diffJson(before: JsonValue | null | undefined, after: JsonValue | null | undefined): JsonDiffEntry[] {
  const result: JsonDiffEntry[] = [];
  diffJsonInternal(before, after, [], result);
  return result;
}

function historyEntriesEqual(
  base: WorkflowExecutionHistoryRecord,
  compare: WorkflowExecutionHistoryRecord
): boolean {
  if (base.eventType !== compare.eventType) {
    return false;
  }
  if (base.stepId !== compare.stepId) {
    return false;
  }
  if (base.workflowRunStepId !== compare.workflowRunStepId) {
    return false;
  }
  return deepEqualJson(base.eventPayload, compare.eventPayload);
}

export function diffStatusTransitions(
  base: WorkflowExecutionHistoryRecord[],
  compare: WorkflowExecutionHistoryRecord[]
): StatusDiffEntry[] {
  const max = Math.max(base.length, compare.length);
  const result: StatusDiffEntry[] = [];

  for (let index = 0; index < max; index += 1) {
    const baseEntry = base[index] ?? null;
    const compareEntry = compare[index] ?? null;
    if (!baseEntry && !compareEntry) {
      continue;
    }
    let change: StatusDiffChange = 'identical';
    if (baseEntry && compareEntry) {
      change = historyEntriesEqual(baseEntry, compareEntry) ? 'identical' : 'changed';
    } else if (baseEntry && !compareEntry) {
      change = 'baseOnly';
    } else if (!baseEntry && compareEntry) {
      change = 'compareOnly';
    }

    result.push({
      index,
      change,
      base: baseEntry,
      compare: compareEntry
    });
  }

  return result;
}

function toAssetDescriptor(record: WorkflowRunStepAssetRecord): AssetDescriptor {
  return {
    assetId: record.assetId,
    partitionKey: record.partitionKey ?? null,
    stepId: record.stepId,
    producedAt: record.producedAt ?? null,
    payload: record.payload ?? null,
    freshness: record.freshness ?? null
  } satisfies AssetDescriptor;
}

function normalizePartitionKey(partitionKey: string | null | undefined): string {
  if (typeof partitionKey === 'string') {
    const trimmed = partitionKey.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return '';
}

function assetKey(record: WorkflowRunStepAssetRecord): string {
  return `${record.assetId}::${normalizePartitionKey(record.partitionKey)}`;
}

export function diffProducedAssets(
  baseAssets: WorkflowRunStepAssetRecord[],
  compareAssets: WorkflowRunStepAssetRecord[]
): AssetDiffEntry[] {
  const baseMap = new Map<string, WorkflowRunStepAssetRecord>();
  for (const asset of baseAssets) {
    const key = assetKey(asset);
    const existing = baseMap.get(key);
    if (!existing || (asset.producedAt ?? '') > (existing.producedAt ?? '')) {
      baseMap.set(key, asset);
    }
  }

  const compareMap = new Map<string, WorkflowRunStepAssetRecord>();
  for (const asset of compareAssets) {
    const key = assetKey(asset);
    const existing = compareMap.get(key);
    if (!existing || (asset.producedAt ?? '') > (existing.producedAt ?? '')) {
      compareMap.set(key, asset);
    }
  }

  const keys = new Set<string>([...baseMap.keys(), ...compareMap.keys()]);
  const result: AssetDiffEntry[] = [];
  for (const key of keys) {
    const baseRecord = baseMap.get(key) ?? null;
    const compareRecord = compareMap.get(key) ?? null;
    if (baseRecord && compareRecord) {
      const equalPayload = deepEqualJson(baseRecord.payload ?? null, compareRecord.payload ?? null);
      const equalFreshness = deepEqualJson(baseRecord.freshness ?? null, compareRecord.freshness ?? null);
      if (equalPayload && equalFreshness) {
        continue;
      }
      result.push({
        change: 'changed',
        assetId: baseRecord.assetId,
        partitionKey: baseRecord.partitionKey ?? null,
        base: toAssetDescriptor(baseRecord),
        compare: toAssetDescriptor(compareRecord)
      });
      continue;
    }
    if (baseRecord) {
      result.push({
        change: 'baseOnly',
        assetId: baseRecord.assetId,
        partitionKey: baseRecord.partitionKey ?? null,
        base: toAssetDescriptor(baseRecord),
        compare: null
      });
      continue;
    }
    if (compareRecord) {
      result.push({
        change: 'compareOnly',
        assetId: compareRecord.assetId,
        partitionKey: compareRecord.partitionKey ?? null,
        base: null,
        compare: toAssetDescriptor(compareRecord)
      });
    }
  }

  return result;
}

export function computeStaleAssetWarnings(
  runAssets: WorkflowRunStepAssetRecord[],
  stalePartitions: WorkflowAssetStalePartitionRecord[]
): StaleAssetWarning[] {
  if (runAssets.length === 0 || stalePartitions.length === 0) {
    return [];
  }

  const staleByKey = new Map<string, WorkflowAssetStalePartitionRecord>();
  for (const record of stalePartitions) {
    const normalized = record.partitionKeyNormalized ?? normalizePartitionKey(record.partitionKey);
    staleByKey.set(`${record.assetId}::${normalized}`, record);
  }

  const warnings: StaleAssetWarning[] = [];
  const seenKeys = new Set<string>();
  for (const asset of runAssets) {
    const key = assetKey(asset);
    if (seenKeys.has(key)) {
      continue;
    }
    const staleRecord = staleByKey.get(key);
    if (!staleRecord) {
      continue;
    }
    seenKeys.add(key);
    warnings.push({
      assetId: asset.assetId,
      partitionKey: asset.partitionKey ?? null,
      stepId: asset.stepId,
      requestedAt: staleRecord.requestedAt,
      requestedBy: staleRecord.requestedBy ?? null,
      note: staleRecord.note ?? null
    });
  }

  return warnings;
}
