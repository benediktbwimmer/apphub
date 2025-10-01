import type {
  JsonValue,
  WorkflowAssetDeclaration,
  WorkflowAssetFreshness,
  WorkflowRunStepAssetInput,
  WorkflowRunStepAssetRecord,
  WorkflowStepDefinition
} from '../db/types';
import type { StepAssetRuntimeSummary } from './context';
import { isJsonObject } from './context';

export function normalizeAssetFreshness(value: unknown): WorkflowAssetFreshness | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const freshness: WorkflowAssetFreshness = {};

  const maxAge = record.maxAgeMs ?? record.max_age_ms;
  if (typeof maxAge === 'number' && Number.isFinite(maxAge) && maxAge > 0) {
    freshness.maxAgeMs = Math.floor(maxAge);
  }

  const ttl = record.ttlMs ?? record.ttl_ms;
  if (typeof ttl === 'number' && Number.isFinite(ttl) && ttl > 0) {
    freshness.ttlMs = Math.floor(ttl);
  }

  const cadence = record.cadenceMs ?? record.cadence_ms;
  if (typeof cadence === 'number' && Number.isFinite(cadence) && cadence > 0) {
    freshness.cadenceMs = Math.floor(cadence);
  }

  return Object.keys(freshness).length > 0 ? freshness : null;
}

export function toRuntimeAssetSummaries(
  records: WorkflowRunStepAssetRecord[] | undefined
): StepAssetRuntimeSummary[] | undefined {
  if (!records || records.length === 0) {
    return undefined;
  }
  return records.map((record) => ({
    assetId: record.assetId,
    producedAt: record.producedAt ?? null,
    partitionKey: record.partitionKey ?? null,
    payload: (record.payload ?? null) as JsonValue | null,
    schema: (record.schema ?? null) as JsonValue | null,
    freshness: record.freshness ?? null
  }));
}

export function parseRuntimeAssets(
  value: JsonValue | null | undefined
): StepAssetRuntimeSummary[] | undefined {
  if (!value) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    return undefined;
  }

  const summaries: StepAssetRuntimeSummary[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, JsonValue>;
    const assetId = typeof record.assetId === 'string' ? record.assetId.trim() : '';
    if (!assetId) {
      continue;
    }
    const producedAtRaw = record.producedAt ?? record.produced_at;
    let producedAt: string | null = null;
    if (typeof producedAtRaw === 'string' && producedAtRaw.trim().length > 0) {
      const parsed = new Date(producedAtRaw);
      producedAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    const partitionRaw = record.partitionKey ?? record.partition_key;
    const partitionKey =
      typeof partitionRaw === 'string' && partitionRaw.trim().length > 0
        ? partitionRaw.trim()
        : null;

    const schemaValue = record.schema ?? record.assetSchema ?? record.asset_schema;
    const schema =
      schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)
        ? (schemaValue as JsonValue)
        : null;

    const freshnessValue = record.freshness ?? record.assetFreshness ?? record.asset_freshness;
    const freshness = normalizeAssetFreshness(freshnessValue);

    const payloadValue = record.payload ?? null;
    const payload = (payloadValue ?? null) as JsonValue | null;

    summaries.push({
      assetId,
      producedAt,
      partitionKey,
      payload,
      schema,
      freshness
    });
  }

  return summaries.length > 0 ? summaries : undefined;
}

type ExtractAssetOptions = {
  defaultPartitionKey?: string | null;
};

export function extractProducedAssetsFromResult(
  step: WorkflowStepDefinition,
  result: JsonValue | null,
  options: ExtractAssetOptions = {}
): WorkflowRunStepAssetInput[] {
  if (!result || !Array.isArray(step.produces) || step.produces.length === 0) {
    return [];
  }

  const declarations = new Map<string, WorkflowAssetDeclaration>();
  for (const declaration of step.produces) {
    if (!declaration || typeof declaration.assetId !== 'string') {
      continue;
    }
    const normalized = declaration.assetId.trim();
    if (!normalized) {
      continue;
    }
    declarations.set(normalized.toLowerCase(), declaration);
  }

  if (declarations.size === 0) {
    return [];
  }

  const outputs = new Map<string, WorkflowRunStepAssetInput>();
  const defaultPartitionKey =
    typeof options.defaultPartitionKey === 'string' && options.defaultPartitionKey.trim().length > 0
      ? options.defaultPartitionKey.trim()
      : null;

  const applyAsset = (rawAssetId: string, value: unknown) => {
    const normalizedKey = rawAssetId.trim().toLowerCase();
    if (!normalizedKey) {
      return;
    }
    const declaration = declarations.get(normalizedKey);
    if (!declaration) {
      return;
    }

    const assetId = declaration.assetId;
    const input: WorkflowRunStepAssetInput = {
      assetId
    };

    let partitionKey: string | null = null;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;

      if (Object.prototype.hasOwnProperty.call(record, 'payload')) {
        const payloadValue = record.payload as JsonValue | null | undefined;
        input.payload = (payloadValue ?? null) as JsonValue | null;
      } else {
        const clone = { ...record };
        delete clone.assetId;
        delete clone.asset_id;
        delete clone.schema;
        delete clone.assetSchema;
        delete clone.asset_schema;
        delete clone.freshness;
        delete clone.assetFreshness;
        delete clone.asset_freshness;
        delete clone.producedAt;
        delete clone.produced_at;
        delete clone.partitionKey;
        delete clone.partition_key;
        if (Object.keys(clone).length > 0) {
          input.payload = clone as unknown as JsonValue;
        }
      }

      const schemaValue = record.schema ?? record.assetSchema ?? record.asset_schema;
      if (schemaValue && typeof schemaValue === 'object' && !Array.isArray(schemaValue)) {
        input.schema = schemaValue as JsonValue;
      }

      const freshnessValue = record.freshness ?? record.assetFreshness ?? record.asset_freshness;
      const freshness = normalizeAssetFreshness(freshnessValue);
      if (freshness) {
        input.freshness = freshness;
      }

      const producedAtValue = record.producedAt ?? record.produced_at;
      if (typeof producedAtValue === 'string' && producedAtValue.trim().length > 0) {
        const parsed = new Date(producedAtValue);
        if (!Number.isNaN(parsed.getTime())) {
          input.producedAt = parsed.toISOString();
        }
      }

      const partitionValue = record.partitionKey ?? record.partition_key;
      if (typeof partitionValue === 'string' && partitionValue.trim().length > 0) {
        partitionKey = partitionValue.trim();
      }
    } else if (value !== undefined) {
      input.payload = (value ?? null) as JsonValue | null;
    }

    if (!input.schema && declaration.schema) {
      input.schema = declaration.schema;
    }
    if (!input.freshness && declaration.freshness) {
      input.freshness = declaration.freshness;
    }

    if (declaration.partitioning) {
      if (!partitionKey && defaultPartitionKey) {
        partitionKey = defaultPartitionKey;
      }
      if (!partitionKey) {
        throw new Error(`Partition key required for asset ${assetId}`);
      }
      input.partitionKey = partitionKey;
    } else if (partitionKey) {
      input.partitionKey = partitionKey;
    }

    const dedupeKey = `${normalizedKey}::${input.partitionKey ?? ''}`;
    outputs.set(dedupeKey, {
      assetId,
      payload: input.payload ?? null,
      schema: input.schema ?? null,
      freshness: input.freshness ?? null,
      partitionKey: input.partitionKey ?? null,
      producedAt: input.producedAt ?? null
    });
  };

  const container = isJsonObject(result) && 'assets' in result ? (result.assets as JsonValue) : result;

  if (Array.isArray(container)) {
    for (const entry of container) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const assetId = typeof record.assetId === 'string' ? record.assetId : typeof record.asset_id === 'string' ? record.asset_id : '';
      if (!assetId) {
        continue;
      }
      applyAsset(assetId, record);
    }
  } else if (isJsonObject(container)) {
    const record = container as Record<string, unknown>;
    const directAssetId =
      typeof record.assetId === 'string'
        ? record.assetId
        : typeof record.asset_id === 'string'
          ? record.asset_id
          : '';
    if (directAssetId) {
      applyAsset(directAssetId, record);
    } else {
      for (const [key, value] of Object.entries(record)) {
        if (typeof value === 'object' && value && !Array.isArray(value)) {
          applyAsset(key, value as Record<string, unknown>);
        }
      }
    }
  }

  return Array.from(outputs.values()).map((output) => {
    const declaration = declarations.get(output.assetId.toLowerCase());
    const next: WorkflowRunStepAssetInput = { ...output };
    if (!next.schema && declaration?.schema) {
      next.schema = declaration.schema;
    }
    if (!next.freshness && declaration?.freshness) {
      next.freshness = declaration.freshness;
    }
    return next;
  });
}
