import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import IORedis, { type Redis } from 'ioredis';
import type {
  BuildRecord,
  IngestionEvent,
  JobDefinitionRecord,
  JobRunRecord,
  LaunchRecord,
  RepositoryRecord,
  ServiceRecord,
  JobBundleRecord,
  JobBundleVersionRecord,
  WorkflowDefinitionRecord,
  WorkflowRunRecord
} from './db/index';
import type { AssetExpiredEventData, AssetProducedEventData } from './assets/types';

type WorkflowAnalyticsStatsEventPayload = {
  workflowId: string;
  slug: string;
  range: { from: string; to: string; key: string };
  totalRuns: number;
  statusCounts: Record<string, number>;
  successRate: number;
  failureRate: number;
  averageDurationMs: number | null;
  failureCategories: { category: string; count: number }[];
};

type WorkflowAnalyticsMetricsPointPayload = {
  bucketStart: string;
  bucketEnd: string;
  totalRuns: number;
  statusCounts: Record<string, number>;
  averageDurationMs: number | null;
  rollingSuccessCount: number;
};

type WorkflowAnalyticsMetricsEventPayload = {
  workflowId: string;
  slug: string;
  range: { from: string; to: string; key: string };
  bucketInterval: string;
  series: WorkflowAnalyticsMetricsPointPayload[];
  bucket: { interval: string; key: string | null };
};

export type ApphubEvent =
  | { type: 'repository.updated'; data: { repository: RepositoryRecord } }
  | { type: 'repository.ingestion-event'; data: { event: IngestionEvent } }
  | { type: 'build.updated'; data: { build: BuildRecord } }
  | { type: 'launch.updated'; data: { launch: LaunchRecord } }
  | { type: 'service.updated'; data: { service: ServiceRecord } }
  | { type: 'job.definition.updated'; data: { job: JobDefinitionRecord } }
  | { type: 'job.run.updated'; data: { run: JobRunRecord } }
  | { type: 'job.run.pending'; data: { run: JobRunRecord } }
  | { type: 'job.run.running'; data: { run: JobRunRecord } }
  | { type: 'job.run.succeeded'; data: { run: JobRunRecord } }
  | { type: 'job.run.failed'; data: { run: JobRunRecord } }
  | { type: 'job.run.canceled'; data: { run: JobRunRecord } }
  | { type: 'job.run.expired'; data: { run: JobRunRecord } }
  | { type: 'job.bundle.published'; data: { bundle: JobBundleRecord; version: JobBundleVersionRecord } }
  | { type: 'job.bundle.updated'; data: { bundle: JobBundleRecord; version: JobBundleVersionRecord } }
  | { type: 'job.bundle.deprecated'; data: { bundle: JobBundleRecord; version: JobBundleVersionRecord } }
  | { type: 'workflow.definition.updated'; data: { workflow: WorkflowDefinitionRecord } }
  | { type: 'workflow.run.updated'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.pending'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.running'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.succeeded'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.failed'; data: { run: WorkflowRunRecord } }
  | { type: 'workflow.run.canceled'; data: { run: WorkflowRunRecord } }
  | { type: 'asset.produced'; data: AssetProducedEventData }
  | { type: 'asset.expired'; data: AssetExpiredEventData }
  | {
      type: 'workflow.analytics.snapshot';
      data: {
        slug: string;
        stats: WorkflowAnalyticsStatsEventPayload;
        metrics: WorkflowAnalyticsMetricsEventPayload;
      };
    };

type EventEnvelope = {
  origin: string;
  event: ApphubEvent;
};

const analyticsIntervalEnv = Number(process.env.APPHUB_ANALYTICS_INTERVAL_MS ?? '30000');
const ANALYTICS_INTERVAL_MS =
  Number.isFinite(analyticsIntervalEnv) && analyticsIntervalEnv > 0
    ? analyticsIntervalEnv
    : 30_000;
const ANALYTICS_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const ANALYTICS_RANGE_KEY = '7d';
const ANALYTICS_BUCKET_INTERVAL = '1 hour';
const ANALYTICS_BUCKET_KEY = 'hour';

const bus = new EventEmitter();
bus.setMaxListeners(0);

const configuredMode = process.env.APPHUB_EVENTS_MODE;
const envRedisUrl = process.env.REDIS_URL;

let inlineMode: boolean;
if (configuredMode === 'inline') {
  inlineMode = true;
} else if (configuredMode === 'redis') {
  inlineMode = false;
} else {
  inlineMode = envRedisUrl === 'inline';
}

const redisUrl = inlineMode ? null : envRedisUrl ?? 'redis://127.0.0.1:6379';
const eventChannel = process.env.APPHUB_EVENTS_CHANNEL ?? 'apphub:events';
const originId = `${process.pid}:${randomUUID()}`;

function envFlagEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const analyticsDisabled = envFlagEnabled(process.env.APPHUB_DISABLE_ANALYTICS);

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let redisFailureNotified = false;
let analyticsTimer: NodeJS.Timeout | null = null;
let analyticsRunning = false;

type WorkflowAnalyticsModule = Pick<
  typeof import('./db/workflows'),
  'listWorkflowDefinitions' | 'getWorkflowRunStatsBySlug' | 'getWorkflowRunMetricsBySlug'
>;

let workflowAnalyticsModule: Promise<WorkflowAnalyticsModule> | null = null;

async function loadWorkflowAnalyticsModule(): Promise<WorkflowAnalyticsModule> {
  if (!workflowAnalyticsModule) {
    workflowAnalyticsModule = import('./db/workflows').then((module) => {
      const { listWorkflowDefinitions, getWorkflowRunStatsBySlug, getWorkflowRunMetricsBySlug } = module;
      if (
        typeof listWorkflowDefinitions !== 'function' ||
        typeof getWorkflowRunStatsBySlug !== 'function' ||
        typeof getWorkflowRunMetricsBySlug !== 'function'
      ) {
        throw new Error('Workflow analytics exports are unavailable');
      }
      return {
        listWorkflowDefinitions,
        getWorkflowRunStatsBySlug,
        getWorkflowRunMetricsBySlug
      };
    });
  }
  return workflowAnalyticsModule;
}

function disableRedisEvents(reason: string) {
  if (inlineMode) {
    return;
  }
  inlineMode = true;
  if (!redisFailureNotified) {
    console.warn(`[events] Falling back to inline mode: ${reason}`);
    redisFailureNotified = true;
  }
  if (publisher) {
    publisher.removeAllListeners();
    publisher.quit().catch(() => undefined);
    publisher = null;
  }
  if (subscriber) {
    subscriber.removeAllListeners();
    subscriber.quit().catch(() => undefined);
    subscriber = null;
  }
}

if (!inlineMode && redisUrl) {
  const connectionOptions = { maxRetriesPerRequest: null } as const;

  publisher = new IORedis(redisUrl, connectionOptions);
  publisher.on('error', (err) => {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
      disableRedisEvents('Redis unavailable');
      return;
    }
    console.error('[events] Redis publish error', err);
  });

  subscriber = new IORedis(redisUrl, connectionOptions);
  subscriber.on('error', (err) => {
    const code = (err as { code?: string }).code;
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ECONNREFUSED' || message.includes('ECONNREFUSED')) {
      disableRedisEvents('Redis unavailable');
      return;
    }
    console.error('[events] Redis subscribe error', err);
  });

  subscriber
    .subscribe(eventChannel)
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      disableRedisEvents(`Failed to subscribe to Redis channel: ${message}`);
    });

  subscriber.on('message', (_channel, payload) => {
    if (inlineMode) {
      return;
    }
    try {
      const envelope = JSON.parse(payload) as Partial<EventEnvelope>;
      if (!envelope || !envelope.event) {
        return;
      }
      if (envelope.origin === originId) {
        return;
      }
      bus.emit('apphub:event', envelope.event);
    } catch (err) {
      console.error('[events] Failed to parse published event', err);
    }
  });
} else {
  inlineMode = true;
}

export function emitApphubEvent(event: ApphubEvent) {
  bus.emit('apphub:event', event);

  if (inlineMode || !publisher) {
    return;
  }

  const payload: EventEnvelope = { origin: originId, event };
  publisher.publish(eventChannel, JSON.stringify(payload)).catch((err) => {
    console.error('[events] Failed to publish event', err);
  });
}

export function subscribeToApphubEvents(listener: (event: ApphubEvent) => void) {
  bus.on('apphub:event', listener);
  return () => bus.off('apphub:event', listener);
}

export function onceApphubEvent(listener: (event: ApphubEvent) => void) {
  bus.once('apphub:event', listener);
}

function bucketKeyFromInterval(interval: string): string | null {
  switch (interval) {
    case '15 minutes':
      return '15m';
    case '1 hour':
      return 'hour';
    case '1 day':
      return 'day';
    default:
      return null;
  }
}

async function publishAnalyticsSnapshotForWorkflow(
  slug: string,
  now: Date,
  analytics: WorkflowAnalyticsModule
) {
  if (analyticsDisabled) {
    return;
  }
  try {
    const from = new Date(now.getTime() - ANALYTICS_RANGE_MS);
    const [stats, metrics] = await Promise.all([
      analytics.getWorkflowRunStatsBySlug(slug, { from, to: now }),
      analytics.getWorkflowRunMetricsBySlug(slug, {
        from,
        to: now,
        bucketInterval: ANALYTICS_BUCKET_INTERVAL
      })
    ]);

    const statsPayload: WorkflowAnalyticsStatsEventPayload = {
      workflowId: stats.workflowId,
      slug: stats.slug,
      range: {
        from: stats.range.from.toISOString(),
        to: stats.range.to.toISOString(),
        key: ANALYTICS_RANGE_KEY
      },
      totalRuns: stats.totalRuns,
      statusCounts: { ...stats.statusCounts },
      successRate: stats.successRate,
      failureRate: stats.failureRate,
      averageDurationMs: stats.averageDurationMs,
      failureCategories: stats.failureCategories.map((entry) => ({
        category: entry.category,
        count: entry.count
      }))
    };

    const metricsBucketKey = bucketKeyFromInterval(metrics.bucketInterval) ?? ANALYTICS_BUCKET_KEY;
    const metricsPayload: WorkflowAnalyticsMetricsEventPayload = {
      workflowId: metrics.workflowId,
      slug: metrics.slug,
      range: {
        from: metrics.range.from.toISOString(),
        to: metrics.range.to.toISOString(),
        key: ANALYTICS_RANGE_KEY
      },
      bucketInterval: metrics.bucketInterval,
      bucket: {
        interval: metrics.bucketInterval,
        key: metricsBucketKey
      },
      series: metrics.series.map((point) => ({
        bucketStart: point.bucketStart,
        bucketEnd: point.bucketEnd,
        totalRuns: point.totalRuns,
        statusCounts: { ...point.statusCounts },
        averageDurationMs: point.averageDurationMs,
        rollingSuccessCount: point.rollingSuccessCount
      }))
    };

    emitApphubEvent({
      type: 'workflow.analytics.snapshot',
      data: {
        slug,
        stats: statsPayload,
        metrics: metricsPayload
      }
    });
  } catch (err) {
    console.error(`[events] Failed to compute analytics snapshot for ${slug}`, err);
    throw err;
  }
}

async function publishAnalyticsSnapshots() {
  if (analyticsDisabled) {
    return;
  }
  const analytics = await loadWorkflowAnalyticsModule();
  const workflows = await analytics.listWorkflowDefinitions();
  if (workflows.length === 0) {
    return;
  }
  const now = new Date();
  await Promise.all(
    workflows.map((workflow) => publishAnalyticsSnapshotForWorkflow(workflow.slug, now, analytics))
  );
}

function shouldStopAnalytics(err: unknown): boolean {
  if (!err) {
    return false;
  }
  if (err instanceof Error) {
    const errorWithCode = err as Error & { code?: string };
    if (errorWithCode.code === 'ECONNREFUSED' || errorWithCode.code === '57P01') {
      return true;
    }
    const message = err.message ?? '';
    if (
      message.includes('ECONNREFUSED') ||
      message.includes('terminating connection due to administrator command')
    ) {
      return true;
    }
  }
  return false;
}

export function stopAnalyticsSnapshots() {
  if (analyticsTimer) {
    clearInterval(analyticsTimer);
    analyticsTimer = null;
  }
  analyticsRunning = false;
}

function startAnalyticsSnapshots() {
  if (analyticsDisabled) {
    return;
  }
  if (analyticsTimer || ANALYTICS_INTERVAL_MS <= 0) {
    return;
  }

  const run = async () => {
    if (analyticsRunning) {
      return;
    }
    analyticsRunning = true;
    try {
      await publishAnalyticsSnapshots();
    } catch (err) {
      console.error('[events] Failed to publish analytics snapshots', err);
      if (shouldStopAnalytics(err)) {
        stopAnalyticsSnapshots();
      }
    } finally {
      analyticsRunning = false;
    }
  };

  analyticsTimer = setInterval(() => {
    void run();
  }, ANALYTICS_INTERVAL_MS);
  if (typeof analyticsTimer.unref === 'function') {
    analyticsTimer.unref();
  }

  void run();
}

const scheduleAnalyticsStart: (callback: () => void) => void =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : (callback: () => void) => {
        setTimeout(callback, 0);
      };

scheduleAnalyticsStart(() => {
  try {
    startAnalyticsSnapshots();
  } catch (err) {
    console.error('[events] Failed to start analytics snapshots', err);
  }
});

process.once('beforeExit', () => {
  stopAnalyticsSnapshots();
});

process.once('exit', () => {
  stopAnalyticsSnapshots();
});
