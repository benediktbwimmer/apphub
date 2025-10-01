import { Buffer } from 'node:buffer';
import { httpRequest, type FetchLike, type TokenProvider } from '../internal/http';

export interface FilestoreCapabilityConfig {
  baseUrl: string;
  backendMountId: number;
  token?: TokenProvider;
  principal?: string;
  fetchImpl?: FetchLike;
}

export interface EnsureDirectoryInput {
  path: string;
  metadata?: Record<string, unknown>;
  principal?: string;
  idempotencyKey?: string;
}

export interface UploadFileInput {
  path: string;
  content: string | Uint8Array | ArrayBuffer;
  contentType?: string;
  metadata?: Record<string, unknown>;
  overwrite?: boolean;
  principal?: string;
  idempotencyKey?: string;
}

export interface UploadFileResult {
  nodeId: number | null;
  path: string;
}

export interface FilestoreCapability {
  ensureDirectory(input: EnsureDirectoryInput): Promise<void>;
  uploadFile(input: UploadFileInput): Promise<UploadFileResult>;
}

function toBase64(content: string | Uint8Array | ArrayBuffer): string {
  if (typeof content === 'string') {
    return Buffer.from(content, 'utf8').toString('base64');
  }
  if (content instanceof ArrayBuffer) {
    return Buffer.from(content).toString('base64');
  }
  return Buffer.from(content).toString('base64');
}

export function createFilestoreCapability(config: FilestoreCapabilityConfig): FilestoreCapability {
  return {
    async ensureDirectory(input: EnsureDirectoryInput): Promise<void> {
      await httpRequest({
        baseUrl: config.baseUrl,
        path: '/v1/directories',
        method: 'POST',
        authToken: config.token,
        principal: input.principal ?? config.principal,
        idempotencyKey: input.idempotencyKey,
        fetchImpl: config.fetchImpl,
        body: {
          backendMountId: config.backendMountId,
          path: input.path,
          metadata: input.metadata
        },
        expectJson: true
      });
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileResult> {
      const response = await httpRequest<{ data?: { node?: { id?: number | null } | null; path?: string } }>(
        {
          baseUrl: config.baseUrl,
          path: '/v1/files',
          method: 'POST',
          authToken: config.token,
          principal: input.principal ?? config.principal,
          idempotencyKey: input.idempotencyKey,
          fetchImpl: config.fetchImpl,
          body: {
            backendMountId: config.backendMountId,
            path: input.path,
            overwrite: input.overwrite ?? true,
            metadata: input.metadata,
            contentType: input.contentType,
            content: toBase64(input.content)
          },
          expectJson: true,
          headers: {
            'content-type': 'application/json'
          }
        }
      );

      const nodeId = response.data?.data?.node?.id ?? null;
      const path = response.data?.data?.path ?? input.path;
      return { nodeId, path };
    }
  } satisfies FilestoreCapability;
}
