import { loadServiceConfig } from '../config/serviceConfig';
import { initializeReconciliationManager, shutdownReconciliationManager } from './manager';

async function main() {
  const config = loadServiceConfig();
  await initializeReconciliationManager({ config });
  console.log(
    `[filestore:reconcile] worker running (queue: ${config.reconciliation.queueName}, concurrency: ${config.reconciliation.queueConcurrency})`
  );

  const shutdown = async (signal: NodeJS.Signals | 'UNKNOWN') => {
    console.log(`[filestore:reconcile] shutting down (${signal})`);
    try {
      await shutdownReconciliationManager();
    } catch (err) {
      console.error('[filestore:reconcile] failed to shutdown manager', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('uncaughtException', async (err) => {
    console.error('[filestore:reconcile] uncaught exception', err);
    await shutdown('UNKNOWN');
  });
  process.on('unhandledRejection', async (reason) => {
    console.error('[filestore:reconcile] unhandled rejection', reason);
    await shutdown('UNKNOWN');
  });
}

void main().catch((err) => {
  console.error('[filestore:reconcile] fatal error during startup', err);
  void shutdownReconciliationManager().finally(() => {
    process.exit(1);
  });
});
