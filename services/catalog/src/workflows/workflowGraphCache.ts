import { buildWorkflowTopologyGraph } from './workflowGraph';
import { subscribeToApphubEvents, type ApphubEvent } from '../events';
import type { WorkflowTopologyGraph } from '@apphub/shared/workflowTopology';
import type { FastifyBaseLogger } from 'fastify';

const DEFAULT_CACHE_TTL_MS = 30_000;

const ttlEnv = Number(process.env.APPHUB_WORKFLOW_GRAPH_CACHE_TTL_MS ?? DEFAULT_CACHE_TTL_MS);
const CACHE_TTL_MS = Number.isFinite(ttlEnv) && ttlEnv >= 0 ? ttlEnv : DEFAULT_CACHE_TTL_MS;

type Logger = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn'>;
type LogLevel = 'debug' | 'info' | 'warn';

type WorkflowGraphCacheEntry = {
  graph: WorkflowTopologyGraph;
  cachedAt: number;
  expiresAt: number | null;
  generation: number;
};

export type WorkflowGraphCacheMetadata = {
  hit: boolean;
  cachedAt: string | null;
  ageMs: number | null;
  expiresAt: string | null;
  stats: {
    hits: number;
    misses: number;
    invalidations: number;
  };
  lastInvalidatedAt: string | null;
  lastInvalidationReason: string | null;
};

type CacheResult = {
  graph: WorkflowTopologyGraph;
  meta: WorkflowGraphCacheMetadata;
};

let cache: WorkflowGraphCacheEntry | null = null;
let inFlight: Promise<WorkflowGraphCacheEntry> | null = null;
let cacheGeneration = 0;
let cacheHits = 0;
let cacheMisses = 0;
let cacheInvalidations = 0;
let lastInvalidatedAt: number | null = null;
let lastInvalidationReason: string | null = null;
let unsubscribeEvents: (() => void) | null = null;

function log(logger: Logger | undefined, level: LogLevel, message: string, context?: Record<string, unknown>) {
  if (!logger) {
    return;
  }
  const target = logger[level];
  if (typeof target !== 'function') {
    return;
  }
  const details = context && Object.keys(context).length > 0 ? context : undefined;
  if (details) {
    target.call(logger, details, message);
  } else {
    target.call(logger, message);
  }
}

function toIso(timestamp: number | null): string | null {
  if (timestamp === null) {
    return null;
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function buildMeta(hit: boolean, entry: WorkflowGraphCacheEntry | null): WorkflowGraphCacheMetadata {
  const now = Date.now();
  const cachedAt = entry ? toIso(entry.cachedAt) : null;
  const ageMs = entry ? Math.max(0, now - entry.cachedAt) : null;
  const expiresAt = entry && entry.expiresAt ? toIso(entry.expiresAt) : null;
  return {
    hit,
    cachedAt,
    ageMs,
    expiresAt,
    stats: {
      hits: cacheHits,
      misses: cacheMisses,
      invalidations: cacheInvalidations
    },
    lastInvalidatedAt: toIso(lastInvalidatedAt),
    lastInvalidationReason
  };
}

async function rebuildCache(logger?: Logger): Promise<WorkflowGraphCacheEntry> {
  const generation = cacheGeneration;
  const graph = await buildWorkflowTopologyGraph();
  const cachedAt = Date.now();
  const expiresAt = CACHE_TTL_MS > 0 ? cachedAt + CACHE_TTL_MS : null;
  const entry: WorkflowGraphCacheEntry = {
    graph,
    cachedAt,
    expiresAt,
    generation
  };
  if (generation === cacheGeneration) {
    cache = entry;
    log(logger, 'debug', 'Workflow topology graph cache rebuilt', {
      ttlMs: CACHE_TTL_MS,
      generatedAt: graph.generatedAt,
      nodeCounts: {
        workflows: graph.nodes.workflows.length,
        steps: graph.nodes.steps.length,
        triggers: graph.nodes.triggers.length,
        schedules: graph.nodes.schedules.length,
        assets: graph.nodes.assets.length,
        eventSources: graph.nodes.eventSources.length
      }
    });
  } else {
    log(logger, 'debug', 'Discarded stale workflow graph cache rebuild result', {
      generation,
      currentGeneration: cacheGeneration
    });
  }
  return entry;
}

export async function getWorkflowTopologyGraphCached(options: {
  logger?: Logger;
  forceRefresh?: boolean;
} = {}): Promise<CacheResult> {
  const { logger, forceRefresh = false } = options;

  if (forceRefresh) {
    cache = null;
    cacheGeneration += 1;
  }

  const now = Date.now();
  const entry = cache;
  if (entry && (entry.expiresAt === null || entry.expiresAt > now)) {
    cacheHits += 1;
    return { graph: entry.graph, meta: buildMeta(true, entry) };
  }

  cacheMisses += 1;

  if (!inFlight) {
    inFlight = rebuildCache(logger).finally(() => {
      inFlight = null;
    });
  }

  const result = await inFlight;
  const current = cache && cache.generation === result.generation ? cache : result;
  return { graph: current.graph, meta: buildMeta(false, current) };
}

export function invalidateWorkflowTopologyGraphCache(
  reason: string,
  options: { logger?: Logger } = {}
): void {
  const { logger } = options;
  cache = null;
  cacheGeneration += 1;
  cacheInvalidations += 1;
  lastInvalidatedAt = Date.now();
  lastInvalidationReason = reason;
  inFlight = null;
  log(logger, 'debug', 'Workflow topology graph cache invalidated', { reason });
}

function handleEvent(event: ApphubEvent, logger?: Logger) {
  if (event.type === 'workflow.definition.updated') {
    invalidateWorkflowTopologyGraphCache(event.type, { logger });
  }
}

export function initializeWorkflowTopologyGraphCache(options: { logger?: Logger } = {}): () => void {
  const { logger } = options;
  if (unsubscribeEvents) {
    return unsubscribeEvents;
  }
  const unsubscribe = subscribeToApphubEvents((event) => handleEvent(event, logger));
  unsubscribeEvents = () => {
    unsubscribe();
    unsubscribeEvents = null;
  };
  log(logger, 'debug', 'Workflow topology graph cache listeners registered');
  return unsubscribeEvents;
}
