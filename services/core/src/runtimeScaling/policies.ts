import {
  getRuntimeScalingPolicy,
  listRuntimeScalingPolicies,
  upsertRuntimeScalingPolicy,
  type RuntimeScalingPolicyRecord,
  type RuntimeScalingPolicyUpsertInput
} from '../db/runtimeScaling';
import type { JsonValue } from '../db/types';
import {
  clampConcurrency,
  getRuntimeScalingTarget,
  listRuntimeScalingTargets,
  type RuntimeScalingTargetConfig,
  type RuntimeScalingTargetKey
} from './targets';

export type RuntimeScalingSnapshot = {
  target: RuntimeScalingTargetKey;
  queueKey: RuntimeScalingTargetConfig['queueKey'];
  queueName: string;
  displayName: string;
  description: string;
  desiredConcurrency: number;
  effectiveConcurrency: number;
  defaultConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  rateLimitMs: number;
  source: 'policy' | 'default';
  reason: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  updatedByKind: 'user' | 'service' | null;
  policy: RuntimeScalingPolicyRecord | null;
};

export type RuntimeScalingUpdateInput = {
  target: RuntimeScalingTargetKey;
  desiredConcurrency: number;
  reason?: string | null;
  actor?: {
    subject: string | null;
    kind: 'user' | 'service' | null;
    tokenHash?: string | null;
  };
  metadata?: Record<string, JsonValue>;
};

export type RuntimeScalingUpdateResult = {
  snapshot: RuntimeScalingSnapshot;
  previousPolicy: RuntimeScalingPolicyRecord | null;
};

export class RuntimeScalingRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'RuntimeScalingRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

export class RuntimeScalingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeScalingValidationError';
  }
}

export function isRuntimeScalingWriteEnabled(): boolean {
  const raw = process.env.APPHUB_RUNTIME_SCALING_WRITES_ENABLED;
  if (raw === undefined) {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function buildPolicyMetadata(
  config: RuntimeScalingTargetConfig,
  desiredConcurrency: number,
  effectiveConcurrency: number,
  extra: Record<string, JsonValue> | undefined
): JsonValue {
  const base: Record<string, JsonValue> = {
    requestedConcurrency: desiredConcurrency,
    effectiveConcurrency,
    defaultConcurrency: config.defaultConcurrency,
    minConcurrency: config.minConcurrency,
    maxConcurrency: config.maxConcurrency,
    rateLimitMs: config.rateLimitMs
  };
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      base[key] = value;
    }
  }
  return base as JsonValue;
}

function normalizeReason(reason: string | null | undefined): string | null {
  if (reason === null || reason === undefined) {
    return null;
  }
  const trimmed = reason.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 500);
}

function toSnapshot(config: RuntimeScalingTargetConfig, policy: RuntimeScalingPolicyRecord | null): RuntimeScalingSnapshot {
  const desired = policy ? policy.desiredConcurrency : config.defaultConcurrency;
  const effective = clampConcurrency(config, desired);
  return {
    target: config.key,
    queueKey: config.queueKey,
    queueName: config.queueName,
    displayName: config.displayName,
    description: config.description,
    desiredConcurrency: desired,
    effectiveConcurrency: effective,
    defaultConcurrency: config.defaultConcurrency,
    minConcurrency: config.minConcurrency,
    maxConcurrency: config.maxConcurrency,
    rateLimitMs: config.rateLimitMs,
    source: policy ? 'policy' : 'default',
    reason: policy?.reason ?? null,
    updatedAt: policy?.updatedAt ?? null,
    updatedBy: policy?.updatedBy ?? null,
    updatedByKind: policy?.updatedByKind ?? null,
    policy
  } satisfies RuntimeScalingSnapshot;
}

export async function resolveRuntimeScalingSnapshot(
  target: RuntimeScalingTargetKey
): Promise<RuntimeScalingSnapshot> {
  const config = getRuntimeScalingTarget(target);
  const policy = await getRuntimeScalingPolicy(target);
  return toSnapshot(config, policy);
}

export async function resolveAllRuntimeScalingSnapshots(): Promise<RuntimeScalingSnapshot[]> {
  const configs = listRuntimeScalingTargets();
  const policies = await listRuntimeScalingPolicies();
  const policyMap = new Map<RuntimeScalingTargetKey, RuntimeScalingPolicyRecord>();
  for (const policy of policies) {
    policyMap.set(policy.target as RuntimeScalingTargetKey, policy);
  }
  return configs.map((config) => toSnapshot(config, policyMap.get(config.key) ?? null));
}

export async function updateRuntimeScalingPolicy(
  input: RuntimeScalingUpdateInput
): Promise<RuntimeScalingUpdateResult> {
  const config = getRuntimeScalingTarget(input.target);
  const desiredNormalized = Math.floor(input.desiredConcurrency);
  if (!Number.isFinite(desiredNormalized)) {
    throw new RuntimeScalingValidationError('Desired concurrency must be a finite number');
  }

  const desired = clampConcurrency(config, desiredNormalized);
  const reason = normalizeReason(input.reason ?? null);

  const existing = await getRuntimeScalingPolicy(config.key);

  if (existing) {
    const lastUpdated = Date.parse(existing.updatedAt);
    if (Number.isFinite(lastUpdated)) {
      const ageMs = Date.now() - lastUpdated;
      if (ageMs < config.rateLimitMs && existing.desiredConcurrency !== desired) {
        throw new RuntimeScalingRateLimitError(
          `Scaling updates for ${config.displayName} are rate limited. Try again in ${Math.max(
            0,
            config.rateLimitMs - ageMs
          )}ms.`,
          Math.max(0, config.rateLimitMs - ageMs)
        );
      }
    }

    if (existing.desiredConcurrency === desired && (existing.reason ?? null) === reason) {
      return {
        snapshot: toSnapshot(config, existing),
        previousPolicy: existing
      } satisfies RuntimeScalingUpdateResult;
    }
  }

  const effective = clampConcurrency(config, desired);

  const upsertInput: RuntimeScalingPolicyUpsertInput = {
    target: config.key,
    desiredConcurrency: desired,
    reason,
    updatedBy: input.actor?.subject ?? null,
    updatedByKind: input.actor?.kind ?? null,
    updatedByTokenHash: input.actor?.tokenHash ?? null,
    metadata: buildPolicyMetadata(config, desired, effective, input.metadata)
  };

  const policy = await upsertRuntimeScalingPolicy(upsertInput);

  return {
    snapshot: toSnapshot(config, policy),
    previousPolicy: existing ?? null
  } satisfies RuntimeScalingUpdateResult;
}
