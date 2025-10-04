import { loadConfigFromString, normalizeSecretCollection } from './utils';
import type { SecretBackend } from './base';
import type { SecretRecord } from '../types';

export class EnvSecretBackend implements SecretBackend {
  readonly kind = 'env' as const;
  readonly name: string;
  private readonly envVar: string;

  constructor(options?: { envVar?: string; name?: string }) {
    this.envVar = options?.envVar ?? 'APPHUB_SECRET_STORE';
    this.name = options?.name ?? 'inline-env';
  }

  async load(): Promise<SecretRecord[]> {
    const raw = process.env[this.envVar] ?? null;
    const parsed = loadConfigFromString(raw);
    return normalizeSecretCollection(this.name, parsed);
  }

  describe(): Record<string, unknown> {
    return {
      envVar: this.envVar
    };
  }
}
