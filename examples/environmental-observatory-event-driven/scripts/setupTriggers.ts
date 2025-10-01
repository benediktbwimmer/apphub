import { loadObservatoryConfig } from '../shared/config';
import { synchronizeObservatoryWorkflowsAndTriggers } from './lib/workflows';

async function main(): Promise<void> {
  const config = loadObservatoryConfig();
  const coreToken =
    config.core?.apiToken ??
    process.env.OBSERVATORY_CORE_TOKEN ??
    process.env.APPHUB_OPERATOR_TOKEN ??
    process.env.APPHUB_CORE_TOKEN ??
    process.env.CORE_API_TOKEN ??
    'dev-token';
  await synchronizeObservatoryWorkflowsAndTriggers({
    config,
    coreToken
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
