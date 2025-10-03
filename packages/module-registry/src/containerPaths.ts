import path from 'node:path';

export function resolveContainerPath(targetPath: string): string {
  return path.resolve(targetPath);
}
