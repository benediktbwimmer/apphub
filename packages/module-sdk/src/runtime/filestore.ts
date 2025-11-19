import { CapabilityRequestError } from '../errors';
import type {
  FilestoreCapability,
  FilestoreCapabilityConfig,
  UploadFileResult
} from '../capabilities';

export interface FilestoreBackendLocator {
  backendMountId?: number | null;
  backendMountKey?: string | null;
}

export async function resolveBackendMountId(
  filestore: FilestoreCapability,
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

  const existing = await filestore.findBackendMountByKey(key);
  if (!existing) {
    throw new Error(`Filestore backend mount with key "${key}" was not found`);
  }
  return existing.id;
}

function isDirectoryConflictError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  if (error instanceof CapabilityRequestError && error.status === 409) {
    return true;
  }

  const maybeStatus = (error as { status?: unknown }).status;
  if (maybeStatus === 409) {
    return true;
  }

  const maybeCode = (error as { code?: unknown }).code;
  if (typeof maybeCode === 'string' && maybeCode.toUpperCase() === 'NODE_EXISTS') {
    return true;
  }

  return false;
}

export async function ensureFilestoreHierarchy(
  filestore: FilestoreCapability,
  backend: number | FilestoreBackendLocator,
  prefix: string,
  principal?: string
): Promise<void> {
  const backendMountId =
    typeof backend === 'number'
      ? backend
      : await resolveBackendMountId(filestore, backend);

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
      await filestore.ensureDirectory({
        backendMountId,
        path: current,
        principal
      });
    } catch (error) {
      if (isDirectoryConflictError(error)) {
        continue;
      }
      throw error;
    }
  }
}

export interface EnsureResolvedBackendOptions {
  defaultBackendKey?: string | null;
}

export async function ensureResolvedBackendId<T extends {
  filestoreBackendId?: number | null;
  filestoreBackendKey?: string | null;
}>(
  filestore: FilestoreCapability,
  params: T,
  options: EnsureResolvedBackendOptions = {}
): Promise<number> {
  const backendMountId = await resolveBackendMountId(filestore, {
    backendMountId: params.filestoreBackendId ?? null,
    backendMountKey: params.filestoreBackendKey ?? options.defaultBackendKey ?? null
  });
  params.filestoreBackendId = backendMountId;
  if (!params.filestoreBackendKey && options.defaultBackendKey) {
    params.filestoreBackendKey = options.defaultBackendKey;
  }
  return backendMountId;
}

export interface UploadTextFileOptions {
  filestore: FilestoreCapability;
  backendMountId?: number;
  backendMountKey?: string;
  defaultBackendKey?: string;
  path: string;
  content: string;
  contentType?: string;
  principal?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  overwrite?: boolean;
}

export async function uploadTextFile(options: UploadTextFileOptions): Promise<UploadFileResult> {
  const normalizedPath = options.path.replace(/^\/+/, '').replace(/\/+$/g, '');
  const backendMountId = await resolveBackendMountId(options.filestore, {
    backendMountId: options.backendMountId,
    backendMountKey: options.backendMountKey ?? options.defaultBackendKey ?? null
  });

  await ensureFilestoreHierarchy(
    options.filestore,
    backendMountId,
    normalizedPath.split('/').slice(0, -1).join('/'),
    options.principal
  );

  return options.filestore.uploadFile({
    backendMountId,
    path: normalizedPath,
    content: options.content,
    contentType: options.contentType ?? 'text/plain; charset=utf-8',
    principal: options.principal,
    overwrite: options.overwrite ?? true,
    metadata: options.metadata,
    idempotencyKey: options.idempotencyKey
  });
}
