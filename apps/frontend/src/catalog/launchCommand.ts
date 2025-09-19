import type { LaunchEnvVar } from './types';

const SAFE_ARG_PATTERN = /^[A-Za-z0-9_@%+=:,./-]+$/;

function shellEscape(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (SAFE_ARG_PATTERN.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function sanitizeLaunchName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'app';
}

export function createLaunchId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const now = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${now}-${random}`;
}

function resolveInternalPort(): number {
  const raw = import.meta.env.VITE_LAUNCH_INTERNAL_PORT;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 3000;
}

export function buildDockerRunCommandString(options: {
  repositoryId: string;
  launchId: string;
  imageTag: string | null;
  env: LaunchEnvVar[];
  internalPort?: number;
}): string {
  const internalPort = options.internalPort ?? resolveInternalPort();
  const containerName = `apphub-${sanitizeLaunchName(options.repositoryId)}-${options.launchId.slice(0, 8)}`;
  const args: string[] = ['docker', 'run', '-d', '--name', containerName, '-p', `0:${internalPort}`];

  for (const entry of options.env) {
    if (!entry || typeof entry.key !== 'string') {
      continue;
    }
    const key = entry.key.trim();
    if (!key) {
      continue;
    }
    const value = typeof entry.value === 'string' ? entry.value : '';
    args.push('-e');
    args.push(`${key}=${value}`);
  }

  const imageTag = options.imageTag && options.imageTag.length > 0 ? options.imageTag : 'IMAGE_TAG';
  args.push(imageTag);

  return args.map(shellEscape).join(' ');
}

export function resolveDefaultLaunchCommand(params: {
  repositoryId: string;
  launchId: string;
  imageTag: string | null;
  env: LaunchEnvVar[];
}): string {
  return buildDockerRunCommandString({
    repositoryId: params.repositoryId,
    launchId: params.launchId,
    imageTag: params.imageTag,
    env: params.env
  });
}
