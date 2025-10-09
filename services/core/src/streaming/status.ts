import type { FeatureFlags } from '../config/featureFlags';
import { getServiceBySlug } from '../db';
import { fetchFromService } from '../clients/serviceClient';
import {
  getMirrorDiagnostics,
  isKafkaPublisherConfigured
} from './kafkaPublisher';
import {
  getEventSchedulerSourceMetrics,
  type EventSchedulerSourceMetrics
} from '../eventSchedulerMetrics';

let readMirrorDiagnostics = getMirrorDiagnostics;
let readKafkaConfigured = isKafkaPublisherConfigured;
let readSourceMetrics = getEventSchedulerSourceMetrics;

export type StreamingOverallState = 'disabled' | 'ready' | 'degraded' | 'unconfigured';

export interface StreamingBrokerStatus {
  configured: boolean;
  reachable: boolean | null;
  lastCheckedAt: string | null;
  error: string | null;
}

export interface StreamingBatcherConnectorStatus {
  connectorId: string;
  datasetSlug: string;
  topic: string;
  groupId: string;
  state: 'starting' | 'running' | 'stopped' | 'error';
  bufferedWindows: number;
  bufferedRows: number;
  openWindows: number;
  lastMessageAt: string | null;
  lastFlushAt: string | null;
  lastEventTimestamp: string | null;
  lastError: string | null;
}

export interface StreamingBatcherStatusSummary {
  configured: number;
  running: number;
  failing: number;
  state: 'disabled' | 'ready' | 'degraded';
  connectors: StreamingBatcherConnectorStatus[];
}

export interface StreamingHotBufferStatus {
  enabled: boolean;
  state: 'disabled' | 'ready' | 'unavailable';
  datasets: number;
  healthy: boolean;
  lastRefreshAt: string | null;
  lastIngestAt: string | null;
}

export interface StreamingStatus {
  enabled: boolean;
  state: StreamingOverallState;
  reason: string | null;
  broker: StreamingBrokerStatus;
  batchers: StreamingBatcherStatusSummary;
  hotBuffer: StreamingHotBufferStatus;
  mirrors?: FeatureFlags['streaming']['mirrors'];
  publisher?: StreamingMirrorPublisherStatus;
}

export interface StreamingMirrorPublisherStatus {
  configured: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError: string | null;
  broker: {
    url: string | null;
  };
  topics: StreamingMirrorTopicDiagnostics[];
  sources: StreamingMirrorSourceDiagnostics[];
  summary: StreamingMirrorSummary;
}

export interface StreamingMirrorTopicDiagnostics {
  topic: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError: string | null;
}

export interface StreamingMirrorSourceDiagnostics {
  source: string;
  total: number;
  throttled: number;
  dropped: number;
  failures: number;
  averageLagMs: number | null;
  lastLagMs: number;
  maxLagMs: number;
  lastEventAt: string | null;
}

export interface StreamingMirrorSummary {
  totalEvents: number;
  totalThrottled: number;
  totalDropped: number;
  totalFailures: number;
}

function createFallbackStatus(
  options: {
    enabled: boolean;
    state: StreamingOverallState;
    reason: string | null;
    brokerConfigured: boolean;
    mirrors: FeatureFlags['streaming']['mirrors'];
    publisher?: StreamingMirrorPublisherStatus;
  }
): StreamingStatus {
  const { enabled, state, reason, brokerConfigured, mirrors, publisher } = options;
  const batcherState: StreamingBatcherStatusSummary['state'] = !enabled || !brokerConfigured
    ? 'disabled'
    : 'degraded';

  const hotBuffer: StreamingHotBufferStatus = enabled
    ? {
        enabled: true,
        state: 'unavailable',
        datasets: 0,
        healthy: false,
        lastRefreshAt: null,
        lastIngestAt: null
      }
    : {
        enabled: false,
        state: 'disabled',
        datasets: 0,
        healthy: true,
        lastRefreshAt: null,
        lastIngestAt: null
      };

  return {
    enabled,
    state,
    reason,
    broker: {
      configured: brokerConfigured,
      reachable: brokerConfigured ? null : null,
      lastCheckedAt: null,
      error: reason
    },
    batchers: {
      configured: 0,
      running: 0,
      failing: 0,
      state: batcherState,
      connectors: []
    },
    hotBuffer,
    mirrors,
    publisher
  } satisfies StreamingStatus;
}

export async function evaluateStreamingStatus(flags: FeatureFlags): Promise<StreamingStatus> {
  const publisherStatus = await buildPublisherStatus();

  if (!flags.streaming.enabled) {
    return createFallbackStatus({
      enabled: false,
      state: 'disabled',
      reason: null,
      brokerConfigured: false,
      mirrors: flags.streaming.mirrors,
      publisher: publisherStatus
    });
  }

  const brokerUrl = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim();
  const brokerConfigured = brokerUrl.length > 0;

  if (!brokerConfigured) {
    return createFallbackStatus({
      enabled: true,
      state: 'unconfigured',
      reason: 'APPHUB_STREAM_BROKER_URL is not set',
      brokerConfigured: false,
      mirrors: flags.streaming.mirrors,
      publisher: publisherStatus
    });
  }

  try {
    const service = await getServiceBySlug('timestore');
    if (!service) {
      throw new Error('Timestore service is not registered');
    }

    const { response } = await fetchFromService(service, '/streaming/status', {
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`timestore returned HTTP ${response.status}`);
    }

    const payload = (await response.json()) as StreamingStatus;
    return {
      ...payload,
      mirrors: flags.streaming.mirrors,
      publisher: publisherStatus
    } satisfies StreamingStatus;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFallbackStatus({
      enabled: true,
      state: 'degraded',
      reason: `Failed to fetch streaming status: ${message}`,
      brokerConfigured: true,
      mirrors: flags.streaming.mirrors,
      publisher: publisherStatus
    });
  }
}

async function buildPublisherStatus(): Promise<StreamingMirrorPublisherStatus> {
  const diagnostics = readMirrorDiagnostics();
  const brokerUrl = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim() || null;
  const merged = mergeDiagnostics(diagnostics);
  const sources = await readSourceMetrics();

  const topicDiagnostics = Object.values(diagnostics)
    .map((entry) => ({
      topic: entry.topic,
      lastSuccessAt: entry.lastSuccessAt,
      lastFailureAt: entry.lastFailureAt,
      failureCount: entry.failureCount,
      lastError: entry.lastError ?? null
    }) satisfies StreamingMirrorTopicDiagnostics)
    .sort((a, b) => a.topic.localeCompare(b.topic));

  const sourceDiagnostics: StreamingMirrorSourceDiagnostics[] = sources.map(
    (source) => ({
      source: source.source,
      total: source.total,
      throttled: source.throttled,
      dropped: source.dropped,
      failures: source.failures,
      averageLagMs: source.averageLagMs,
      lastLagMs: source.lastLagMs,
      maxLagMs: source.maxLagMs,
      lastEventAt: source.lastEventAt
    })
  );

  const summary = sourceDiagnostics.reduce<StreamingMirrorSummary>(
    (acc, source) => {
      acc.totalEvents += source.total;
      acc.totalThrottled += source.throttled;
      acc.totalDropped += source.dropped;
      acc.totalFailures += source.failures;
      return acc;
    },
    { totalEvents: 0, totalThrottled: 0, totalDropped: 0, totalFailures: 0 }
  );

  return {
    configured: readKafkaConfigured(),
    lastSuccessAt: merged.lastSuccessAt,
    lastFailureAt: merged.lastFailureAt,
    failureCount: merged.failureCount,
    lastError: merged.lastError,
    broker: {
      url: brokerUrl
    },
    topics: topicDiagnostics,
    sources: sourceDiagnostics,
    summary
  } satisfies StreamingMirrorPublisherStatus;
}

type MirrorDiagnosticsEntry = ReturnType<typeof getMirrorDiagnostics> extends Record<string, infer V> ? V : never;

function mergeDiagnostics(entries: Record<string, MirrorDiagnosticsEntry>): {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureCount: number;
  lastError: string | null;
} {
  let lastSuccessAt: string | null = null;
  let lastFailureAt: string | null = null;
  let failureCount = 0;
  let lastError: string | null = null;

  for (const entry of Object.values(entries)) {
    if (entry.lastSuccessAt && (!lastSuccessAt || entry.lastSuccessAt > lastSuccessAt)) {
      lastSuccessAt = entry.lastSuccessAt;
    }
    if (entry.lastFailureAt && (!lastFailureAt || entry.lastFailureAt > lastFailureAt)) {
      lastFailureAt = entry.lastFailureAt;
      lastError = entry.lastError ?? lastError;
    }
    failureCount += entry.failureCount;
  }

  return { lastSuccessAt, lastFailureAt, failureCount, lastError };
}

export function __setStreamingStatusTestOverrides(overrides?: {
  getMirrorDiagnostics?: typeof getMirrorDiagnostics;
  isKafkaPublisherConfigured?: typeof isKafkaPublisherConfigured;
  getEventSchedulerSourceMetrics?: typeof getEventSchedulerSourceMetrics;
}): void {
  readMirrorDiagnostics = overrides?.getMirrorDiagnostics ?? getMirrorDiagnostics;
  readKafkaConfigured = overrides?.isKafkaPublisherConfigured ?? isKafkaPublisherConfigured;
  readSourceMetrics = overrides?.getEventSchedulerSourceMetrics ?? getEventSchedulerSourceMetrics;
}
