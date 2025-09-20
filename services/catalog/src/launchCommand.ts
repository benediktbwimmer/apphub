import { statSync } from 'node:fs';
import path from 'node:path';
import type { LaunchEnvVar } from './db/index';

function resolveVolumeMounts(envVars?: LaunchEnvVar[]): string[] {
  if (!envVars || envVars.length === 0) {
    return [];
  }
  const mounts: string[] = [];
  const seen = new Set<string>();
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
    try {
      if (!statSync(hostPath).isDirectory()) {
        continue;
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        continue;
      }
    }
    if (seen.has(hostPath)) {
      continue;
    }
    seen.add(hostPath);
    mounts.push(`${hostPath}:${hostPath}:ro`);
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
    args.push('-v', mount);
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
