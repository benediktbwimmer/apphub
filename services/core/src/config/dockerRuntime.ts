import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  booleanVar,
  loadEnvConfig,
  stringListVar,
  stringVar,
  EnvConfigError
} from '@apphub/shared/envConfig';

const DEFAULT_MAX_WORKSPACE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

export type DockerImagePattern = {
  pattern: string;
  regex: RegExp;
};

export type DockerNetworkPolicy = {
  isolationEnabled: boolean;
  allowModeOverride: boolean;
  allowedModes: ReadonlySet<'none' | 'bridge'>;
  defaultMode: 'none' | 'bridge';
};

export type DockerRuntimeConfig = {
  enabled: boolean;
  workspaceRoot: string;
  imageAllowList: DockerImagePattern[];
  imageDenyList: DockerImagePattern[];
  maxWorkspaceBytes: number | null;
  gpuEnabled: boolean;
  network: DockerNetworkPolicy;
  persistLogTailInContext: boolean;
};

let cachedConfig: DockerRuntimeConfig | null = null;

const dockerEnvSchema = z
  .object({
    CORE_ENABLE_DOCKER_JOBS: booleanVar({ defaultValue: false }),
    CORE_DOCKER_WORKSPACE_ROOT: stringVar({ allowEmpty: false }),
    CORE_DOCKER_IMAGE_ALLOWLIST: stringListVar({ separator: ',', unique: false }),
    CORE_DOCKER_IMAGE_DENYLIST: stringListVar({ separator: ',', unique: false }),
    CORE_DOCKER_MAX_WORKSPACE_BYTES: stringVar({ allowEmpty: false }),
    CORE_DOCKER_ENABLE_GPU: booleanVar({ defaultValue: false }),
    CORE_DOCKER_ENFORCE_NETWORK_ISOLATION: booleanVar({ defaultValue: true }),
    CORE_DOCKER_ALLOW_NETWORK_OVERRIDE: booleanVar({ defaultValue: false }),
    CORE_DOCKER_ALLOWED_NETWORK_MODES: stringListVar({ separator: ',', lowercase: true, unique: true }),
    CORE_DOCKER_DEFAULT_NETWORK_MODE: stringVar({ allowEmpty: true, lowercase: true }),
    CORE_DOCKER_PERSIST_LOG_TAIL: booleanVar({ defaultValue: true })
  })
  .passthrough();

type DockerEnv = z.infer<typeof dockerEnvSchema>;

function loadDockerEnv(): DockerEnv {
  return loadEnvConfig(dockerEnvSchema, { context: 'core:docker-runtime' });
}

function escapeForRegex(value: string): string {
  const special = new Set(['-', '/', '\\', '^', '$', '+', '?', '.', '(', ')', '|', '[', ']', '{', '}']);
  let buffer = '';
  for (const char of value) {
    if (char === '*') {
      buffer += '.*';
      continue;
    }
    if (char === '?') {
      buffer += '.';
      continue;
    }
    if (special.has(char)) {
      buffer += `\\${char}`;
      continue;
    }
    buffer += char;
  }
  return buffer;
}

function compilePattern(pattern: string): DockerImagePattern {
  if (!pattern) {
    throw new Error('Docker image allow/deny patterns must be non-empty');
  }
  const regexSource = `^${escapeForRegex(pattern)}$`;
  try {
    return { pattern, regex: new RegExp(regexSource) } satisfies DockerImagePattern;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    throw new Error(`Invalid docker image pattern "${pattern}": ${message}`);
  }
}

function parsePatterns(values: readonly string[]): DockerImagePattern[] {
  return values.map((entry) => compilePattern(entry));
}

function resolveWorkspaceRoot(configured: string | undefined): string {
  if (configured) {
    const trimmed = configured.trim();
    if (!trimmed) {
      throw new Error('CORE_DOCKER_WORKSPACE_ROOT must not be empty when provided');
    }
    const resolved = path.resolve(trimmed);
    if (!path.isAbsolute(resolved)) {
      throw new Error('CORE_DOCKER_WORKSPACE_ROOT must be an absolute path');
    }
    return resolved;
  }
  return path.join(os.tmpdir(), 'apphub-docker-workspaces');
}

function resolveNetworkPolicy(env: DockerEnv): DockerNetworkPolicy {
  const isolationEnabled = env.CORE_DOCKER_ENFORCE_NETWORK_ISOLATION ?? true;
  const defaultModeEnv = env.CORE_DOCKER_DEFAULT_NETWORK_MODE;
  const defaultMode = defaultModeEnv === 'bridge' ? 'bridge' : 'none';
  const allowModeOverride = env.CORE_DOCKER_ALLOW_NETWORK_OVERRIDE ?? false;
  const allowedModesEnv = env.CORE_DOCKER_ALLOWED_NETWORK_MODES ?? [];

  const allowedModes = new Set<'none' | 'bridge'>();

  if (allowedModesEnv.length > 0) {
    for (const entry of allowedModesEnv) {
      if (entry !== 'none' && entry !== 'bridge') {
        throw new Error(`Unsupported Docker network mode "${entry}". Allowed values: none, bridge.`);
      }
      allowedModes.add(entry);
    }
  }

  if (allowedModes.size === 0) {
    allowedModes.add('none');
    allowedModes.add('bridge');
  }

  if (!allowedModes.has(defaultMode)) {
    throw new Error(
      `CORE_DOCKER_DEFAULT_NETWORK_MODE is set to "${defaultMode}" but that mode is not in CORE_DOCKER_ALLOWED_NETWORK_MODES.`
    );
  }

  if (isolationEnabled && defaultMode !== 'none') {
    throw new Error('Network isolation is enforced but the default network mode is not "none".');
  }

  return {
    isolationEnabled,
    allowModeOverride: isolationEnabled ? false : allowModeOverride,
    allowedModes,
    defaultMode: isolationEnabled ? 'none' : defaultMode,
  } satisfies DockerNetworkPolicy;
}

function parseWorkspaceLimit(raw: string | undefined): number | null {
  if (!raw) {
    return DEFAULT_MAX_WORKSPACE_BYTES;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return DEFAULT_MAX_WORKSPACE_BYTES;
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === '0' || normalized === 'unlimited') {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new EnvConfigError(
      `[core:docker-runtime] Invalid environment configuration\n  • CORE_DOCKER_MAX_WORKSPACE_BYTES: Provide a positive integer or 'unlimited'`
    );
  }
  return parsed;
}

function buildConfig(): DockerRuntimeConfig {
  const env = loadDockerEnv();

  const enabled = env.CORE_ENABLE_DOCKER_JOBS ?? false;
  const workspaceRoot = resolveWorkspaceRoot(env.CORE_DOCKER_WORKSPACE_ROOT);
  const imageAllowList = parsePatterns(env.CORE_DOCKER_IMAGE_ALLOWLIST ?? []);
  const imageDenyList = parsePatterns(env.CORE_DOCKER_IMAGE_DENYLIST ?? []);
  const maxWorkspaceBytes = parseWorkspaceLimit(env.CORE_DOCKER_MAX_WORKSPACE_BYTES);
  const gpuEnabled = env.CORE_DOCKER_ENABLE_GPU ?? false;
  const network = resolveNetworkPolicy(env);
  const persistLogTailInContext = env.CORE_DOCKER_PERSIST_LOG_TAIL ?? true;

  return {
    enabled,
    workspaceRoot,
    imageAllowList,
    imageDenyList,
    maxWorkspaceBytes,
    gpuEnabled,
    network,
    persistLogTailInContext,
  } satisfies DockerRuntimeConfig;
}

export function getDockerRuntimeConfig(): DockerRuntimeConfig {
  if (!cachedConfig) {
    cachedConfig = buildConfig();
  }
  return cachedConfig;
}

export function clearDockerRuntimeConfigCache(): void {
  cachedConfig = null;
}

export function isDockerRuntimeEnabled(): boolean {
  return getDockerRuntimeConfig().enabled;
}

export function evaluateDockerImagePolicy(image: string, config: DockerRuntimeConfig = getDockerRuntimeConfig()): {
  allowed: boolean;
  matchedPattern: DockerImagePattern | null;
  reason: string | null;
} {
  const normalized = image.trim();
  if (!normalized) {
    return {
      allowed: false,
      matchedPattern: null,
      reason: 'Docker image reference must be non-empty',
    };
  }

  for (const pattern of config.imageDenyList) {
    if (pattern.regex.test(normalized)) {
      return {
        allowed: false,
        matchedPattern: pattern,
        reason: `Docker image ${normalized} matches deny pattern ${pattern.pattern}`,
      };
    }
  }

  if (config.imageAllowList.length > 0) {
    for (const pattern of config.imageAllowList) {
      if (pattern.regex.test(normalized)) {
        return { allowed: true, matchedPattern: pattern, reason: null };
      }
    }
    return {
      allowed: false,
      matchedPattern: null,
      reason: `Docker image ${normalized} does not match any allow pattern`,
    };
  }

  return { allowed: true, matchedPattern: null, reason: null };
}
