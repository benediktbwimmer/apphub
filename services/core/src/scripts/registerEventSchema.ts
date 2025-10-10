import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ensureDatabase } from '../db';
import type { JsonValue } from '../db/types';
import { registerEventSchemaDefinition } from '../eventSchemas';

async function main(): Promise<void> {
  const [, , inputPath] = process.argv;
  if (!inputPath) {
    console.error('Usage: tsx src/scripts/registerEventSchema.ts <schema-definition.json>');
    process.exitCode = 1;
    return;
  }

  const resolvedPath = path.resolve(process.cwd(), inputPath);
  let raw: string;
  try {
    raw = await readFile(resolvedPath, 'utf8');
  } catch (err) {
    console.error(`[event-schema:register] Failed to read ${resolvedPath}:`, err);
    process.exitCode = 1;
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw) as unknown;
  } catch (err) {
    console.error('[event-schema:register] Provided file is not valid JSON:', err);
    process.exitCode = 1;
    return;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    console.error('[event-schema:register] Schema payload must be a JSON object.');
    process.exitCode = 1;
    return;
  }

  const input = payload as {
    eventType?: string;
    version?: number;
    status?: string;
    schema?: unknown;
    metadata?: unknown;
    author?: string;
  };

  if (!input.eventType || typeof input.eventType !== 'string' || input.eventType.trim().length === 0) {
    console.error('[event-schema:register] eventType is required in the payload.');
    process.exitCode = 1;
    return;
  }

  if (input.schema === undefined) {
    console.error('[event-schema:register] schema field is required.');
    process.exitCode = 1;
    return;
  }

  await ensureDatabase();

  try {
    const record = await registerEventSchemaDefinition({
      eventType: input.eventType,
      version: typeof input.version === 'number' ? input.version : undefined,
      status:
        input.status === 'draft' || input.status === 'active' || input.status === 'deprecated'
          ? input.status
          : undefined,
      schema: input.schema as JsonValue,
      metadata: (input.metadata as JsonValue | null | undefined) ?? null,
      author: input.author ?? null
    });

    console.log(
      JSON.stringify(
        {
          eventType: record.eventType,
          version: record.version,
          status: record.status,
          schemaHash: record.schemaHash,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error('[event-schema:register] Failed to register schema definition:', err);
    process.exitCode = 1;
  }
}

void main();
