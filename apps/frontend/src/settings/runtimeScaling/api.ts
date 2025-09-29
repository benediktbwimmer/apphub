import { ensureOk, parseJson, type AuthorizedFetch } from '../../workflows/api';
import {
  type RuntimeScalingAcknowledgement,
  type RuntimeScalingOverview,
  type RuntimeScalingQueueSnapshot,
  type RuntimeScalingTarget,
  type RuntimeScalingUpdateInput
} from './types';

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function normalizeQueueSnapshot(raw: unknown): RuntimeScalingQueueSnapshot {
  const record = toRecord(raw);
  if (!record) {
    return {
      name: 'unknown',
      mode: 'queue',
      counts: {},
      metrics: null,
      error: null
    } satisfies RuntimeScalingQueueSnapshot;
  }

  const name = typeof record.name === 'string' && record.name.trim().length > 0 ? record.name : 'unknown';
  const mode = record.mode === 'inline' ? 'inline' : 'queue';

  const countsSource = toRecord(record.counts);
  const counts: Record<string, number> = {};
  if (countsSource) {
    for (const [key, value] of Object.entries(countsSource)) {
      const parsed = toNumber(value, Number.NaN);
      if (Number.isFinite(parsed)) {
        counts[key] = parsed;
      }
    }
  }

  const metricsRecord = toRecord(record.metrics);
  const metrics = metricsRecord
    ? {
        processingAvgMs: Number.isFinite(Number(metricsRecord.processingAvgMs))
          ? Number(metricsRecord.processingAvgMs)
          : null,
        waitingAvgMs: Number.isFinite(Number(metricsRecord.waitingAvgMs))
          ? Number(metricsRecord.waitingAvgMs)
          : null
      }
    : null;

  return {
    name,
    mode,
    counts,
    metrics,
    error: toStringOrNull(record.error)
  } satisfies RuntimeScalingQueueSnapshot;
}

function normalizeAcknowledgements(raw: unknown): RuntimeScalingAcknowledgement[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.flatMap((entry) => {
    const record = toRecord(entry);
    if (!record) {
      return [];
    }
    const instanceId = toStringOrNull(record.instanceId);
    if (!instanceId) {
      return [];
    }
    const appliedConcurrency = toNumber(record.appliedConcurrency, 0);
    const status = record.status === 'pending' || record.status === 'error' ? record.status : 'ok';
    const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString();
    return [
      {
        instanceId,
        appliedConcurrency,
        status,
        error: toStringOrNull(record.error),
        updatedAt
      } satisfies RuntimeScalingAcknowledgement
    ];
  });
}

function normalizeRuntimeScalingTarget(raw: unknown): RuntimeScalingTarget {
  const record = toRecord(raw);
  if (!record) {
    throw new Error('Runtime scaling payload missing target data');
  }

  const target = toStringOrNull(record.target);
  if (!target) {
    throw new Error('Runtime scaling payload missing target identifier');
  }

  const desiredConcurrency = Math.max(0, toNumber(record.desiredConcurrency, 0));
  const effectiveConcurrency = Math.max(0, toNumber(record.effectiveConcurrency, desiredConcurrency));
  const defaultConcurrency = Math.max(0, toNumber(record.defaultConcurrency, effectiveConcurrency));
  const minConcurrency = Math.max(0, toNumber(record.minConcurrency, 0));
  const maxConcurrency = Math.max(minConcurrency, toNumber(record.maxConcurrency, defaultConcurrency));
  const rateLimitMs = Math.max(0, toNumber(record.rateLimitMs, 0));

  return {
    target,
    displayName: toStringOrNull(record.displayName) ?? target,
    description: toStringOrNull(record.description) ?? '',
    desiredConcurrency,
    effectiveConcurrency,
    defaultConcurrency,
    minConcurrency,
    maxConcurrency,
    rateLimitMs,
    defaultEnvVar: toStringOrNull(record.defaultEnvVar) ?? '',
    source: record.source === 'policy' ? 'policy' : 'default',
    reason: toStringOrNull(record.reason),
    updatedAt: toStringOrNull(record.updatedAt),
    updatedBy: toStringOrNull(record.updatedBy),
    updatedByKind: record.updatedByKind === 'user' || record.updatedByKind === 'service' ? record.updatedByKind : null,
    policyMetadata: record.policyMetadata ?? null,
    queue: normalizeQueueSnapshot(record.queue),
    acknowledgements: normalizeAcknowledgements(record.acknowledgements)
  } satisfies RuntimeScalingTarget;
}

export async function fetchRuntimeScalingOverview(
  fetcher: AuthorizedFetch
): Promise<RuntimeScalingOverview> {
  const response = await fetcher('/admin/runtime-scaling');
  await ensureOk(response, 'Failed to load runtime scaling settings');
  const payload = await parseJson<{ data?: unknown }>(response);
  const data = toRecord(payload?.data) ?? {};
  const targetsRaw = Array.isArray(data.targets) ? data.targets : [];
  const targets = targetsRaw.map((entry) => normalizeRuntimeScalingTarget(entry));
  const writesEnabled = Boolean(data.writesEnabled);
  return { targets, writesEnabled } satisfies RuntimeScalingOverview;
}

export async function updateRuntimeScalingTarget(
  fetcher: AuthorizedFetch,
  target: string,
  input: RuntimeScalingUpdateInput
): Promise<{ target: RuntimeScalingTarget; writesEnabled: boolean }> {
  const response = await fetcher(`/admin/runtime-scaling/${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      desiredConcurrency: Number.isFinite(input.desiredConcurrency) ? input.desiredConcurrency : Number(input.desiredConcurrency),
      reason: input.reason
    })
  });
  await ensureOk(response, 'Failed to update runtime scaling settings');
  const payload = await parseJson<{ data?: unknown; writesEnabled?: unknown }>(response);
  const normalizedTarget = normalizeRuntimeScalingTarget(payload?.data);
  const writesEnabled = typeof payload?.writesEnabled === 'boolean' ? payload.writesEnabled : true;
  return { target: normalizedTarget, writesEnabled };
}
