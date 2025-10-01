import { withConnection } from './client';
import { runMigrations } from './migrations';

const ADVISORY_LOCK_NAMESPACE = 0x61707068; // 'apph'
const ADVISORY_LOCK_ID = 0x63617467; // 'catg'

let initialized = false;
let initializing: Promise<void> | null = null;

export async function ensureDatabase(): Promise<void> {
  if (initialized) {
    return;
  }
  if (!initializing) {
    initializing = withConnection(async (client) => {
      await client.query(`SET TIME ZONE 'UTC'`);
      await client.query('SELECT pg_advisory_lock($1, $2)', [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID]);
      try {
        await runMigrations(client);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID]);
      }
      initialized = true;
    }).finally(() => {
      initializing = null;
    });
  }
  await initializing;
}

export function markDatabaseUninitialized() {
  initialized = false;
  initializing = null;
}
