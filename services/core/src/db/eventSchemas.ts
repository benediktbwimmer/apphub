import { useConnection } from './utils';
import type {
  EventSchemaInsert,
  EventSchemaRecord,
  EventSchemaStatus,
  JsonValue
} from './types';
import type { EventSchemaRow } from './rowTypes';
import { mapEventSchemaRow } from './rowMappers';

function toJsonb(value: JsonValue | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function normalizeStatus(value: string | EventSchemaStatus | undefined): EventSchemaStatus {
  if (value === 'active' || value === 'deprecated' || value === 'draft') {
    return value;
  }
  return 'draft';
}

export async function insertEventSchema(record: EventSchemaInsert): Promise<EventSchemaRecord> {
  const metadataJson = toJsonb(record.metadata ?? null);

  return useConnection(async (client) => {
    const { rows } = await client.query<EventSchemaRow>(
      `INSERT INTO event_schema_registry (
         event_type,
         version,
         status,
         schema,
         schema_hash,
         metadata,
         created_by,
         updated_by
       ) VALUES (
         $1,
         $2,
         $3,
         $4::jsonb,
         $5,
         $6::jsonb,
         $7,
         $8
       )
       RETURNING *`,
      [
        record.eventType,
        record.version,
        record.status,
        JSON.stringify(record.schema),
        record.schemaHash,
        metadataJson,
        record.createdBy ?? null,
        record.updatedBy ?? null
      ]
    );

    if (rows.length === 0) {
      throw new Error('Failed to insert event schema');
    }

    return mapEventSchemaRow(rows[0]);
  });
}

export async function getEventSchema(
  eventType: string,
  version: number
): Promise<EventSchemaRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<EventSchemaRow>(
      `SELECT * FROM event_schema_registry
       WHERE event_type = $1 AND version = $2`,
      [eventType, version]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapEventSchemaRow(rows[0]);
  });
}

export async function getLatestEventSchema(
  eventType: string,
  statuses: EventSchemaStatus[] = ['active']
): Promise<EventSchemaRecord | null> {
  const normalizedStatuses = statuses.length > 0 ? statuses.map(normalizeStatus) : ['active'];

  return useConnection(async (client) => {
    const { rows } = await client.query<EventSchemaRow>(
      `SELECT * FROM event_schema_registry
       WHERE event_type = $1
         AND ($2::text[] IS NULL OR status = ANY($2::text[]))
       ORDER BY version DESC
       LIMIT 1`,
      [eventType, normalizedStatuses]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapEventSchemaRow(rows[0]);
  });
}

export async function listEventSchemas(
  options: {
    eventType?: string;
    status?: EventSchemaStatus | EventSchemaStatus[];
    limit?: number;
    offset?: number;
  } = {}
): Promise<EventSchemaRecord[]> {
  const conditions: string[] = [];
  const params: Array<string | number | string[] | null> = [];
  let index = 1;

  if (options.eventType) {
    conditions.push(`event_type = $${index}`);
    params.push(options.eventType);
    index += 1;
  }

  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    conditions.push(`status = ANY($${index}::text[])`);
    params.push(statuses.map(normalizeStatus));
    index += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Number.isFinite(options.limit) && options.limit
    ? Math.max(1, Math.min(200, Math.trunc(Number(options.limit))))
    : 100;
  const offset = Number.isFinite(options.offset) && options.offset
    ? Math.max(0, Math.trunc(Number(options.offset)))
    : 0;

  params.push(limit);
  params.push(offset);

  return useConnection(async (client) => {
    const { rows } = await client.query<EventSchemaRow>(
      `SELECT *
       FROM event_schema_registry
       ${whereClause}
       ORDER BY event_type, version DESC
       LIMIT $${index} OFFSET $${index + 1}`,
      params
    );
    return rows.map(mapEventSchemaRow);
  });
}

export async function updateEventSchemaStatus(
  eventType: string,
  version: number,
  status: EventSchemaStatus,
  updatedBy?: string | null
): Promise<EventSchemaRecord | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<EventSchemaRow>(
      `UPDATE event_schema_registry
       SET status = $3,
           updated_at = NOW(),
           updated_by = $4
       WHERE event_type = $1 AND version = $2
       RETURNING *`,
      [eventType, version, normalizeStatus(status), updatedBy ?? null]
    );
    if (rows.length === 0) {
      return null;
    }
    return mapEventSchemaRow(rows[0]);
  });
}

export async function getNextEventSchemaVersion(eventType: string): Promise<number> {
  return useConnection(async (client) => {
    const { rows } = await client.query<{ max: number | null }>(
      `SELECT MAX(version) as max FROM event_schema_registry WHERE event_type = $1`,
      [eventType]
    );
    const currentMax = rows.length > 0 && rows[0].max !== null ? Number(rows[0].max) : 0;
    return currentMax + 1;
  });
}
