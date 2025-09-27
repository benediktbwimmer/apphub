import type { BackendMountRecord } from '../db/backendMounts';
import type { FilestoreCommand } from '../commands/types';
import type { Readable } from 'node:stream';

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

export type ExecutorFileMetadata = {
  sizeBytes?: number | null;
  checksum?: string | null;
  contentHash?: string | null;
  lastModifiedAt?: Date | null;
  contentType?: string | null;
  etag?: string | null;
  metadata?: Record<string, string> | null;
};

export type ExecutorReadStreamOptions = {
  range?: { start: number; end: number };
};

export type ExecutorReadStreamResult = {
  stream: Readable;
  contentLength?: number | null;
  totalSize?: number | null;
  contentRange?: string | null;
  contentType?: string | null;
  etag?: string | null;
  lastModifiedAt?: Date | null;
};

export type ExecutorPresignOptions = {
  expiresInSeconds?: number;
};

export type ExecutorPresignResult = {
  url: string;
  expiresAt: Date;
  headers?: Record<string, string>;
  method?: string;
};

export interface CommandExecutor {
  kind: string;
  execute(command: FilestoreCommand, context: ExecutorContext): Promise<ExecutorResult>;
  head?(path: string, context: ExecutorContext): Promise<ExecutorFileMetadata | null>;
  createReadStream?(
    path: string,
    context: ExecutorContext,
    options?: ExecutorReadStreamOptions
  ): Promise<ExecutorReadStreamResult>;
  createPresignedDownload?(
    path: string,
    context: ExecutorContext,
    options?: ExecutorPresignOptions
  ): Promise<ExecutorPresignResult>;
}
