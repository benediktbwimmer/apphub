import { Command } from 'commander';
import { resolveCoreUrl } from '../lib/core';

interface StreamingStatus {
  enabled: boolean;
  state: string;
  reason?: string | null;
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
