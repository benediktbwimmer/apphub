import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseSchemaDefinitionPayload } from '../schemas/schemaRegistry';
import { ensureSchemaReady, closePool } from '../db/client';
import { registerSchemaDefinition } from '../schemaRegistry/service';

function usage(): void {
  console.error('Usage: tsx src/scripts/registerSchema.ts <schema-definition.json>');
}

async function loadSchemaDefinition(filePath: string) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const contents = await readFile(resolved, 'utf8');
  const parsed = JSON.parse(contents);
  return parseSchemaDefinitionPayload(parsed);
}

async function main(): Promise<void> {
  const [, , filePath] = process.argv;
  if (!filePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    await ensureSchemaReady();
    const payload = await loadSchemaDefinition(filePath);
    const result = await registerSchemaDefinition(payload);
    console.log(JSON.stringify({ created: result.created, schema: result.definition }, null, 2));
  } catch (err) {
    console.error('[schema:register] Failed to register schema definition:', err);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

main().catch((err) => {
  console.error('[schema:register] Unexpected error:', err);
  process.exit(1);
});
