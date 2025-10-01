import type { PoolClient } from 'pg';
import { withConnection } from './client';
import {
  type RuntimeScalingPolicyRecord,
  type RuntimeScalingPolicyUpsertInput,
  type RuntimeScalingAcknowledgementRecord,
  type RuntimeScalingAcknowledgementInput
} from './types';

export type {
  RuntimeScalingPolicyRecord,
  RuntimeScalingPolicyUpsertInput,
  RuntimeScalingAcknowledgementRecord,
  RuntimeScalingAcknowledgementInput
} from './types';

type RuntimeScalingPolicyRow = {
  target: string;
  desired_concurrency: number;
  reason: string | null;
  updated_by: string | null;
  updated_by_kind: string | null;
  updated_by_token_hash: string | null;
  metadata: unknown;
  created_at: string;
  updated_at: string;
};

type RuntimeScalingAcknowledgementRow = {
  target: string;
  instance_id: string;
  applied_concurrency: number;
  status: string;
  error: string | null;
  updated_at: string;
};

type AckStatus = 'ok' | 'pending' | 'error';

const ACK_STATUS_VALUES: ReadonlySet<AckStatus> = new Set<AckStatus>(['ok', 'pending', 'error']);

function mapPolicyRow(row: RuntimeScalingPolicyRow): RuntimeScalingPolicyRecord {
  return {
    target: row.target,
    desiredConcurrency: row.desired_concurrency,
    reason: row.reason,
    updatedBy: row.updated_by,
    updatedByKind: normalizeActorKind(row.updated_by_kind),
    updatedByTokenHash: row.updated_by_token_hash,
    metadata: (row.metadata as RuntimeScalingPolicyRecord['metadata']) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  } satisfies RuntimeScalingPolicyRecord;
}

function mapAcknowledgementRow(row: RuntimeScalingAcknowledgementRow): RuntimeScalingAcknowledgementRecord {
  return {
    target: row.target,
    instanceId: row.instance_id,
    appliedConcurrency: row.applied_concurrency,
    status: normalizeAckStatus(row.status),
    error: row.error,
    updatedAt: row.updated_at
  } satisfies RuntimeScalingAcknowledgementRecord;
}

function normalizeAckStatus(value: string | null | undefined): AckStatus {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase() as AckStatus;
    if (ACK_STATUS_VALUES.has(normalized)) {
      return normalized;
    }
  }
  return 'ok';
}

function normalizeActorKind(raw: string | null): RuntimeScalingPolicyRecord['updatedByKind'] {
  if (!raw) {
    return null;
  }
  return raw === 'service' ? 'service' : raw === 'user' ? 'user' : null;
}

function sanitizePolicyInput(
  input: RuntimeScalingPolicyUpsertInput
): RuntimeScalingPolicyUpsertInput & { desiredConcurrency: number } {
  const desired = Number.isFinite(input.desiredConcurrency) ? Math.floor(input.desiredConcurrency) : 0;
  return {
    ...input,
    desiredConcurrency: desired < 0 ? 0 : desired
  };
}

function sanitizeAckInput(
  input: RuntimeScalingAcknowledgementInput
): RuntimeScalingAcknowledgementInput & { appliedConcurrency: number; status: AckStatus } {
  const normalizedDesired = Number.isFinite(input.appliedConcurrency)
    ? Math.max(0, Math.floor(input.appliedConcurrency))
    : 0;
  const normalizedStatus = normalizeAckStatus(input.status ?? null);
  return {
    ...input,
    appliedConcurrency: normalizedDesired,
    status: normalizedStatus
  };
}

export async function listRuntimeScalingPolicies(): Promise<RuntimeScalingPolicyRecord[]> {
  return withConnection(async (client) => {
    const { rows } = await client.query<RuntimeScalingPolicyRow>(
      `SELECT target,
              desired_concurrency,
              reason,
              updated_by,
              updated_by_kind,
              updated_by_token_hash,
              metadata,
              created_at,
              updated_at
         FROM runtime_scaling_policies
         ORDER BY target`
    );
    return rows.map(mapPolicyRow);
  });
}

export async function getRuntimeScalingPolicy(target: string): Promise<RuntimeScalingPolicyRecord | null> {
  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }
  return withConnection(async (client) => {
    const { rows } = await client.query<RuntimeScalingPolicyRow>(
      `SELECT target,
              desired_concurrency,
              reason,
              updated_by,
              updated_by_kind,
              updated_by_token_hash,
              metadata,
              created_at,
              updated_at
         FROM runtime_scaling_policies
         WHERE target = $1`,
      [trimmed]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapPolicyRow(rows[0]);
  });
}

export async function upsertRuntimeScalingPolicy(
  input: RuntimeScalingPolicyUpsertInput
): Promise<RuntimeScalingPolicyRecord> {
  const sanitized = sanitizePolicyInput(input);
  const target = sanitized.target.trim();
  if (!target) {
    throw new Error('runtime scaling target is required');
  }

  return withConnection(async (client) => {
    const { rows } = await client.query<RuntimeScalingPolicyRow>(
      `INSERT INTO runtime_scaling_policies (
         target,
         desired_concurrency,
         reason,
         updated_by,
         updated_by_kind,
         updated_by_token_hash,
         metadata,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (target)
       DO UPDATE SET desired_concurrency = EXCLUDED.desired_concurrency,
                     reason = EXCLUDED.reason,
                     updated_by = EXCLUDED.updated_by,
                     updated_by_kind = EXCLUDED.updated_by_kind,
                     updated_by_token_hash = EXCLUDED.updated_by_token_hash,
                     metadata = EXCLUDED.metadata,
                     updated_at = NOW()
       RETURNING target,
                 desired_concurrency,
                 reason,
                 updated_by,
                 updated_by_kind,
                 updated_by_token_hash,
                 metadata,
                 created_at,
                 updated_at`,
      [
        target,
        sanitized.desiredConcurrency,
        sanitized.reason ?? null,
        sanitized.updatedBy ?? null,
        sanitized.updatedByKind ?? null,
        sanitized.updatedByTokenHash ?? null,
        sanitized.metadata ?? null
      ]
    );
    if (rows.length === 0) {
      throw new Error('Failed to upsert runtime scaling policy');
    }
    return mapPolicyRow(rows[0]);
  });
}

export async function deleteRuntimeScalingPolicy(target: string): Promise<void> {
  const trimmed = target.trim();
  if (!trimmed) {
    return;
  }
  await withConnection(async (client) => {
    await client.query('DELETE FROM runtime_scaling_policies WHERE target = $1', [trimmed]);
  });
}

export async function recordRuntimeScalingAcknowledgement(
  input: RuntimeScalingAcknowledgementInput
): Promise<RuntimeScalingAcknowledgementRecord> {
  const sanitized = sanitizeAckInput(input);
  const target = sanitized.target.trim();
  const instanceId = sanitized.instanceId.trim();
  if (!target) {
    throw new Error('runtime scaling target is required');
  }
  if (!instanceId) {
    throw new Error('runtime scaling instanceId is required');
  }

  return withConnection(async (client) => {
    const { rows } = await client.query<RuntimeScalingAcknowledgementRow>(
      `INSERT INTO runtime_scaling_acknowledgements (
         target,
         instance_id,
         applied_concurrency,
         status,
         error,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (target, instance_id)
       DO UPDATE SET applied_concurrency = EXCLUDED.applied_concurrency,
                     status = EXCLUDED.status,
                     error = EXCLUDED.error,
                     updated_at = NOW()
       RETURNING target,
                 instance_id,
                 applied_concurrency,
                 status,
                 error,
                 updated_at`,
      [
        target,
        instanceId,
        sanitized.appliedConcurrency,
        sanitized.status,
        sanitized.error ?? null
      ]
    );
    if (rows.length === 0) {
      throw new Error('Failed to upsert runtime scaling acknowledgement');
    }
    return mapAcknowledgementRow(rows[0]);
  });
}

export async function listRuntimeScalingAcknowledgements(
  target?: string
): Promise<RuntimeScalingAcknowledgementRecord[]> {
  return withConnection(async (client) => {
    if (target) {
      const trimmed = target.trim();
      const { rows } = await client.query<RuntimeScalingAcknowledgementRow>(
        `SELECT target,
                instance_id,
                applied_concurrency,
                status,
                error,
                updated_at
           FROM runtime_scaling_acknowledgements
           WHERE target = $1
           ORDER BY updated_at DESC`,
        [trimmed]
      );
      return rows.map(mapAcknowledgementRow);
    }

    const { rows } = await client.query<RuntimeScalingAcknowledgementRow>(
      `SELECT target,
              instance_id,
              applied_concurrency,
              status,
              error,
              updated_at
         FROM runtime_scaling_acknowledgements
         ORDER BY target, updated_at DESC`
    );
    return rows.map(mapAcknowledgementRow);
  });
}

export async function pruneRuntimeScalingAcknowledgements(
  options: { olderThanMs: number }
): Promise<number> {
  const thresholdMs = Number.isFinite(options.olderThanMs) ? Math.max(0, Math.floor(options.olderThanMs)) : 0;
  if (thresholdMs <= 0) {
    return 0;
  }

  return withConnection(async (client) => {
    const deleted = await client.query<{ count: string }>(
      `DELETE FROM runtime_scaling_acknowledgements
         WHERE updated_at < NOW() - ($1::bigint * INTERVAL '1 millisecond')
       RETURNING 1`,
      [thresholdMs]
    );
    return deleted.rows.length;
  });
}

export async function withRuntimeScalingPolicy<T>(
  target: string,
  fn: (policy: RuntimeScalingPolicyRecord | null, client: PoolClient) => Promise<T>
): Promise<T> {
  const trimmed = target.trim();
  if (!trimmed) {
    throw new Error('runtime scaling target is required');
  }

  return withConnection(async (client) => {
    const { rows } = await client.query<RuntimeScalingPolicyRow>(
      `SELECT target,
              desired_concurrency,
              reason,
              updated_by,
              updated_by_kind,
              updated_by_token_hash,
              metadata,
              created_at,
              updated_at
         FROM runtime_scaling_policies
         WHERE target = $1`,
      [trimmed]
    );
    const policy = rows.length === 0 ? null : mapPolicyRow(rows[0]);
    return fn(policy, client);
  });
}
