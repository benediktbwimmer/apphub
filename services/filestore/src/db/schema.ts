import { withConnection } from './client';

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

export async function ensureSchemaExists(schemaName: string): Promise<void> {
  await withConnection(async (client) => {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
  }, { setSearchPath: false });
}
