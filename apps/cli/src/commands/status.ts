import { Command } from 'commander';
import { resolveCoreUrl } from '../lib/core';

type StreamingOverallState = 'disabled' | 'ready' | 'degraded' | 'unconfigured';

interface StreamingBrokerStatus {
  configured: boolean;
  reachable: boolean | null;
  lastCheckedAt: string | null;
  error: string | null;
}

interface StreamingBatcherConnectorStatus {
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

interface StreamingBatcherStatusSummary {
  configured: number;
  running: number;
  failing: number;
  state: 'disabled' | 'ready' | 'degraded';
  connectors: StreamingBatcherConnectorStatus[];
}

interface StreamingHotBufferStatus {
  enabled: boolean;
  state: 'disabled' | 'ready' | 'unavailable';
  datasets: number;
  healthy: boolean;
  lastRefreshAt: string | null;
  lastIngestAt: string | null;
}

interface StreamingStatus {
  enabled: boolean;
  state: StreamingOverallState;
  reason: string | null;
  broker: StreamingBrokerStatus;
  batchers: StreamingBatcherStatusSummary;
  hotBuffer: StreamingHotBufferStatus;
}

interface HealthPayload {
  status: string;
  warnings?: string[];
  features?: {
    streaming?: StreamingStatus;
  };
}

async function fetchHealth(coreUrl: string): Promise<{ statusCode: number; payload: HealthPayload | null }> {
  const url = `${coreUrl.replace(/\/+$/, '')}/health`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/json'
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to contact core health endpoint at ${url}: ${message}`);
  }

  if (response.status === 204) {
    return { statusCode: response.status, payload: null };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { statusCode: response.status, payload: null };
  }

  try {
    const body = (await response.json()) as HealthPayload;
    return { statusCode: response.status, payload: body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse JSON response from ${url}: ${message}`);
  }
}

function renderHealth(payload: HealthPayload | null, statusCode: number): void {
  if (!payload) {
    console.log(`Core health responded with status ${statusCode}, no JSON payload.`);
    return;
  }

  console.log(`Core health status: ${payload.status} (HTTP ${statusCode})`);
  if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of payload.warnings) {
      console.log(`  - ${warning}`);
    }
  }

  const streaming = payload.features?.streaming;
  if (streaming) {
    const stateLabel = streaming.enabled ? streaming.state : 'disabled';
    console.log(`Streaming: ${stateLabel}`);
    if (streaming.reason) {
      console.log(`  reason: ${streaming.reason}`);
    }

    if (!streaming.broker.configured) {
      console.log('  broker: not-configured');
    } else {
      const brokerState = streaming.broker.reachable === true
        ? 'reachable'
        : streaming.broker.reachable === false
          ? 'unreachable'
          : 'unknown';
      console.log(`  broker: ${brokerState}`);
    }

    if (streaming.batchers.state === 'disabled') {
      console.log('  batchers: disabled');
    } else {
      console.log(
        `  batchers: ${streaming.batchers.running}/${Math.max(streaming.batchers.configured, streaming.batchers.connectors.length)} running`
      );
      const problematic = streaming.batchers.connectors.filter((connector) => connector.state !== 'running');
      if (problematic.length > 0) {
        console.log('    connectors:');
        for (const connector of problematic) {
          const info: string[] = [`state=${connector.state}`];
          if (connector.lastError) {
            info.push(`error=${connector.lastError}`);
          }
          console.log(`      - ${connector.connectorId} (${connector.datasetSlug}): ${info.join(', ')}`);
        }
      }
    }

    if (!streaming.hotBuffer.enabled) {
      console.log('  hot-buffer: disabled');
    } else {
      console.log(`  hot-buffer: ${streaming.hotBuffer.state} (datasets=${streaming.hotBuffer.datasets})`);
    }
  }
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Display core health and streaming feature status')
    .option('--core-url <url>', 'Override the Core API base URL')
    .action(async (options: { coreUrl?: string }) => {
      const coreUrl = resolveCoreUrl(options.coreUrl);
      const { statusCode, payload } = await fetchHealth(coreUrl);
      renderHealth(payload, statusCode);
      if (statusCode >= 500) {
        process.exitCode = 1;
      }
    });
}
