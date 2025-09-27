import { existsSync } from 'node:fs';
import path from 'node:path';

function resolveHostRootMount(): string | null {
  const raw = process.env.APPHUB_HOST_ROOT ?? process.env.HOST_ROOT_PATH;
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

export function resolvePathWithHostRoot(targetPath: string): string {
  const absolute = path.resolve(targetPath);
  const hostRootMount = resolveHostRootMount();
  if (!hostRootMount) {
    return absolute;
  }
  if (
    absolute === hostRootMount ||
    absolute.startsWith(`${hostRootMount}${path.sep}`)
  ) {
    return absolute;
  }
  const relativeFromRoot = path.relative('/', absolute);
  if (!relativeFromRoot || relativeFromRoot.startsWith('..')) {
    return absolute;
  }
  const hostRootCandidate = path.join(hostRootMount, relativeFromRoot);
  if (existsSync(hostRootCandidate)) {
    return hostRootCandidate;
  }
  if (existsSync(absolute)) {
    return absolute;
  }
  return hostRootCandidate;
}
