import { statSync } from 'node:fs';
import path from 'node:path';
import type { LaunchEnvVar } from './db/index';

function getHostRootFallback(): string | null {
  const raw = process.env.APPHUB_HOST_ROOT;
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return path.resolve(trimmed);
}

function buildFallbackCandidates(hostRoot: string, hostPath: string): string[] {
  const normalized = path.resolve('/', hostPath);
  const relative = normalized === '/' ? '' : normalized.replace(/^\/+/, '');
  const candidates: string[] = [];

  const push = (candidate: string) => {
    if (!candidate) {
      return;
    }
    if (!candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };

  if (relative) {
    push(path.join(hostRoot, relative));
  } else {
    push(hostRoot);
  }

  const dockerDesktopRoot = path.join(hostRoot, 'host_mnt');
  const dockerDesktopRootStat = statDirectory(dockerDesktopRoot);
  if (dockerDesktopRootStat.exists && dockerDesktopRootStat.isDirectory) {
    if (relative) {
      push(path.join(dockerDesktopRoot, relative));
    } else {
      push(dockerDesktopRoot);
    }
  }

  return candidates;
}

function statDirectory(targetPath: string): { exists: boolean; isDirectory: boolean } {
  try {
    const stats = statSync(targetPath);
    return { exists: true, isDirectory: stats.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

type ResolvedVolumeMount = {
  source: string;
  target: string;
  mode: 'rw';
};

function resolveVolumeMounts(envVars?: LaunchEnvVar[]): ResolvedVolumeMount[] {
  if (!envVars || envVars.length === 0) {
    return [];
  }
  const mounts: ResolvedVolumeMount[] = [];
  const seenTargets = new Set<string>();
  const hostRootFallback = getHostRootFallback();
  for (const entry of envVars) {
    if (!entry || typeof entry.key !== 'string' || typeof entry.value !== 'string') {
      continue;
    }
    if (entry.key.trim().toLowerCase() !== 'start_path') {
      continue;
    }
    const hostPath = entry.value.trim();
    if (!hostPath || !hostPath.startsWith('/') || !path.isAbsolute(hostPath)) {
      continue;
    }
    let sourcePath: string | null = null;
    const directStat = statDirectory(hostPath);
    if (directStat.exists) {
      if (directStat.isDirectory) {
        sourcePath = hostPath;
      }
    } else if (hostRootFallback) {
      for (const fallbackPath of buildFallbackCandidates(hostRootFallback, hostPath)) {
        const fallbackStat = statDirectory(fallbackPath);
        if (!fallbackStat.exists) {
          continue;
        }
        if (fallbackStat.isDirectory) {
          sourcePath = fallbackPath;
          break;
        }
      }
    }
    if (!sourcePath) {
      continue;
    }
    if (seenTargets.has(hostPath)) {
      continue;
    }
    seenTargets.add(hostPath);
    mounts.push({
      source: sourcePath,
      target: hostPath,
      mode: 'rw'
    });
  }
  return mounts;
}

const SAFE_ARG_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function sanitizeLaunchName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (SAFE_ARG_PATTERN.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function stringifyDockerCommand(args: string[]): string {
  return ['docker', ...args].map(shellEscape).join(' ');
}

export function buildDockerRunCommand(options: {
  repositoryId: string;
  launchId: string;
  imageTag: string;
  env?: LaunchEnvVar[];
  internalPort: number;
}): { args: string[]; command: string; containerName: string } {
  const envVars = Array.isArray(options.env) ? options.env : [];
  const containerName = `apphub-${sanitizeLaunchName(options.repositoryId)}-${options.launchId.slice(0, 8)}`;
  const args: string[] = ['run', '-d', '--name', containerName, '-p', `0:${options.internalPort}`];
  for (const mount of resolveVolumeMounts(envVars)) {
    args.push('-v', `${mount.source}:${mount.target}:${mount.mode}`);
  }
  for (const entry of envVars) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    args.push('-e', `${key}=${value}`);
  }
  args.push(options.imageTag);
  const command = stringifyDockerCommand(args);
  return { args, command, containerName };
}

function tokenizeCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escapeNext = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      const nextChar = input[index + 1];
      if (nextChar === '\n' || nextChar === '\r') {
        if (nextChar === '\r' && input[index + 2] === '\n') {
          index += 1;
        }
        index += 1;
        continue;
      }
      escapeNext = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error('Unterminated quoted string in command');
  }

  if (escapeNext) {
    current += '\\';
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

export function parseDockerCommand(command: string): string[] | null {
  const trimmed = command.trim();
  if (!trimmed) {
    return null;
  }

  let tokens: string[];
  try {
    tokens = tokenizeCommand(trimmed);
  } catch {
    return null;
  }

  if (tokens.length === 0) {
    return null;
  }

  if (tokens[0].toLowerCase() === 'sudo') {
    tokens = tokens.slice(1);
  }

  if (tokens.length === 0 || tokens[0].toLowerCase() !== 'docker') {
    return null;
  }

  return tokens.slice(1);
}
