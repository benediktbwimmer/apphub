import { existsSync, readFileSync } from 'node:fs';
import { loadConfigFromString, normalizeSecretCollection } from './utils';
import type { SecretBackend } from './base';
import type { SecretRecord } from '../types';

export class FileSecretBackend implements SecretBackend {
  readonly kind = 'file' as const;
  readonly name: string;
  private readonly filePath: string;
  private readonly optional: boolean;

  constructor(options: { path: string; name?: string; optional?: boolean }) {
    this.filePath = options.path;
    this.optional = options.optional ?? false;
    this.name = options.name ?? 'config-file';
  }

  async load(): Promise<SecretRecord[]> {
    if (!existsSync(this.filePath)) {
      if (this.optional) {
        return [];
      }
      throw new Error(`Secret file ${this.filePath} does not exist`);
    }
    const contents = readFileSync(this.filePath, 'utf8');
    const parsed = loadConfigFromString(contents);
    return normalizeSecretCollection(this.name, parsed);
  }

  describe(): Record<string, unknown> {
    return {
      path: this.filePath,
      optional: this.optional
    };
  }
}
