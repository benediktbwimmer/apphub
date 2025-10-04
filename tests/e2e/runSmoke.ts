import { Kafka } from 'kafkajs';
import { runE2E } from '../helpers';
import { startExternalStack } from './stack';
import { prepareObservatoryModule, type ObservatoryContext } from './observatory';
import { requestJson, waitForEndpoint } from './httpClient';
import { triggerGeneratorWorkflow } from './flows';
import { verifyFilestoreIngest, verifyMetastore, verifyTimestore } from './verification';
import {
  CORE_BASE_URL,
  METASTORE_BASE_URL,
  TIMESTORE_BASE_URL,
  FILESTORE_BASE_URL,
  configureE2EEnvironment
} from './env';

const SERVICE_HEALTH_TIMEOUT_MS = 60_000;

function log(message: string, details?: Record<string, unknown>): void {
  if (details && Object.keys(details).length > 0) {
    console.info(`[smoke] ${message}`, details);
    return;
  }
  console.info(`[smoke] ${message}`);
}

async function waitForServiceHealth(name: string, url: string): Promise<void> {
  log(`Waiting for ${name} at ${url}`);
  await waitForEndpoint(url, { timeoutMs: SERVICE_HEALTH_TIMEOUT_MS });
  log(`Healthy response confirmed from ${name}`, { url });
}

function streamingFlagEnabled(): boolean {
  const raw = (process.env.APPHUB_STREAMING_ENABLED ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

async function verifyStreamingBroker(): Promise<void> {
  if (!streamingFlagEnabled()) {
    log('Streaming flag disabled; skipping broker smoke check');
    return;
  }

  const broker = (process.env.APPHUB_STREAM_BROKER_URL ?? '').trim() || '127.0.0.1:19092';
  const normalizedBroker = (() => {
    const withoutScheme = broker.replace(/^[a-zA-Z]+:\/\//, '');
    if (withoutScheme.startsWith('redpanda')) {
      const hostPort = (process.env.APPHUB_E2E_REDPANDA_PORT ?? '29092').trim();
      return `127.0.0.1:${hostPort}`;
    }
    return withoutScheme;
  })();
  const topic = 'apphub.core.events';
  const payload = `e2e-stream-${Date.now()}`;
  log('Verifying streaming broker', { broker: normalizedBroker, topic });

  const kafka = new Kafka({ clientId: 'apphub-e2e-smoke', brokers: [normalizedBroker] });
  const producer = kafka.producer();
  const consumer = kafka.consumer({ groupId: `apphub-e2e-smoke-${Date.now()}` });

  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topic, fromBeginning: false });

  let settled = false;
  let resolveMessage: () => void = () => {};
  let rejectMessage: (err: Error) => void = () => {};

  const waitForMessage = new Promise<void>((resolve, reject) => {
    resolveMessage = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    rejectMessage = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    setTimeout(() => rejectMessage(new Error('Timed out waiting for streaming round trip')), 5000);
  });

  consumer
    .run({
      eachMessage: async ({ message }) => {
        const value = message.value ? message.value.toString('utf8') : '';
        if (value === payload) {
          resolveMessage();
        }
      }
    })
    .catch((err) => rejectMessage(err));

  await producer.send({ topic, messages: [{ value: payload }] });

  try {
    await waitForMessage;
    log('Streaming broker round-trip succeeded', { topic });
  } finally {
    await consumer.stop().catch(() => {});
    await consumer.disconnect().catch(() => {});
    await producer.disconnect().catch(() => {});
  }
}


async function runSmoke(): Promise<void> {
  log('Starting smoke workflow');
  await waitForServiceHealth('core', `${CORE_BASE_URL}/health`);
  await waitForServiceHealth('metastore', `${METASTORE_BASE_URL}/health`);
  await waitForServiceHealth('timestore', `${TIMESTORE_BASE_URL}/health`);
  await waitForServiceHealth('filestore', `${FILESTORE_BASE_URL}/health`);
  await verifyStreamingBroker();

  log('Preparing observatory module deployment');
  const observatory = await prepareObservatoryModule();
  log('Observatory deployment ready', {
    configPath: observatory.configPath,
    backendMountId: observatory.config.filestore.backendMountId
  });

  log('Fetching core OpenAPI specification');
  await requestJson(`${CORE_BASE_URL}/openapi.json`, { expectedStatus: 200 });
  log('Triggering generator workflow');
  await triggerGeneratorWorkflow(observatory);
  log('Verifying filestore ingest');
  await verifyFilestoreIngest(observatory);
  log('Metastore verification');
  await verifyMetastore();
  log('Timestore verification');
  await verifyTimestore();
  log('Smoke workflow completed successfully');
}

runE2E(async (context) => {
  const reuseStack = process.env.APPHUB_E2E_SKIP_STACK === '1';
  log('Launching external stack', { reuseStack });
  const stack = await startExternalStack({ skipContainers: reuseStack });
  if (!reuseStack) {
    log('Registered stack shutdown handler');
    context.registerCleanup(() => stack.stop());
  }

  const restoreEnv = configureE2EEnvironment();
  log('E2E environment configured');
  context.registerCleanup(() => restoreEnv());

  await runSmoke();
}, {
  name: 'apphub-observatory-smoke',
  gracePeriodMs: 2_000
});
