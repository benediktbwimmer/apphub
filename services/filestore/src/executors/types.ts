import type { BackendMountRecord } from '../db/backendMounts';
import type { FilestoreCommand } from '../commands/types';

export type ExecutorResult = {
  checksum?: string | null;
  contentHash?: string | null;
  sizeBytes?: number | null;
  metadata?: Record<string, unknown> | null;
  lastModifiedAt?: Date | null;
};

export interface ExecutorContext {
  backend: BackendMountRecord;
}

export interface CommandExecutor {
  kind: string;
  execute(command: FilestoreCommand, context: ExecutorContext): Promise<ExecutorResult>;
}
