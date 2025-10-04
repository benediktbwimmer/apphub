import { type SecretReference } from './db/types';
import { recordAuditLog } from './db/audit';
import type { JsonValue } from './db/types';
import { getSecretFromStore } from './secretStore';
import { getSecretsClient, shouldUseManagedSecrets } from './secretsClient';

export type ResolvedSecret = {
  reference: SecretReference;
  value: string | null;
  backend?: string | null;
  version?: string | null;
};

export type SecretAccessContext = {
  actor?: string;
  actorType?: string;
  tokenHash?: string | null;
  metadata?: Record<string, JsonValue>;
};

type StoreSecretReference = Extract<SecretReference, { source: 'store' }>;

function logSecretResolution(
  reference: SecretReference,
  value: string | null,
  context?: SecretAccessContext,
  resolvedVersion?: string | null,
  backend?: string | null
): void {
  let referenceVersion: string | null = null;
  if (reference.source === 'store') {
    referenceVersion = (reference as StoreSecretReference).version ?? null;
  }
  const metadata: Record<string, JsonValue> = {
    reference: {
      source: reference.source,
      key: reference.key,
      version: referenceVersion
    }
  };
  if (resolvedVersion !== undefined) {
    metadata.resolvedVersion = resolvedVersion;
  }
  if (backend) {
    metadata.backend = backend;
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

async function resolveStoreSecret(
  reference: StoreSecretReference,
  context?: SecretAccessContext
): Promise<ResolvedSecret> {
  let backend: string | null = null;
  let resolvedVersion: string | null = null;
  let value: string | null = null;

  if (shouldUseManagedSecrets()) {
    try {
      const client = getSecretsClient();
      const managed = await client.resolveSecret(reference.key);
      if (managed) {
        backend = managed.backend;
        resolvedVersion = managed.version ?? null;
        if (!reference.version || !managed.version || reference.version === managed.version) {
          value = managed.value;
        } else {
          value = null;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[secrets] failed to resolve secret from managed service', {
        key: reference.key,
        error: message
      });
      value = null;
    }
  } else {
    const entry = getSecretFromStore(reference.key);
    backend = entry ? 'inline-store' : null;
    resolvedVersion = entry?.version ?? null;
    if (entry) {
      if (!reference.version || !entry.version || reference.version === entry.version) {
        value = entry.value;
      } else {
        value = null;
      }
    }
  }

  logSecretResolution(reference, value, context, resolvedVersion, backend ?? 'store');
  return {
    reference,
    value,
    backend,
    version: resolvedVersion
  };
}

export async function resolveSecret(
  reference: SecretReference,
  context?: SecretAccessContext
): Promise<ResolvedSecret> {
  switch (reference.source) {
    case 'env': {
      const value = process.env[reference.key] ?? null;
      logSecretResolution(reference, value, context, null, 'env');
      return {
        reference,
        value,
        backend: 'env',
        version: null
      };
    }
    case 'store': {
      return resolveStoreSecret(reference, context);
    }
    default: {
      logSecretResolution(reference, null, context, null, null);
      return { reference, value: null, backend: null, version: null };
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
