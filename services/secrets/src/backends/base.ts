import type { SecretRecord } from '../types';
import type { BackendKind } from '../config/serviceConfig';

export interface SecretBackend {
  readonly kind: BackendKind;
  readonly name: string;
  load(): Promise<SecretRecord[]>;
  describe(): Record<string, unknown>;
}
