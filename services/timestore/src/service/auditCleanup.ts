import type { FastifyBaseLogger } from 'fastify';
import type { ServiceConfig } from '../config/serviceConfig';
import { deleteExpiredDatasetAccessEvents } from '../db/metadata';

interface CleanupOptions {
  config: ServiceConfig;
  logger: FastifyBaseLogger;
}

let cleanupManager: { stop: () => Promise<void> } | null = null;

export async function initializeDatasetAccessCleanup({ config, logger }: CleanupOptions): Promise<void> {
  if (cleanupManager) {
    await cleanupManager.stop().catch(() => undefined);
    cleanupManager = null;
  }

  const ttlMs = Math.max(1, config.auditLog.ttlHours) * 60 * 60 * 1000;
  const intervalMs = Math.max(1, config.auditLog.cleanupIntervalSeconds) * 1000;
  const batchSize = Math.max(1, config.auditLog.deleteBatchSize);

  let runningCleanup: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const runCleanup = () => {
    if (runningCleanup) {
      return runningCleanup;
    }
    const cutoffIso = new Date(Date.now() - ttlMs).toISOString();
    runningCleanup = (async () => {
      let totalDeleted = 0;
      try {
        for (;;) {
          // prune in batches to avoid long-running transactions
          const deleted = await deleteExpiredDatasetAccessEvents(cutoffIso, batchSize);
          if (deleted <= 0) {
            break;
          }
          totalDeleted += deleted;
          if (deleted < batchSize) {
            break;
          }
          if (stopped) {
            break;
          }
        }
        if (totalDeleted > 0) {
          logger.info(
            { deleted: totalDeleted, cutoff: cutoffIso },
            '[timestore:audit] pruned dataset access audit events'
          );
        }
      } catch (err) {
        logger.error({ err }, '[timestore:audit] failed to prune dataset access audit events');
      } finally {
        runningCleanup = null;
      }
    })();
    return runningCleanup;
  };

  timer = setInterval(() => {
    if (!stopped) {
      void runCleanup();
    }
  }, intervalMs);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  cleanupManager = {
    stop: async () => {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (runningCleanup) {
        try {
          await runningCleanup;
        } catch {
          // already logged
        }
      }
    }
  };

  // perform an initial cleanup asynchronously
  void runCleanup();
}

export async function shutdownDatasetAccessCleanup(): Promise<void> {
  if (!cleanupManager) {
    return;
  }
  const current = cleanupManager;
  cleanupManager = null;
  await current.stop();
}
