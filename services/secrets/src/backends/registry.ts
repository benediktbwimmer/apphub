import { performance } from 'node:perf_hooks';
import type { SecretBackend } from './base';
import type { SecretRecord } from '../types';

export type SecretRegistrySnapshot = {
  total: number;
  backends: Array<{
    name: string;
    kind: string;
    count: number;
  }>;
  refreshedAt: string;
  durationMs: number;
};

export class SecretRegistry {
  private readonly backends: SecretBackend[];
  private cache: Map<string, SecretRecord> = new Map();
  private refreshedAt: Date | null = null;
  private lastSnapshot: SecretRegistrySnapshot | null = null;

  constructor(backends: SecretBackend[]) {
    this.backends = backends;
  }

  async refresh(): Promise<SecretRegistrySnapshot> {
    const next = new Map<string, SecretRecord>();
    const backendSummaries: SecretRegistrySnapshot['backends'] = [];
    const started = performance.now();

    for (const backend of this.backends) {
      try {
        const records = await backend.load();
        backendSummaries.push({ name: backend.name, kind: backend.kind, count: records.length });
        for (const record of records) {
          next.set(record.key, record);
        }
      } catch (error) {
        const descriptor = backend.describe();
        const optional = Boolean((descriptor.optional as boolean | undefined) ?? false);
        const message = error instanceof Error ? error.message : String(error);
        if (optional) {
          console.warn(`[@apphub/secrets] optional backend ${backend.name} failed to load: ${message}`);
          continue;
        }
        console.error(`[@apphub/secrets] backend ${backend.name} failed to load`, error);
        throw error;
      }
    }

    this.cache = next;
    this.refreshedAt = new Date();
    const ended = performance.now();

    const snapshot: SecretRegistrySnapshot = {
      total: next.size,
      backends: backendSummaries,
      refreshedAt: this.refreshedAt.toISOString(),
      durationMs: Math.round(ended - started)
    } satisfies SecretRegistrySnapshot;

    this.lastSnapshot = snapshot;
    return snapshot;
  }

  getSecret(key: string): SecretRecord | null {
    const trimmed = key.trim();
    if (!trimmed) {
      return null;
    }
    return this.cache.get(trimmed) ?? null;
  }

  listSecrets(): SecretRecord[] {
    return Array.from(this.cache.values());
  }

  getSnapshot(): SecretRegistrySnapshot | null {
    return this.lastSnapshot;
  }
}
