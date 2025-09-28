import type { PoolClient } from 'pg';
import { parseSchemaDefinitionDocument } from '../schemas/schemaRegistry';
import type { SchemaDefinition, SchemaDefinitionInput } from './types';

export type SchemaRegistryRow = {
  schema_hash: string;
  definition: unknown;
  created_at: Date;
  updated_at: Date;
};

type SchemaUpsertRow = SchemaRegistryRow & {
  inserted: boolean;
};

export type SchemaUpsertResult = {
  definition: SchemaDefinition;
  created: boolean;
};

function toSchemaDefinition(row: SchemaRegistryRow): SchemaDefinition {
  const document = parseSchemaDefinitionDocument(row.definition);
  return {
    schemaHash: row.schema_hash,
    name: document.name,
    description: document.description,
    version: document.version,
    fields: document.fields,
    metadata: document.metadata,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  } satisfies SchemaDefinition;
}

export async function upsertSchemaDefinition(
  client: PoolClient,
  input: SchemaDefinitionInput
): Promise<SchemaUpsertResult> {
  const document = parseSchemaDefinitionDocument({
    name: input.name,
    description: input.description,
    version: input.version,
    fields: input.fields,
    metadata: input.metadata
  });

  const result = await client.query<SchemaUpsertRow>(
    `INSERT INTO metastore_schema_registry (schema_hash, definition, created_at, updated_at)
     VALUES ($1, $2::jsonb, NOW(), NOW())
     ON CONFLICT (schema_hash)
     DO UPDATE SET
       definition = EXCLUDED.definition,
       updated_at = NOW()
     RETURNING schema_hash, definition, created_at, updated_at, (xmax = 0) AS inserted`,
    [input.schemaHash, document]
  );

  if (result.rowCount !== 1) {
    throw new Error('Failed to upsert schema definition');
  }

  const row = result.rows[0];
  return {
    definition: toSchemaDefinition(row),
    created: Boolean(row.inserted)
  } satisfies SchemaUpsertResult;
}

export async function getSchemaDefinition(
  client: PoolClient,
  schemaHash: string
): Promise<SchemaDefinition | null> {
  const result = await client.query<SchemaRegistryRow>(
    `SELECT schema_hash, definition, created_at, updated_at
     FROM metastore_schema_registry
     WHERE schema_hash = $1`,
    [schemaHash]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return toSchemaDefinition(result.rows[0]);
}
