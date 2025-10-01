import { runE2E } from '../helpers';
import { startExternalStack } from './stack';
import { startDevRunner } from './devRunner';
import { prepareObservatoryExample, type ObservatoryContext } from './observatory';
import { requestJson, waitForEndpoint } from './httpClient';
import { triggerGeneratorWorkflow } from './flows';
import { verifyFilestoreIngest, verifyMetastore, verifyTimestore } from './verification';

const CORE_BASE_URL = 'http://127.0.0.1:4000';
const METASTORE_BASE_URL = 'http://127.0.0.1:4100';
const TIMESTORE_BASE_URL = 'http://127.0.0.1:4200';
const FILESTORE_BASE_URL = 'http://127.0.0.1:4300';

async function runSmoke(): Promise<void> {
  await waitForEndpoint(`${CORE_BASE_URL}/readyz`);
  await waitForEndpoint(`${METASTORE_BASE_URL}/readyz`);
  await waitForEndpoint(`${TIMESTORE_BASE_URL}/readyz`);
  await waitForEndpoint(`${FILESTORE_BASE_URL}/readyz`);

  const observatory = await prepareObservatoryExample();

  await requestJson(`${CORE_BASE_URL}/openapi.json`, { expectedStatus: 200 });
  await triggerGeneratorWorkflow(observatory);
  await verifyFilestoreIngest(observatory);
  await verifyMetastore();
  await verifyTimestore();
}

runE2E(async (context) => {
  const reuseStack = process.env.APPHUB_E2E_SKIP_STACK === '1';
  const stack = await startExternalStack({ skipContainers: reuseStack });
  if (!reuseStack) {
    context.registerCleanup(() => stack.stop());
  }

  const devRunner = await startDevRunner({ logPrefix: '[dev]' });
  context.registerCleanup(() => devRunner.stop());

  await runSmoke();
}, {
  name: 'apphub-observatory-smoke',
  gracePeriodMs: 2_000
});
