import type { ServiceConfig, StagingFlushConfig } from '../config/serviceConfig';
import type { DatasetRecord } from '../db/metadata';
import {
  DuckDbSpoolManager,
  type DatasetStagingSummary,
  type PreparedFlushResult
} from '../storage/spoolManager';

export interface FlushPreparation {
  summary: DatasetStagingSummary;
  thresholds: StagingFlushConfig;
  result: PreparedFlushResult;
}

export function resolveFlushThresholds(
  config: ServiceConfig,
  dataset: DatasetRecord | null
): StagingFlushConfig {
  const global = config.staging.flush;
  const overrides = extractDatasetOverrides(dataset);
  return {
    maxRows: normalizeThreshold(overrides?.maxRows, global.maxRows),
    maxBytes: normalizeThreshold(overrides?.maxBytes, global.maxBytes),
    maxAgeMs: normalizeThreshold(overrides?.maxAgeMs, global.maxAgeMs)
  } satisfies StagingFlushConfig;
}

export function shouldTriggerFlush(
  summary: DatasetStagingSummary,
  thresholds: StagingFlushConfig,
  nowMs = Date.now()
): boolean {
  if (summary.pendingBatchCount === 0) {
    return false;
  }

  if (thresholds.maxRows > 0 && summary.pendingRowCount >= thresholds.maxRows) {
    return true;
  }

  if (thresholds.maxBytes > 0 && summary.onDiskBytes >= thresholds.maxBytes) {
    return true;
  }

  if (thresholds.maxAgeMs > 0 && summary.oldestStagedAt) {
    const oldest = new Date(summary.oldestStagedAt).getTime();
    if (Number.isFinite(oldest) && nowMs - oldest >= thresholds.maxAgeMs) {
      return true;
    }
  }

  if (thresholds.maxRows === 0 && thresholds.maxBytes === 0 && thresholds.maxAgeMs === 0) {
    // All thresholds disabled; fall back to eager flush when anything is staged
    return true;
  }

  return false;
}

export async function maybePrepareDatasetFlush(
  spoolManager: DuckDbSpoolManager,
  datasetSlug: string,
  thresholds: StagingFlushConfig,
  nowMs = Date.now()
): Promise<FlushPreparation | null> {
  const summary = await spoolManager.getDatasetSummary(datasetSlug);
  if (!shouldTriggerFlush(summary, thresholds, nowMs)) {
    return null;
  }
  const prepared = await spoolManager.prepareFlush(datasetSlug);
  if (!prepared) {
    return null;
  }
  return {
    summary,
    thresholds,
    result: prepared
  } satisfies FlushPreparation;
}

function extractDatasetOverrides(dataset: DatasetRecord | null): Partial<StagingFlushConfig> | null {
  if (!dataset || !dataset.metadata || typeof dataset.metadata !== 'object') {
    return null;
  }
  const staging = (dataset.metadata as Record<string, unknown>).staging;
  if (!staging || typeof staging !== 'object') {
    return null;
  }
  const flush = (staging as Record<string, unknown>).flush;
  if (!flush || typeof flush !== 'object') {
    return null;
  }
  const overrides: Partial<StagingFlushConfig> = {};
  if (isFiniteNumber((flush as Record<string, unknown>).maxRows)) {
    overrides.maxRows = Math.max(0, Math.floor(Number((flush as Record<string, unknown>).maxRows)));
  }
  if (isFiniteNumber((flush as Record<string, unknown>).maxBytes)) {
    overrides.maxBytes = Math.max(0, Math.floor(Number((flush as Record<string, unknown>).maxBytes)));
  }
  if (isFiniteNumber((flush as Record<string, unknown>).maxAgeMs)) {
    overrides.maxAgeMs = Math.max(0, Math.floor(Number((flush as Record<string, unknown>).maxAgeMs)));
  }
  return Object.keys(overrides).length > 0 ? overrides : null;
}

function normalizeThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback >= 0 ? fallback : 0;
  }
  return value >= 0 ? value : 0;
}

function isFiniteNumber(input: unknown): input is number {
  if (typeof input === 'number') {
    return Number.isFinite(input);
  }
  if (typeof input === 'string' && input.trim().length > 0) {
    const parsed = Number(input);
    return Number.isFinite(parsed);
  }
  return false;
}
