import { coreRequest, CoreApiError } from '../../core/api';
import { ApiError, createApiClient, type AuthorizedFetch } from '../../lib/apiClient';
import { API_BASE_URL } from '../../config';
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

type Token = string | null | undefined;
type TokenInput = Token | AuthorizedFetch;

type CoreJsonOptions = {
  method?: string;
  url: string;
  body?: unknown;
  errorMessage: string;
};

function ensureToken(input: TokenInput): string {
  if (typeof input === 'function') {
    const fetcher = input as AuthorizedFetch & { authToken?: string | null | undefined };
    const candidate = fetcher.authToken;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
    if (typeof candidate === 'string') {
      return candidate;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  throw new Error('Authentication required for runtime scaling requests.');
}

function toApiError(error: CoreApiError, fallback: string): ApiError {
  const message = error.message && error.message.trim().length > 0 ? error.message : fallback;
  return new ApiError(message, error.status ?? 500, error.details ?? null);
}

async function coreJson<T>(token: TokenInput, options: CoreJsonOptions): Promise<T> {
  if (typeof token === 'function') {
    const client = createApiClient(token, { baseUrl: API_BASE_URL });
    const bodyIsFormData = options.body instanceof FormData;
    const result = await client.request(options.url, {
      method: options.method,
      body: bodyIsFormData ? (options.body as FormData) : undefined,
      json: !bodyIsFormData ? options.body : undefined,
      errorMessage: options.errorMessage
    });
    return result as T;
  }

  try {
    return (await coreRequest<T>(ensureToken(token), {
      method: options.method,
      url: options.url,
      body: options.body
    })) as T;
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw toApiError(error, options.errorMessage);
    }
    throw error;
  }
}

export async function fetchRuntimeScalingOverview(
  token: TokenInput
): Promise<RuntimeScalingOverview> {
  const payload = await coreJson<{ data?: unknown }>(token, {
    url: '/admin/runtime-scaling',
    errorMessage: 'Failed to load runtime scaling settings'
  });
  const data = toRecord(payload?.data) ?? {};
  const targetsRaw = Array.isArray(data.targets) ? data.targets : [];
  const targets = targetsRaw.map((entry) => normalizeRuntimeScalingTarget(entry));
  const writesEnabled = Boolean(data.writesEnabled);
  return { targets, writesEnabled } satisfies RuntimeScalingOverview;
}

export async function updateRuntimeScalingTarget(
  token: TokenInput,
  target: string,
  input: RuntimeScalingUpdateInput
): Promise<{ target: RuntimeScalingTarget; writesEnabled: boolean }> {
  const payload = await coreJson<{ data?: unknown; writesEnabled?: unknown }>(token, {
    method: 'POST',
    url: `/admin/runtime-scaling/${encodeURIComponent(target)}`,
    body: {
      desiredConcurrency: Number.isFinite(input.desiredConcurrency)
        ? input.desiredConcurrency
        : Number(input.desiredConcurrency),
      reason: input.reason
    },
    errorMessage: 'Failed to update runtime scaling settings'
  });
  const normalizedTarget = normalizeRuntimeScalingTarget(payload?.data);
  const writesEnabled = typeof payload?.writesEnabled === 'boolean' ? payload.writesEnabled : true;
  return { target: normalizedTarget, writesEnabled };
}
