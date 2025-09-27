import type { FilestoreBackendMount } from './types';

export type DirectoryFormState = {
  path: string;
  metadata: string;
  error: string | null;
  metadataError: string | null;
  submitting: boolean;
};

export type DirectoryFormAction =
  | { type: 'setPath'; path: string }
  | { type: 'setMetadata'; metadata: string }
  | { type: 'setError'; error: string | null }
  | { type: 'setMetadataError'; error: string | null }
  | { type: 'setSubmitting'; submitting: boolean }
  | { type: 'reset'; state: DirectoryFormState };

export function createDirectoryFormState(initial?: Partial<Pick<DirectoryFormState, 'path' | 'metadata'>>): DirectoryFormState {
  return {
    path: initial?.path ?? '',
    metadata: initial?.metadata ?? '',
    error: null,
    metadataError: null,
    submitting: false
  };
}

export function directoryFormReducer(state: DirectoryFormState, action: DirectoryFormAction): DirectoryFormState {
  switch (action.type) {
    case 'setPath':
      return { ...state, path: action.path, error: null };
    case 'setMetadata':
      return { ...state, metadata: action.metadata, metadataError: null };
    case 'setError':
      return { ...state, error: action.error };
    case 'setMetadataError':
      return { ...state, metadataError: action.error };
    case 'setSubmitting':
      return { ...state, submitting: action.submitting };
    case 'reset':
      return { ...action.state };
    default:
      return state;
  }
}

export type UploadFormState = {
  path: string;
  metadata: string;
  checksum: string;
  overwrite: boolean;
  file: File | null;
  error: string | null;
  metadataError: string | null;
  submitting: boolean;
};

export type UploadFormAction =
  | { type: 'setPath'; path: string }
  | { type: 'setMetadata'; metadata: string }
  | { type: 'setChecksum'; checksum: string }
  | { type: 'setOverwrite'; overwrite: boolean }
  | { type: 'setFile'; file: File | null }
  | { type: 'setError'; error: string | null }
  | { type: 'setMetadataError'; error: string | null }
  | { type: 'setSubmitting'; submitting: boolean }
  | { type: 'reset'; state: UploadFormState };

export function createUploadFormState(initial?: Partial<Pick<UploadFormState, 'path' | 'metadata' | 'overwrite'>>): UploadFormState {
  return {
    path: initial?.path ?? '',
    metadata: initial?.metadata ?? '',
    checksum: '',
    overwrite: initial?.overwrite ?? false,
    file: null,
    error: null,
    metadataError: null,
    submitting: false
  };
}

export function uploadFormReducer(state: UploadFormState, action: UploadFormAction): UploadFormState {
  switch (action.type) {
    case 'setPath':
      return { ...state, path: action.path, error: null };
    case 'setMetadata':
      return { ...state, metadata: action.metadata, metadataError: null };
    case 'setChecksum':
      return { ...state, checksum: action.checksum };
    case 'setOverwrite':
      return { ...state, overwrite: action.overwrite };
    case 'setFile':
      return { ...state, file: action.file, error: null };
    case 'setError':
      return { ...state, error: action.error };
    case 'setMetadataError':
      return { ...state, metadataError: action.error };
    case 'setSubmitting':
      return { ...state, submitting: action.submitting };
    case 'reset':
      return { ...action.state };
    default:
      return state;
  }
}

export type MoveCopyFormState = {
  sourcePath: string;
  targetPath: string;
  targetMountId: number | null;
  overwrite: boolean;
  error: string | null;
  submitting: boolean;
};

export type MoveCopyFormAction =
  | { type: 'setTargetPath'; path: string }
  | { type: 'setTargetMountId'; mountId: number | null }
  | { type: 'setOverwrite'; overwrite: boolean }
  | { type: 'setError'; error: string | null }
  | { type: 'setSubmitting'; submitting: boolean }
  | { type: 'reset'; state: MoveCopyFormState };

export function createMoveCopyFormState(initial: {
  sourcePath: string;
  targetPath?: string;
  targetMountId?: number | null;
  overwrite?: boolean;
}): MoveCopyFormState {
  return {
    sourcePath: initial.sourcePath,
    targetPath: initial.targetPath ?? initial.sourcePath,
    targetMountId: initial.targetMountId ?? null,
    overwrite: initial.overwrite ?? false,
    error: null,
    submitting: false
  };
}

export function moveCopyFormReducer(state: MoveCopyFormState, action: MoveCopyFormAction): MoveCopyFormState {
  switch (action.type) {
    case 'setTargetPath':
      return { ...state, targetPath: action.path, error: null };
    case 'setTargetMountId':
      return { ...state, targetMountId: action.mountId, error: null };
    case 'setOverwrite':
      return { ...state, overwrite: action.overwrite };
    case 'setError':
      return { ...state, error: action.error };
    case 'setSubmitting':
      return { ...state, submitting: action.submitting };
    case 'reset':
      return { ...action.state };
    default:
      return state;
  }
}

export type DeleteFormState = {
  path: string;
  recursive: boolean;
  confirmation: string;
  error: string | null;
  submitting: boolean;
};

export type DeleteFormAction =
  | { type: 'setRecursive'; recursive: boolean }
  | { type: 'setConfirmation'; confirmation: string }
  | { type: 'setError'; error: string | null }
  | { type: 'setSubmitting'; submitting: boolean }
  | { type: 'reset'; state: DeleteFormState };

export function createDeleteFormState(initial: { path: string; recursive?: boolean }): DeleteFormState {
  return {
    path: initial.path,
    recursive: initial.recursive ?? false,
    confirmation: '',
    error: null,
    submitting: false
  };
}

export function deleteFormReducer(state: DeleteFormState, action: DeleteFormAction): DeleteFormState {
  switch (action.type) {
    case 'setRecursive':
      return { ...state, recursive: action.recursive };
    case 'setConfirmation':
      return { ...state, confirmation: action.confirmation, error: null };
    case 'setError':
      return { ...state, error: action.error };
    case 'setSubmitting':
      return { ...state, submitting: action.submitting };
    case 'reset':
      return { ...action.state };
    default:
      return state;
  }
}

export function normalizeRelativePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }
  const withoutLeading = trimmed.replace(/^\/+/, '');
  const withoutTrailing = withoutLeading.replace(/\/+$/, '');
  return withoutTrailing;
}

export function validateRelativePath(path: string): string | null {
  if (!path) {
    return 'Path is required.';
  }
  if (path.startsWith('/')) {
    return 'Paths must be relative to the mount root.';
  }
  if (path.includes('//')) {
    return 'Path cannot contain empty segments.';
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0)) {
    return 'Path cannot contain empty segments.';
  }
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return 'Path segments cannot be "." or "..".';
  }
  return null;
}

export type ParsedMetadataResult =
  | { success: true; value: Record<string, unknown> | undefined }
  | { success: false; error: string };

export function parseMetadataDraft(input: string): ParsedMetadataResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { success: true, value: undefined };
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { success: false, error: 'Metadata must be a JSON object.' };
    }
    return { success: true, value: parsed as Record<string, unknown> };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Metadata must be valid JSON.';
    return { success: false, error: message };
  }
}

export function buildIdempotencyKey(prefix: string): string {
  const globalCrypto = typeof crypto !== 'undefined' ? crypto : null;
  if (globalCrypto && typeof globalCrypto.randomUUID === 'function') {
    return `${prefix}-${globalCrypto.randomUUID()}`;
  }
  const random = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

export function findMountById(mounts: FilestoreBackendMount[], id: number | null | undefined): FilestoreBackendMount | null {
  if (typeof id !== 'number') {
    return null;
  }
  return mounts.find((mount) => mount.id === id) ?? null;
}

export function describeMount(mount: FilestoreBackendMount | null): string | null {
  if (!mount) {
    return null;
  }
  const kindLabel = mount.backendKind === 'local' ? 'Local' : 'S3';
  return `${mount.mountKey} · ${kindLabel}`;
}
