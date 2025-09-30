import { withConnection } from './client';

function quoteIdentifier(input: string): string {
  return `"${input.replace(/"/g, '""')}"`;
}

export async function ensureSchemaExists(schemaName: string): Promise<void> {
  await withConnection(async (client) => {
    const lockKey = `timestore:schema:${schemaName}`; // Avoid duplicate CREATE SCHEMA during parallel startup
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
    try {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
    }
  }, { setSearchPath: false });
}
