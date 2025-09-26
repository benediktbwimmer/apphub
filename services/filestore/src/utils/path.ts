import { FilestoreError } from '../errors';

export function normalizePath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new FilestoreError('Path must not be empty', 'INVALID_PATH');
  }

  const normalized = trimmed
    .replace(/\\+/g, '/')
    .replace(/\/+$/, '')
    .replace(/^\/+/, '')
    .replace(/\/+/g, '/');

  if (!normalized) {
    throw new FilestoreError('Root path is not allowed for this operation', 'INVALID_PATH');
  }

  if (normalized.includes('..')) {
    throw new FilestoreError('Path containing `..` is not supported', 'INVALID_PATH', { path: input });
  }

  return normalized;
}

export function getParentPath(path: string): string | null {
  const segments = path.split('/');
  if (segments.length <= 1) {
    return null;
  }
  segments.pop();
  const parent = segments.join('/');
  return parent.length > 0 ? parent : null;
}

export function getNodeDepth(path: string): number {
  return path.split('/').length;
}

export function getNodeName(path: string): string {
  const segments = path.split('/');
  return segments[segments.length - 1];
}
