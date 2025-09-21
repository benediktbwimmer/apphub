import { type SecretReference } from './db/types';
import { recordAuditLog } from './db/audit';
import { getSecretFromStore } from './secretStore';
import type { JsonValue } from './db/types';

export type ResolvedSecret = {
  reference: SecretReference;
  value: string | null;
};

export type SecretAccessContext = {
  actor?: string;
  actorType?: string;
  tokenHash?: string | null;
  metadata?: Record<string, JsonValue>;
};

function logSecretResolution(
  reference: SecretReference,
  value: string | null,
  context?: SecretAccessContext,
  resolvedVersion?: string | null
): void {
  const metadata: Record<string, JsonValue> = {
    reference: {
      source: reference.source,
      key: reference.key,
      version: reference.source === 'store' ? reference.version ?? null : null
    }
  };
  if (resolvedVersion !== undefined) {
    metadata.resolvedVersion = resolvedVersion;
  }
  if (context?.metadata) {
    Object.assign(metadata, context.metadata);
  }

  void recordAuditLog({
    actor: context?.actor ?? 'system',
    actorType: context?.actorType ?? 'system',
    tokenHash: context?.tokenHash ?? null,
    scopes: [],
    action: 'secret.resolve',
    resource: `secret:${reference.source}:${reference.key}`,
    status: value ? 'succeeded' : 'missing',
    metadata
  }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[secrets] failed to record secret access audit', err);
  });
}

export function resolveSecret(reference: SecretReference, context?: SecretAccessContext): ResolvedSecret {
  switch (reference.source) {
    case 'env': {
      const value = process.env[reference.key] ?? null;
      logSecretResolution(reference, value, context, null);
      return {
        reference,
        value
      };
    }
    case 'store': {
      const entry = getSecretFromStore(reference.key);
      let value: string | null = null;
      let resolvedVersion: string | null = entry?.version ?? null;
      if (entry) {
        if (!reference.version || !entry.version || reference.version === entry.version) {
          value = entry.value;
        } else {
          resolvedVersion = entry.version;
        }
      }
      logSecretResolution(reference, value, context, resolvedVersion);
      return {
        reference,
        value
      };
    }
    default: {
      logSecretResolution(reference, null, context, null);
      return { reference, value: null };
    }
  }
}

export function maskSecret(value: unknown): string {
  if (!value) {
    return '***';
  }
  if (typeof value === 'string' && value.trim().length <= 8) {
    return '*'.repeat(value.length);
  }
  return '***';
}

export function describeSecret(reference: SecretReference): string {
  return `${reference.source}:${reference.key}`;
}
