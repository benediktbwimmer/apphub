process.env.APPHUB_ALLOW_INLINE_MODE = process.env.APPHUB_ALLOW_INLINE_MODE ?? 'true';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'inline';
process.env.TIMESTORE_CLICKHOUSE_HOST = process.env.TIMESTORE_CLICKHOUSE_HOST ?? 'inline';
process.env.TIMESTORE_CLICKHOUSE_HTTP_PORT = process.env.TIMESTORE_CLICKHOUSE_HTTP_PORT ?? '8123';
process.env.TIMESTORE_CLICKHOUSE_NATIVE_PORT = process.env.TIMESTORE_CLICKHOUSE_NATIVE_PORT ?? '9000';
process.env.TIMESTORE_CLICKHOUSE_USER = process.env.TIMESTORE_CLICKHOUSE_USER ?? 'apphub';
process.env.TIMESTORE_CLICKHOUSE_PASSWORD = process.env.TIMESTORE_CLICKHOUSE_PASSWORD ?? 'apphub';
process.env.TIMESTORE_CLICKHOUSE_DATABASE = process.env.TIMESTORE_CLICKHOUSE_DATABASE ?? 'apphub';
process.env.TIMESTORE_CLICKHOUSE_MOCK = process.env.TIMESTORE_CLICKHOUSE_MOCK ?? 'true';

import { after, afterEach } from 'node:test';
import { killPort, listActiveChildProcesses } from './utils/processProbes';
import { stopAllEmbeddedPostgres } from './utils/embeddedPostgres';
import { resetClickHouseMockStore } from '../src/clickhouse/mockStore';

afterEach(async () => {
  await killPort(5432);
  resetClickHouseMockStore();
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
  await stopAllEmbeddedPostgres();
});
