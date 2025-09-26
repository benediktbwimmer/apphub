import { closePool, getClient } from '../db/client';
import { runMigrations } from '../db/migrations';

export async function run(): Promise<void> {
  const client = await getClient();
  try {
    await runMigrations(client);
  } finally {
    client.release();
  }
}

if (require.main === module) {
  run()
    .then(() => closePool())
    .catch((err) => {
      console.error('[metastore:migrate] failed to run migrations', err);
      closePool().finally(() => process.exit(1));
    });
}
