import { runE2E } from '../helpers';
import { startExternalStack } from './stack';
import { prepareObservatoryExample, type ObservatoryContext } from './observatory';
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


async function runSmoke(): Promise<void> {
  log('Starting smoke workflow');
  await waitForServiceHealth('core', `${CORE_BASE_URL}/health`);
  await waitForServiceHealth('metastore', `${METASTORE_BASE_URL}/health`);
  await waitForServiceHealth('timestore', `${TIMESTORE_BASE_URL}/health`);
  await waitForServiceHealth('filestore', `${FILESTORE_BASE_URL}/health`);

  log('Preparing observatory example deployment');
  const observatory = await prepareObservatoryExample();
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
