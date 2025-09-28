import { existsSync } from 'node:fs';
import path from 'node:path';

type ResolveHostRootMountOptions = {
  env?: NodeJS.ProcessEnv;
};

type ResolveContainerPathOptions = {
  hostRoot?: string | null;
  exists?: (targetPath: string) => boolean;
};

export function resolveHostRootMount(options?: ResolveHostRootMountOptions): string | null {
  const env = options?.env ?? process.env;
  const raw = env.APPHUB_HOST_ROOT ?? env.HOST_ROOT_PATH;
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const resolved = path.resolve(trimmed);
  if (!path.isAbsolute(resolved)) {
    return null;
  }
  return resolved;
}

const absoluteRoot = path.resolve('/');

export function resolveContainerPath(
  targetPath: string,
  options?: ResolveContainerPathOptions
): string {
  const absolute = path.resolve(targetPath);
  const hostRoot = options?.hostRoot ?? resolveHostRootMount();
  if (!hostRoot) {
    return absolute;
  }

  const fileExists = options?.exists ?? existsSync;
  if (fileExists(absolute)) {
    return absolute;
  }

  if (absolute === hostRoot || absolute.startsWith(`${hostRoot}${path.sep}`)) {
    return absolute;
  }

  const relativeFromRoot = path.relative(absoluteRoot, absolute);
  if (!relativeFromRoot || relativeFromRoot.startsWith('..')) {
    return absolute;
  }

  return path.join(hostRoot, relativeFromRoot);
}
