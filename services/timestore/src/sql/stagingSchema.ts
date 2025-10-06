import path from 'node:path';
import { access } from 'node:fs/promises';
import { loadDuckDb, isCloseable } from '@apphub/shared';
import type { DatasetRecord } from '../db/metadata';
import type { ServiceConfig } from '../config/serviceConfig';
import { getStagingWriteManager } from '../ingestion/stagingManager';
import type { PendingStagingBatch } from '../storage/spoolManager';

const STAGING_SCHEMA = 'staging';
const METADATA_TABLE = '__ingestion_batches';

export interface StagingSchemaField {
  name: string;
  type: string;
  nullable?: boolean;
  description?: string | null;
}

export async function readStagingSchemaFields(
  dataset: DatasetRecord,
  config: ServiceConfig,
  warnings?: string[]
): Promise<StagingSchemaField[]> {
  const stagingDirectory = config.staging?.directory;
  if (!stagingDirectory) {
    return [];
  }

  const safeSlug = sanitizeDatasetSlug(dataset.slug);
  const databasePath = path.join(stagingDirectory, safeSlug, 'staging.duckdb');
  try {
    await access(databasePath);
  } catch {
    return [];
  }

  const duckdb = loadDuckDb();
  let db: any | null = null;
  let connection: any | null = null;

  try {
    db = new duckdb.Database(databasePath, { access_mode: 'READ_ONLY' });
    connection = db.connect();
    if (!connection) {
      return await collectFieldsFromPendingBatches(dataset, config);
    }

    let schemaRows: Array<Record<string, unknown>> = [];
    try {
      schemaRows = await all(
        connection,
        `SELECT schema_json
           FROM ${STAGING_SCHEMA}.${METADATA_TABLE}
          WHERE schema_json IS NOT NULL
            AND schema_json <> ''
          ORDER BY staged_at DESC
          LIMIT 64`
      );
    } catch (error) {
      if (!isMissingDuckDbTableError(error)) {
        throw error;
      }
    }

    const fieldMap = new Map<string, StagingSchemaField>();

    for (const row of schemaRows) {
      const raw = typeof row.schema_json === 'string' ? row.schema_json : null;
      if (!raw) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) {
        continue;
      }
      for (const entry of parsed as Array<Record<string, unknown>>) {
        const name = typeof entry?.name === 'string' ? entry.name : null;
        if (!name || fieldMap.has(name)) {
          continue;
        }
        const type = typeof entry?.type === 'string' ? entry.type : 'string';
        const nullable = typeof entry?.nullable === 'boolean' ? entry.nullable : undefined;
        const description = typeof entry?.description === 'string' ? entry.description : null;
        fieldMap.set(name, { name, type, nullable, description });
      }
    }

    if (fieldMap.size === 0) {
      const tables = await all(
        connection,
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = '${STAGING_SCHEMA}'
            AND table_type = 'BASE TABLE'
            AND table_name <> '${METADATA_TABLE}'`
      );

      for (const row of tables) {
        const tableName = typeof row.table_name === 'string' ? row.table_name : null;
        if (!tableName) {
          continue;
        }
        const escapedTable = tableName.replace(/"/g, '""');
        const pragmaRows = await all(
          connection,
          `PRAGMA table_info('${STAGING_SCHEMA}.${escapedTable}')`
        );
        for (const column of pragmaRows) {
          const name = typeof column.name === 'string' ? column.name : null;
          if (!name || name.startsWith('__') || fieldMap.has(name)) {
            continue;
          }
          const type = typeof column.type === 'string' ? column.type : 'string';
          const nullable = typeof column.notnull === 'number' ? column.notnull === 0 : undefined;
          fieldMap.set(name, {
            name,
            type,
            nullable,
            description: null
          });
        }
      }
    }

    const fields = Array.from(fieldMap.values());
    if (fields.length > 0) {
      return fields;
    }
    return await collectFieldsFromPendingBatches(dataset, config);
  } catch (error) {
    if (warnings) {
      warnings.push(
        `Failed to read staging schema for dataset ${dataset.slug}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    return await collectFieldsFromPendingBatches(dataset, config);
  } finally {
    if (connection) {
      await closeConnection(connection).catch(() => undefined);
    }
    if (isCloseable(db)) {
      ignoreCloseError(() => db.close());
    }
  }
}

async function collectFieldsFromPendingBatches(
  dataset: DatasetRecord,
  config: ServiceConfig
): Promise<StagingSchemaField[]> {
  try {
    const manager = getStagingWriteManager(config);
    const batches: PendingStagingBatch[] = await manager.getSpoolManager().listPendingBatches(dataset.slug);
    const fieldMap = new Map<string, StagingSchemaField>();

    for (const batch of batches) {
      for (const field of batch.schema) {
        if (!field.name || fieldMap.has(field.name)) {
          continue;
        }
        fieldMap.set(field.name, {
          name: field.name,
          type: field.type,
          nullable: true
        });
      }
    }

    return Array.from(fieldMap.values());
  } catch (error) {
    return [];
  }
}

export function sanitizeDatasetSlug(datasetSlug: string): string {
  const trimmed = datasetSlug.trim();
  if (trimmed.length === 0) {
    throw new Error('datasetSlug must not be empty');
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_.-]/g, '_');
  return normalized.length > 0 ? normalized : 'dataset';
}

function isMissingDuckDbTableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message ?? '';
  return /does not exist/i.test(message) || /no such table/i.test(message);
}

async function all(connection: any, sql: string, ...params: unknown[]): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    connection.all(sql, ...params, (err: Error | null, rows?: Array<Record<string, unknown>>) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows ?? []);
      }
    });
  });
}

async function closeConnection(connection: any): Promise<void> {
  return new Promise((resolve, reject) => {
    connection.close((err: Error | null) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function ignoreCloseError(fn: () => void): void {
  try {
    fn();
  } catch {
    // ignore
  }
}
