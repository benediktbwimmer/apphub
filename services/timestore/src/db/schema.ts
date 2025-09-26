import { withConnection } from './client';

function quoteIdentifier(input: string): string {
  return `"${input.replace(/"/g, '""')}"`;
}

export async function ensureSchemaExists(schemaName: string): Promise<void> {
  await withConnection(async (client) => {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schemaName)}`);
  }, { setSearchPath: false });
}
