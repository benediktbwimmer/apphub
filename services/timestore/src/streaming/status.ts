import type { ServiceConfig } from '../config/serviceConfig';
import {
  getStreamingBatcherStatus,
  type StreamingBatcherRuntimeStatus
} from './batchers';
import { getStreamingHotBufferStatus, type HotBufferStatus } from './hotBuffer';

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
  state: StreamingBatcherRuntimeStatus['state'];
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

export interface StreamingStatus {
  enabled: boolean;
  state: StreamingOverallState;
  reason: string | null;
  broker: StreamingBrokerStatus;
  batchers: StreamingBatcherStatusSummary;
  hotBuffer: HotBufferStatus;
}

function toIso(ms: number | null): string | null {
  if (!ms) {
    return null;
  }
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function buildBatcherSummary(
  configured: number,
  runtimeStatus: StreamingBatcherRuntimeStatus[]
): StreamingBatcherStatusSummary {
  const connectors: StreamingBatcherConnectorStatus[] = runtimeStatus.map((connector) => ({
    connectorId: connector.connectorId,
    datasetSlug: connector.datasetSlug,
    topic: connector.topic,
    groupId: connector.groupId,
    state: connector.state,
    bufferedWindows: connector.bufferedWindows,
    bufferedRows: connector.bufferedRows,
    openWindows: connector.openWindows,
    lastMessageAt: toIso(connector.lastMessageAtMs),
    lastFlushAt: toIso(connector.lastFlushAtMs),
    lastEventTimestamp: toIso(connector.lastEventTimestampMs),
    lastError: connector.lastError ?? null
  }));

  const running = runtimeStatus.filter((entry) => entry.state === 'running').length;
  const failing = runtimeStatus.filter((entry) => entry.state === 'error').length;

  let state: 'disabled' | 'ready' | 'degraded';
  if (configured === 0) {
    state = 'disabled';
  } else if (runtimeStatus.length === 0) {
    state = 'degraded';
  } else if (runtimeStatus.every((entry) => entry.state === 'running')) {
    state = 'ready';
  } else {
    state = 'degraded';
  }

  return {
    configured,
    running,
    failing,
    state,
    connectors
  } satisfies StreamingBatcherStatusSummary;
}

export function evaluateStreamingStatus(config: ServiceConfig): StreamingStatus {
  const enabled = config.features.streaming.enabled;
  const brokerUrl = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim();
  const brokerConfigured = brokerUrl.length > 0;

  const batcherConfigs = config.streaming.batchers;
  const runtimeBatchers = getStreamingBatcherStatus();
  const batchers = buildBatcherSummary(batcherConfigs.length, runtimeBatchers);

  const hotBuffer = getStreamingHotBufferStatus();
  const hotBufferConfigured = config.streaming.hotBuffer.enabled;

  let overallState: StreamingOverallState = 'disabled';
  const reasons: string[] = [];

  if (!enabled) {
    overallState = 'disabled';
  } else if (!brokerConfigured) {
    overallState = 'unconfigured';
    reasons.push('APPHUB_STREAM_BROKER_URL is not set');
  } else {
    const batcherHealthy = batchers.state === 'ready' || batchers.state === 'disabled';
    const hotBufferHealthy = !hotBufferConfigured || hotBuffer.state === 'ready';

    if (batcherHealthy && hotBufferHealthy) {
      overallState = 'ready';
    } else {
      overallState = 'degraded';
      if (!batcherHealthy) {
        const configuredTotal = Math.max(batcherConfigs.length, runtimeBatchers.length);
        reasons.push(
          configuredTotal > 0
            ? `Streaming micro-batchers degraded (${batchers.running}/${configuredTotal} running)`
            : 'Streaming micro-batchers not configured'
        );
      }
      if (!hotBufferHealthy) {
        reasons.push('Streaming hot buffer unavailable');
      }
    }
  }

  const brokerReachable = (() => {
    if (!brokerConfigured) {
      return null;
    }
    if (runtimeBatchers.some((entry) => entry.state === 'running')) {
      return true;
    }
    if (runtimeBatchers.some((entry) => entry.state === 'error')) {
      return false;
    }
    return null;
  })();

  if (brokerConfigured && brokerReachable === false) {
    reasons.push('Streaming broker unreachable from micro-batchers');
  }

  const brokerError = brokerConfigured
    ? brokerReachable === false
      ? 'broker unreachable'
      : null
    : 'broker not configured';

  const brokerStatus: StreamingBrokerStatus = {
    configured: brokerConfigured,
    reachable: brokerReachable,
    lastCheckedAt: hotBuffer.lastRefreshAt ?? hotBuffer.lastIngestAt,
    error: brokerError
  } satisfies StreamingBrokerStatus;

  const reason = reasons.length > 0 ? reasons[0] ?? null : null;

  return {
    enabled,
    state: overallState,
    reason,
    broker: brokerStatus,
    batchers,
    hotBuffer
  } satisfies StreamingStatus;
}
