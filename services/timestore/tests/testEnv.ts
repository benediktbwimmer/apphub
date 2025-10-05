process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'inline';
process.env.TIMESTORE_STAGING_FLUSH_MAX_ROWS = process.env.TIMESTORE_STAGING_FLUSH_MAX_ROWS ?? '1';
process.env.TIMESTORE_STAGING_FLUSH_MAX_BYTES = process.env.TIMESTORE_STAGING_FLUSH_MAX_BYTES ?? '0';
process.env.TIMESTORE_STAGING_FLUSH_MAX_AGE_MS = process.env.TIMESTORE_STAGING_FLUSH_MAX_AGE_MS ?? '0';

import { after, afterEach } from 'node:test';
import { resetStagingWriteManager } from '../src/ingestion/stagingManager';
import { killPort, listActiveChildProcesses } from './utils/processProbes';
import { stopAllEmbeddedPostgres } from './utils/embeddedPostgres';

afterEach(async () => {
  await resetStagingWriteManager();
  await killPort(5432);
});

after(async () => {
  const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.();
  if (handles && handles.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[timestore:testEnv] active handles before shutdown', handles);
  }
  const children = listActiveChildProcesses();
  if (children.length > 0) {
    // eslint-disable-next-line no-console
    console.log('[timestore:testEnv] terminating child processes', children);
    for (const child of children) {
      try {
        child.kill('SIGKILL');
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[timestore:testEnv] failed killing child', error);
      }
    }
  }
  await resetStagingWriteManager();
  await stopAllEmbeddedPostgres();
});
