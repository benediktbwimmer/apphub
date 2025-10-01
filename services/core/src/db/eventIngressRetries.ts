import { useConnection } from './utils';
import type {
  EventIngressRetryRecord,
  EventIngressRetryUpsertInput,
  EventIngressRetryUpdateInput
} from './types';
import type { EventIngressRetryRow } from './rowTypes';
import { mapEventIngressRetryRow } from './rowMappers';

function toJsonb(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function upsertEventIngressRetry(
  input: EventIngressRetryUpsertInput
): Promise<EventIngressRetryRecord> {
  const { rows } = await useConnection((client) =>
    client.query<EventIngressRetryRow>(
      `INSERT INTO event_ingress_retries (
         event_id,
         source,
         retry_state,
         attempts,
         next_attempt_at,
         last_error,
         metadata,
         created_at,
         updated_at
       ) VALUES (
         $1,
         $2,
         $3,
         $4,
         $5,
         $6,
         $7::jsonb,
         NOW(),
         NOW()
       )
       ON CONFLICT (event_id)
       DO UPDATE SET
         retry_state = EXCLUDED.retry_state,
         attempts = EXCLUDED.attempts,
         next_attempt_at = EXCLUDED.next_attempt_at,
         last_error = EXCLUDED.last_error,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING *`,
      [
        input.eventId,
        input.source,
        input.retryState ?? 'pending',
        input.attempts ?? 0,
        input.nextAttemptAt,
        input.lastError ?? null,
        toJsonb(input.metadata)
      ]
    )
  );

  if (rows.length === 0) {
    throw new Error('Failed to upsert event ingress retry');
  }

  return mapEventIngressRetryRow(rows[0]);
}

export async function updateEventIngressRetry(
  eventId: string,
  updates: EventIngressRetryUpdateInput
): Promise<EventIngressRetryRecord | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (updates.retryState !== undefined) {
    sets.push(`retry_state = $${index}`);
    values.push(updates.retryState);
    index += 1;
  }

  if (updates.attempts !== undefined) {
    sets.push(`attempts = $${index}`);
    values.push(updates.attempts);
    index += 1;
  }

  if (updates.nextAttemptAt !== undefined) {
    sets.push(`next_attempt_at = $${index}`);
    values.push(updates.nextAttemptAt);
    index += 1;
  }

  if (updates.lastError !== undefined) {
    sets.push(`last_error = $${index}`);
    values.push(updates.lastError);
    index += 1;
  }

  if (updates.metadata !== undefined) {
    sets.push(`metadata = $${index}::jsonb`);
    values.push(toJsonb(updates.metadata));
    index += 1;
  }

  if (sets.length === 0) {
    return getEventIngressRetryById(eventId);
  }

  sets.push('updated_at = NOW()');
  values.push(eventId);

  const { rows } = await useConnection((client) =>
    client.query<EventIngressRetryRow>(
      `UPDATE event_ingress_retries
          SET ${sets.join(', ')}
        WHERE event_id = $${index}
        RETURNING *`,
      values
    )
  );

  if (rows.length === 0) {
    return null;
  }

  return mapEventIngressRetryRow(rows[0]);
}

export async function deleteEventIngressRetry(eventId: string): Promise<void> {
  await useConnection((client) => client.query('DELETE FROM event_ingress_retries WHERE event_id = $1', [eventId]));
}

export async function getEventIngressRetryById(eventId: string): Promise<EventIngressRetryRecord | null> {
  const { rows } = await useConnection((client) =>
    client.query<EventIngressRetryRow>('SELECT * FROM event_ingress_retries WHERE event_id = $1', [eventId])
  );

  if (rows.length === 0) {
    return null;
  }

  return mapEventIngressRetryRow(rows[0]);
}

export async function listScheduledEventIngressRetries(limit = 500): Promise<EventIngressRetryRecord[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 1_000));
  const { rows } = await useConnection((client) =>
    client.query<EventIngressRetryRow>(
      `SELECT *
         FROM event_ingress_retries
        WHERE retry_state = 'scheduled'
        ORDER BY next_attempt_at ASC
        LIMIT $1`,
      [boundedLimit]
    )
  );

  return rows.map(mapEventIngressRetryRow);
}
