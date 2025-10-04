import { existsSync, readFileSync } from 'node:fs';
import { loadConfigFromString, normalizeSecretCollection } from './utils';
import type { SecretBackend } from './base';
import type { SecretRecord } from '../types';

export class VaultSecretBackend implements SecretBackend {
  readonly kind = 'vault' as const;
  readonly name: string;
  private readonly filePath: string;
  private readonly namespace: string | null;
  private readonly optional: boolean;

  constructor(options: { path: string; namespace?: string | null; optional?: boolean; name?: string }) {
    this.filePath = options.path;
    this.namespace = options.namespace ?? null;
    this.optional = options.optional ?? true;
    const suffix = this.namespace ? `:${this.namespace}` : '';
    this.name = options.name ?? `vault${suffix}`;
  }

  async load(): Promise<SecretRecord[]> {
    if (!existsSync(this.filePath)) {
      if (this.optional) {
        return [];
      }
      throw new Error(`Vault secret file ${this.filePath} does not exist`);
    }
    const contents = readFileSync(this.filePath, 'utf8');
    const parsed = loadConfigFromString(contents);
    return normalizeSecretCollection(this.name, parsed);
  }

  describe(): Record<string, unknown> {
    return {
      path: this.filePath,
      namespace: this.namespace,
      optional: this.optional
    };
  }
}
