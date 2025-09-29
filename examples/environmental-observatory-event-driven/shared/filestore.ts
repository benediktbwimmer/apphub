import { FilestoreClient, FilestoreClientError, FilestoreNodeResponse } from '@apphub/filestore-client';

export async function ensureFilestoreHierarchy(
  client: FilestoreClient,
  backendMountId: number,
  prefix: string,
  principal?: string
): Promise<void> {
  const trimmed = prefix.replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    return;
  }
  const segments = trimmed.split('/');
  let current = '';
  for (const segment of segments) {
    const sanitized = segment.trim();
    if (!sanitized) {
      continue;
    }
    current = current ? `${current}/${sanitized}` : sanitized;
    try {
      await client.createDirectory({
        backendMountId,
        path: current,
        principal,
        idempotencyKey: `ensure-${backendMountId}-${current}`
      });
    } catch (error) {
      if (error instanceof FilestoreClientError && error.code === 'NODE_EXISTS') {
        continue;
      }
      throw error;
    }
  }
}

export type UploadTextFileOptions = {
  client: FilestoreClient;
  backendMountId: number;
  path: string;
  content: string;
  contentType?: string;
  principal?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export async function uploadTextFile(options: UploadTextFileOptions): Promise<FilestoreNodeResponse> {
  const normalizedPath = options.path.replace(/^\/+/, '').replace(/\/+$/g, '');
  await ensureFilestoreHierarchy(options.client, options.backendMountId, normalizedPath.split('/').slice(0, -1).join('/'), options.principal);
  const response = await options.client.uploadFile({
    backendMountId: options.backendMountId,
    path: normalizedPath,
    content: options.content,
    contentType: options.contentType ?? 'text/plain; charset=utf-8',
    principal: options.principal,
    overwrite: true,
    metadata: options.metadata,
    idempotencyKey: options.idempotencyKey
  });
  return response.node;
}
