import { useConnection } from './utils';
import {
  type WorkflowEventInsert,
  type WorkflowEventQueryOptions,
  type WorkflowEventQueryResult,
  type WorkflowEventRecord
} from './types';
import type { WorkflowEventRow } from './rowTypes';
import { mapWorkflowEventRow } from './rowMappers';

function toJsonbParameter(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit ?? NaN)) {
    return 100;
  }
  const normalized = Math.trunc(Number(limit));
  if (Number.isNaN(normalized)) {
    return 100;
  }
  if (normalized < 1) {
    return 1;
  }
  if (normalized > 200) {
    return 200;
  }
  return normalized;
}

export async function insertWorkflowEvent(event: WorkflowEventInsert): Promise<WorkflowEventRecord> {
  const payloadParam = toJsonbParameter(event.payload ?? {});
  const metadataParam = toJsonbParameter(event.metadata ?? null);
  const receivedAt = event.receivedAt ?? new Date().toISOString();

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowEventRow>(
      `INSERT INTO workflow_events (
         id,
         type,
         source,
         occurred_at,
         received_at,
         payload,
         correlation_id,
         ttl_ms,
         metadata
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6::jsonb,
         $7,
         $8,
         $9::jsonb
       )
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         source = EXCLUDED.source,
         occurred_at = EXCLUDED.occurred_at,
         payload = EXCLUDED.payload,
         correlation_id = EXCLUDED.correlation_id,
         ttl_ms = EXCLUDED.ttl_ms,
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        event.id,
        event.type,
        event.source,
        event.occurredAt,
        receivedAt,
        payloadParam,
        event.correlationId ?? null,
        event.ttlMs ?? null,
        metadataParam
      ]
    );

    if (rows.length === 0) {
      throw new Error('Failed to insert workflow event');
    }

    return mapWorkflowEventRow(rows[0]);
  });
}

export async function listWorkflowEvents(
  options: WorkflowEventQueryOptions = {}
): Promise<WorkflowEventQueryResult> {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  let index = 1;

  if (options.type) {
    conditions.push(`type = $${index}`);
    params.push(options.type);
    index += 1;
  }

  if (options.source) {
    conditions.push(`source = $${index}`);
    params.push(options.source);
    index += 1;
  }

  if (options.correlationId) {
    conditions.push(`correlation_id = $${index}`);
    params.push(options.correlationId);
    index += 1;
  }

  if (options.from) {
    conditions.push(`occurred_at >= $${index}`);
    params.push(options.from);
    index += 1;
  }

  if (options.to) {
    conditions.push(`occurred_at <= $${index}`);
    params.push(options.to);
    index += 1;
  }

  if (options.cursor) {
    conditions.push(
      `(occurred_at < $${index} OR (occurred_at = $${index} AND id < $${index + 1}))`
    );
    params.push(options.cursor.occurredAt);
    params.push(options.cursor.id);
    index += 2;
  }

  if (options.jsonPath) {
    conditions.push(`jsonb_path_exists(payload, $${index}::jsonpath)`);
    params.push(options.jsonPath);
    index += 1;
  }

  const limit = clampLimit(options.limit);
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT * FROM workflow_events ${whereClause} ORDER BY occurred_at DESC, id DESC LIMIT $${index}`;
  params.push(limit + 1);

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowEventRow>(query, params);
    const mapped = rows.map(mapWorkflowEventRow);
    const hasMore = mapped.length > limit;
    const events = hasMore ? mapped.slice(0, limit) : mapped;
    const nextCursor = hasMore
      ? {
          occurredAt: events[events.length - 1].occurredAt,
          id: events[events.length - 1].id
        }
      : null;

    return {
      events,
      hasMore,
      limit,
      nextCursor
    } satisfies WorkflowEventQueryResult;
  });
}

export async function listWorkflowEventsByIds(ids: string[]): Promise<WorkflowEventRecord[]> {
  const unique = Array.from(
    new Set(ids.map((id) => (typeof id === 'string' ? id.trim() : '')).filter((id) => id.length > 0))
  );
  if (unique.length === 0) {
    return [];
  }

  return useConnection(async (client) => {
    const { rows } = await client.query<WorkflowEventRow>(
      'SELECT * FROM workflow_events WHERE id = ANY($1::text[]) ORDER BY occurred_at DESC',
      [unique]
    );
    return rows.map(mapWorkflowEventRow);
  });
}

export async function getWorkflowEventById(eventId: string): Promise<WorkflowEventRecord | null> {
  const trimmed = eventId.trim();
  if (!trimmed) {
    return null;
  }

  const { rows } = await useConnection((client) =>
    client.query<WorkflowEventRow>('SELECT * FROM workflow_events WHERE id = $1', [trimmed])
  );

  if (rows.length === 0) {
    return null;
  }

  return mapWorkflowEventRow(rows[0]);
}
