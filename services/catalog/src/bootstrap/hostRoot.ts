import path from 'node:path';
export function resolvePathWithHostRoot(targetPath: string): string {
  return path.resolve(targetPath);
}
