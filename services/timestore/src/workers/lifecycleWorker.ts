import { loadServiceConfig } from '../config/serviceConfig';
import { closePool, POSTGRES_SCHEMA } from '../db/client';
import { ensureSchemaExists } from '../db/schema';
import { runMigrations } from '../db/migrations';

async function main(): Promise<void> {
  const config = loadServiceConfig();
  console.log('[timestore:lifecycle] starting');
  console.log(`[timestore:lifecycle] storage driver: ${config.storage.driver}`);
  await ensureSchemaExists(POSTGRES_SCHEMA);
  await runMigrations();
  console.log('[timestore:lifecycle] postgres schema ready');
  process.stdin.resume();
}

main().catch((err) => {
  console.error('[timestore:lifecycle] failed to start', err);
  closePool()
    .catch((closeErr) => {
      console.error('[timestore:lifecycle] failed to close pool during error handling', closeErr);
    })
    .finally(() => {
      process.exit(1);
    });
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    closePool()
      .catch((err) => {
        console.error('[timestore:lifecycle] failed to close pool', err);
      })
      .finally(() => {
        process.exit(0);
      });
  });
}
