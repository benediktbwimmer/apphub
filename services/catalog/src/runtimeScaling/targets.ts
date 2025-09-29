import { INGEST_QUEUE_NAME, BUILD_QUEUE_NAME, WORKFLOW_QUEUE_NAME, QUEUE_KEYS } from '../queue';

export type RuntimeScalingTargetConfig = {
  key: RuntimeScalingTargetKey;
  queueKey: (typeof QUEUE_KEYS)[keyof typeof QUEUE_KEYS];
  queueName: string;
  displayName: string;
  description: string;
  defaultEnvVar: string;
  defaultConcurrency: number;
  minConcurrency: number;
  maxConcurrency: number;
  rateLimitMs: number;
  stepSize?: number;
};

const DEFAULT_RATE_LIMIT_MS = Number.parseInt(process.env.RUNTIME_SCALING_RATE_LIMIT_MS ?? '30000', 10) || 30000;

const RUNTIME_SCALING_TARGET_KEYS = ['catalog:ingest', 'catalog:build', 'catalog:workflow'] as const;

export type RuntimeScalingTargetKey = typeof RUNTIME_SCALING_TARGET_KEYS[number];

function parseEnvConcurrency(envVar: string, fallback: number): number {
  const value = process.env[envVar];
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  return normalized >= 0 ? normalized : fallback;
}

function withinBounds(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return Math.floor(value);
}

const INGEST_MAX = withinBounds(Number.parseInt(process.env.INGEST_MAX_CONCURRENCY ?? '20', 10) || 20, 1, 100);
const INGEST_DEFAULT = withinBounds(parseEnvConcurrency('INGEST_CONCURRENCY', 2), 0, INGEST_MAX);
const INGEST_RATE_LIMIT = Number.parseInt(process.env.INGEST_SCALING_RATE_LIMIT_MS ?? String(DEFAULT_RATE_LIMIT_MS), 10) || DEFAULT_RATE_LIMIT_MS;

const BUILD_MAX = withinBounds(Number.parseInt(process.env.BUILD_MAX_CONCURRENCY ?? '10', 10) || 10, 1, 100);
const BUILD_DEFAULT = withinBounds(parseEnvConcurrency('BUILD_CONCURRENCY', 1), 0, BUILD_MAX);
const BUILD_RATE_LIMIT = Number.parseInt(process.env.BUILD_SCALING_RATE_LIMIT_MS ?? String(DEFAULT_RATE_LIMIT_MS), 10) || DEFAULT_RATE_LIMIT_MS;

const WORKFLOW_MAX = withinBounds(Number.parseInt(process.env.WORKFLOW_MAX_CONCURRENCY ?? '50', 10) || 50, 1, 200);
const WORKFLOW_DEFAULT = withinBounds(parseEnvConcurrency('WORKFLOW_CONCURRENCY', 1), 0, WORKFLOW_MAX);
const WORKFLOW_RATE_LIMIT = Number.parseInt(process.env.WORKFLOW_SCALING_RATE_LIMIT_MS ?? String(DEFAULT_RATE_LIMIT_MS), 10) || DEFAULT_RATE_LIMIT_MS;

export const RUNTIME_SCALING_TARGETS: Record<RuntimeScalingTargetKey, RuntimeScalingTargetConfig> = {
  'catalog:ingest': {
    key: 'catalog:ingest',
    queueKey: QUEUE_KEYS.ingest,
    queueName: INGEST_QUEUE_NAME,
    displayName: 'Repository ingestion',
    description: 'Controls how many repositories are ingested concurrently.',
    defaultEnvVar: 'INGEST_CONCURRENCY',
    defaultConcurrency: INGEST_DEFAULT,
    minConcurrency: 0,
    maxConcurrency: INGEST_MAX,
    rateLimitMs: INGEST_RATE_LIMIT,
    stepSize: 1
  },
  'catalog:build': {
    key: 'catalog:build',
    queueKey: QUEUE_KEYS.build,
    queueName: BUILD_QUEUE_NAME,
    displayName: 'Build worker',
    description: 'Controls concurrent bundle builds across repositories.',
    defaultEnvVar: 'BUILD_CONCURRENCY',
    defaultConcurrency: BUILD_DEFAULT,
    minConcurrency: 0,
    maxConcurrency: BUILD_MAX,
    rateLimitMs: BUILD_RATE_LIMIT,
    stepSize: 1
  },
  'catalog:workflow': {
    key: 'catalog:workflow',
    queueKey: QUEUE_KEYS.workflow,
    queueName: WORKFLOW_QUEUE_NAME,
    displayName: 'Workflow orchestrator',
    description: 'Controls the number of workflow steps executed in parallel.',
    defaultEnvVar: 'WORKFLOW_CONCURRENCY',
    defaultConcurrency: WORKFLOW_DEFAULT,
    minConcurrency: 0,
    maxConcurrency: WORKFLOW_MAX,
    rateLimitMs: WORKFLOW_RATE_LIMIT,
    stepSize: 1
  }
};

export function getRuntimeScalingTarget(key: RuntimeScalingTargetKey): RuntimeScalingTargetConfig {
  const target = RUNTIME_SCALING_TARGETS[key];
  if (!target) {
    throw new Error(`Unknown runtime scaling target: ${key}`);
  }
  return target;
}

export function listRuntimeScalingTargets(): RuntimeScalingTargetConfig[] {
  return RUNTIME_SCALING_TARGET_KEYS.map((key) => RUNTIME_SCALING_TARGETS[key]);
}

export function clampConcurrency(config: RuntimeScalingTargetConfig, value: number): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(normalized)) {
    return config.minConcurrency;
  }
  if (normalized < config.minConcurrency) {
    return config.minConcurrency;
  }
  if (normalized > config.maxConcurrency) {
    return config.maxConcurrency;
  }
  return normalized;
}
