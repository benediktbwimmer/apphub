import type { FeatureFlags } from '../config/featureFlags';
import { getServiceBySlug } from '../db';
import { fetchFromService } from '../clients/serviceClient';

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
}

function createFallbackStatus(
  options: {
    enabled: boolean;
    state: StreamingOverallState;
    reason: string | null;
    brokerConfigured: boolean;
  }
): StreamingStatus {
  const { enabled, state, reason, brokerConfigured } = options;
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
    hotBuffer
  } satisfies StreamingStatus;
}

export async function evaluateStreamingStatus(flags: FeatureFlags): Promise<StreamingStatus> {
  if (!flags.streaming.enabled) {
    return createFallbackStatus({
      enabled: false,
      state: 'disabled',
      reason: null,
      brokerConfigured: false
    });
  }

  const brokerUrl = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim();
  const brokerConfigured = brokerUrl.length > 0;

  if (!brokerConfigured) {
    return createFallbackStatus({
      enabled: true,
      state: 'unconfigured',
      reason: 'APPHUB_STREAM_BROKER_URL is not set',
      brokerConfigured: false
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
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFallbackStatus({
      enabled: true,
      state: 'degraded',
      reason: `Failed to fetch streaming status: ${message}`,
      brokerConfigured: true
    });
  }
}
