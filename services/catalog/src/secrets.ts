import { type SecretReference } from './db/types';

export type ResolvedSecret = {
  reference: SecretReference;
  value: string | null;
};

export function resolveSecret(reference: SecretReference): ResolvedSecret {
  switch (reference.source) {
    case 'env':
      return {
        reference,
        value: process.env[reference.key] ?? null
      };
    default:
      return { reference, value: null };
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
