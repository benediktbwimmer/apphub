import os from 'node:os';
import path from 'node:path';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

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
};

let cachedConfig: DockerRuntimeConfig | null = null;

function parseBoolean(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }
  return defaultValue;
}

function parseInteger(value: string | undefined, { defaultValue, allowNull = false }: { defaultValue: number | null; allowNull?: boolean }): number | null {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return defaultValue;
  }
  if (allowNull && (trimmed === '0' || trimmed.toLowerCase() === 'unlimited')) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid numeric value "${value}". Provide a positive integer${allowNull ? ' or 0 to disable the limit' : ''}.`);
  }
  return parsed;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

function parsePatterns(value: string | undefined): DockerImagePattern[] {
  return parseCsv(value).map((entry) => compilePattern(entry));
}

function resolveWorkspaceRoot(): string {
  const configured = process.env.CATALOG_DOCKER_WORKSPACE_ROOT;
  if (configured) {
    const trimmed = configured.trim();
    if (!trimmed) {
      throw new Error('CATALOG_DOCKER_WORKSPACE_ROOT must not be empty when provided');
    }
    const resolved = path.resolve(trimmed);
    if (!path.isAbsolute(resolved)) {
      throw new Error('CATALOG_DOCKER_WORKSPACE_ROOT must be an absolute path');
    }
    return resolved;
  }
  return path.join(os.tmpdir(), 'apphub-docker-workspaces');
}

function resolveNetworkPolicy(): DockerNetworkPolicy {
  const isolationEnabled = parseBoolean(process.env.CATALOG_DOCKER_ENFORCE_NETWORK_ISOLATION, true);
  const defaultModeEnv = process.env.CATALOG_DOCKER_DEFAULT_NETWORK_MODE;
  const defaultMode = defaultModeEnv === 'bridge' ? 'bridge' : 'none';
  const allowModeOverride = parseBoolean(process.env.CATALOG_DOCKER_ALLOW_NETWORK_OVERRIDE, false);
  const allowedModesEnv = parseCsv(process.env.CATALOG_DOCKER_ALLOWED_NETWORK_MODES);

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
      `CATALOG_DOCKER_DEFAULT_NETWORK_MODE is set to "${defaultMode}" but that mode is not in CATALOG_DOCKER_ALLOWED_NETWORK_MODES.`
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

function buildConfig(): DockerRuntimeConfig {
  const enabled = parseBoolean(process.env.CATALOG_ENABLE_DOCKER_JOBS, false);
  const workspaceRoot = resolveWorkspaceRoot();
  const imageAllowList = parsePatterns(process.env.CATALOG_DOCKER_IMAGE_ALLOWLIST);
  const imageDenyList = parsePatterns(process.env.CATALOG_DOCKER_IMAGE_DENYLIST);
  const maxWorkspaceBytes = parseInteger(process.env.CATALOG_DOCKER_MAX_WORKSPACE_BYTES, {
    defaultValue: DEFAULT_MAX_WORKSPACE_BYTES,
    allowNull: true,
  });
  const gpuEnabled = parseBoolean(process.env.CATALOG_DOCKER_ENABLE_GPU, false);
  const network = resolveNetworkPolicy();

  return {
    enabled,
    workspaceRoot,
    imageAllowList,
    imageDenyList,
    maxWorkspaceBytes,
    gpuEnabled,
    network,
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
