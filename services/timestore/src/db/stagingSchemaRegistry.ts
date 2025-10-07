import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withConnection } from './client';
import type { StagingSchemaField } from '../sql/stagingSchema';

export interface StagingSchemaRegistryRecord {
  datasetId: string;
  schemaVersion: number;
  fields: StagingSchemaField[];
  checksum: string;
  sourceBatchId: string | null;
  updatedAt: Date;
}

interface UpsertStagingSchemaInput {
  datasetId: string;
  fields: StagingSchemaField[];
  sourceBatchId: string | null;
  checksum?: string;
}

export interface StagingSchemaRegistryUpsertResult {
  record: StagingSchemaRegistryRecord;
  status: 'created' | 'updated' | 'unchanged';
}


interface RawRegistryRow {
  dataset_id: string;
  schema_version: number;
  fields: unknown;
  checksum: string;
  source_batch_id: string | null;
  updated_at: Date;
}

function parseFields(raw: unknown): StagingSchemaField[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const fields: StagingSchemaField[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const name = typeof (entry as { name?: unknown }).name === 'string'
      ? (entry as { name: string }).name.trim()
      : '';
    if (!name) {
      continue;
    }
    const type = typeof (entry as { type?: unknown }).type === 'string'
      ? (entry as { type: string }).type
      : 'string';
    const nullable = typeof (entry as { nullable?: unknown }).nullable === 'boolean'
      ? (entry as { nullable: boolean }).nullable
      : undefined;
    const description = (entry as { description?: unknown }).description;
    fields.push({
      name,
      type,
      nullable,
      description: typeof description === 'string' ? description : null
    });
  }
  return fields;
}

function mapRow(row: RawRegistryRow): StagingSchemaRegistryRecord {
  return {
    datasetId: row.dataset_id,
    schemaVersion: row.schema_version,
    fields: parseFields(row.fields),
    checksum: row.checksum,
    sourceBatchId: row.source_batch_id,
    updatedAt: row.updated_at
  };
}

function canonicalizeFields(fields: StagingSchemaField[]): StagingSchemaField[] {
  const map = new Map<string, StagingSchemaField>();
  for (const field of fields) {
    const name = field.name.trim();
    if (!name || map.has(name)) {
      continue;
    }
    map.set(name, {
      name,
      type: field.type,
      nullable: typeof field.nullable === 'boolean' ? field.nullable : undefined,
      description: field.description ?? null
    });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function computeChecksum(fields: StagingSchemaField[]): string {
  const hash = createHash('sha1');
  const payload = fields.map((field) => ({
    name: field.name,
    type: field.type,
    nullable: field.nullable ?? null,
    description: field.description ?? null
  }));
  hash.update(JSON.stringify(payload));
  return hash.digest('hex');
}

export async function getStagingSchemaRegistry(
  datasetId: string
): Promise<StagingSchemaRegistryRecord | null> {
  return withConnection(async (client: PoolClient) => {
    const { rows } = await client.query<RawRegistryRow>(
      `SELECT dataset_id, schema_version, fields, checksum, source_batch_id, updated_at
         FROM timestore_staging_schemas
        WHERE dataset_id = $1`,
      [datasetId]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapRow(rows[0]);
  });
}

export async function upsertStagingSchemaRegistry(
  input: UpsertStagingSchemaInput
): Promise<StagingSchemaRegistryUpsertResult> {
  const fields = canonicalizeFields(input.fields);
  if (fields.length === 0) {
    throw new Error('Cannot persist empty staging schema');
  }
  const checksum = input.checksum ?? computeChecksum(fields);
  const now = new Date();
  const fieldsJson = JSON.stringify(fields);

  return withConnection(async (client: PoolClient) => {
    const { rows: existingRows } = await client.query<{ checksum: string }>(
      `SELECT checksum
         FROM timestore_staging_schemas
        WHERE dataset_id = $1`,
      [input.datasetId]
    );
    const existingChecksum = existingRows.length > 0 ? existingRows[0].checksum : null;

    const { rows } = await client.query<RawRegistryRow>(
      `WITH upsert AS (
         INSERT INTO timestore_staging_schemas (dataset_id, schema_version, fields, checksum, source_batch_id, updated_at)
         VALUES ($1, 1, $2::jsonb, $3, $4, $5)
         ON CONFLICT (dataset_id) DO UPDATE SET
           schema_version = CASE
             WHEN timestore_staging_schemas.checksum = EXCLUDED.checksum THEN timestore_staging_schemas.schema_version
             ELSE timestore_staging_schemas.schema_version + 1
           END,
           fields = CASE
             WHEN timestore_staging_schemas.checksum = EXCLUDED.checksum THEN timestore_staging_schemas.fields
             ELSE EXCLUDED.fields
           END,
           checksum = CASE
             WHEN timestore_staging_schemas.checksum = EXCLUDED.checksum THEN timestore_staging_schemas.checksum
             ELSE EXCLUDED.checksum
           END,
           source_batch_id = CASE
             WHEN timestore_staging_schemas.checksum = EXCLUDED.checksum THEN timestore_staging_schemas.source_batch_id
             ELSE EXCLUDED.source_batch_id
           END,
           updated_at = CASE
             WHEN timestore_staging_schemas.checksum = EXCLUDED.checksum THEN timestore_staging_schemas.updated_at
             ELSE EXCLUDED.updated_at
           END
         RETURNING dataset_id, schema_version, fields, checksum, source_batch_id, updated_at
       )
       SELECT dataset_id, schema_version, fields, checksum, source_batch_id, updated_at
         FROM upsert`,
      [input.datasetId, fieldsJson, checksum, input.sourceBatchId, now]
    );

    if (rows.length === 0) {
      throw new Error('Failed to upsert staging schema registry entry');
    }

    const record = mapRow(rows[0]);
    let status: StagingSchemaRegistryUpsertResult['status'];
    if (existingChecksum === null) {
      status = 'created';
    } else if (existingChecksum !== record.checksum) {
      status = 'updated';
    } else {
      status = 'unchanged';
    }

    return { record, status } satisfies StagingSchemaRegistryUpsertResult;
  });
}
