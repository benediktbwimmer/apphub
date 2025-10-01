import { FilestoreClient, FilestoreClientError, FilestoreNodeResponse } from '@apphub/filestore-client';

export const DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY = 'observatory-event-driven-s3';

export type FilestoreBackendLocator = {
  backendMountId?: number | null;
  backendMountKey?: string | null;
};

export async function resolveBackendMountId(
  client: FilestoreClient,
  locator: FilestoreBackendLocator
): Promise<number> {
  const candidateId = locator.backendMountId;
  if (typeof candidateId === 'number' && Number.isFinite(candidateId) && candidateId > 0) {
    return candidateId;
  }
  const key = locator.backendMountKey?.trim();
  if (!key) {
    throw new Error('backendMountId or backendMountKey is required to resolve a filestore backend');
  }
  const existing = await client.findBackendMountByKey(key);
  if (!existing) {
    throw new Error(`Filestore backend mount with key '${key}' was not found`);
  }
  return existing.id;
}

export async function ensureFilestoreHierarchy(
  client: FilestoreClient,
  backend: number | FilestoreBackendLocator,
  prefix: string,
  principal?: string
): Promise<void> {
  const backendMountId =
    typeof backend === 'number'
      ? backend
      : await resolveBackendMountId(client, {
          backendMountId: backend.backendMountId,
          backendMountKey: backend.backendMountKey
        });
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
        principal
      });
    } catch (error) {
      if (error instanceof FilestoreClientError && error.code === 'NODE_EXISTS') {
        continue;
      }
      throw error;
    }
  }
}

export async function ensureResolvedBackendId<T extends {
  filestoreBackendId?: number | null;
  filestoreBackendKey?: string | null;
}>(client: FilestoreClient, params: T): Promise<number> {
  const backendMountId = await resolveBackendMountId(client, {
    backendMountId: params.filestoreBackendId ?? null,
    backendMountKey: params.filestoreBackendKey ?? null
  });
  params.filestoreBackendId = backendMountId;
  if (!params.filestoreBackendKey) {
    params.filestoreBackendKey = DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY;
  }
  return backendMountId;
}

export type UploadTextFileOptions = {
  client: FilestoreClient;
  backendMountId?: number;
  backendMountKey?: string;
  path: string;
  content: string;
  contentType?: string;
  principal?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
};

export async function uploadTextFile(options: UploadTextFileOptions): Promise<FilestoreNodeResponse> {
  const normalizedPath = options.path.replace(/^\/+/, '').replace(/\/+$/g, '');
  const backendMountId = await resolveBackendMountId(options.client, {
    backendMountId: options.backendMountId,
    backendMountKey: options.backendMountKey
  });
  await ensureFilestoreHierarchy(
    options.client,
    backendMountId,
    normalizedPath.split('/').slice(0, -1).join('/'),
    options.principal
  );
  const response = await options.client.uploadFile({
    backendMountId,
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
