import { withConnection } from './client';
import { runMigrations } from './migrations';

let initialized = false;
let initializing: Promise<void> | null = null;

export async function ensureDatabase(): Promise<void> {
  if (initialized) {
    return;
  }
  if (!initializing) {
    initializing = withConnection(async (client) => {
      await client.query(`SET TIME ZONE 'UTC'`);
      await runMigrations(client);
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
