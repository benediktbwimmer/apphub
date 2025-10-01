import { loadObservatoryConfig } from '../shared/config';
import { synchronizeObservatoryWorkflowsAndTriggers } from './lib/workflows';

async function main(): Promise<void> {
  const config = loadObservatoryConfig();
  await synchronizeObservatoryWorkflowsAndTriggers({
    config,
    coreToken: config.core?.apiToken ?? ''
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
