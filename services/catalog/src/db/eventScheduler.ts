import type { PoolClient } from 'pg';
import { withConnection, withTransaction } from './client';
import type { JsonValue } from './types';

export type RateLimitConfig = {
  source: string;
  limit: number;
  intervalMs: number;
  pauseMs: number;
};

export type SourcePauseRecord = {
  source: string;
  until: string;
  reason: string;
  details: JsonValue | null;
};

export type TriggerPauseRecord = {
  triggerId: string;
  until: string;
  reason: string;
  failures: number;
};

function toIsoString(date: Date): string {
  return date.toISOString();
}

async function removeExpiredSourcePause(client: PoolClient, source: string, now: Date): Promise<void> {
  await client.query(
    'DELETE FROM event_scheduler_source_pauses WHERE source = $1 AND paused_until <= $2',
    [source, toIsoString(now)]
  );
}

async function getActiveSourcePause(
  client: PoolClient,
  source: string,
  now: Date
): Promise<SourcePauseRecord | null> {
  await removeExpiredSourcePause(client, source, now);
  const { rows } = await client.query<{
    paused_until: string;
    reason: string;
    details: JsonValue | null;
  }>(
    'SELECT paused_until, reason, details FROM event_scheduler_source_pauses WHERE source = $1',
    [source]
  );
  if (rows.length === 0) {
    return null;
  }
  const pause = rows[0];
  return {
    source,
    until: pause.paused_until,
    reason: pause.reason,
    details: pause.details ?? null
  } satisfies SourcePauseRecord;
}

async function insertRateLimitPause(
  client: PoolClient,
  source: string,
  until: Date,
  details: JsonValue
): Promise<void> {
  await client.query(
    `INSERT INTO event_scheduler_source_pauses (source, paused_until, reason, details, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (source)
       DO UPDATE SET paused_until = EXCLUDED.paused_until,
                     reason = EXCLUDED.reason,
                     details = EXCLUDED.details,
                     updated_at = NOW();`,
    [source, toIsoString(until), 'rate_limit', details]
  );
}

export async function evaluateSourceEvent(
  source: string,
  config: RateLimitConfig | undefined,
  now: Date = new Date()
): Promise<{ allowed: boolean; reason?: string; until?: string }> {
  const normalizedSource = source.trim() || 'unknown';

  return withTransaction(async (client) => {
    const pause = await getActiveSourcePause(client, normalizedSource, now);
    if (pause) {
      return { allowed: false, reason: pause.reason, until: pause.until };
    }

    if (!config) {
      return { allowed: true };
    }

    const windowThreshold = new Date(now.getTime() - config.intervalMs);

    await client.query(
      'DELETE FROM event_scheduler_source_events WHERE source = $1 AND event_time < $2',
      [normalizedSource, toIsoString(windowThreshold)]
    );
    await client.query(
      'INSERT INTO event_scheduler_source_events (source, event_time) VALUES ($1, $2)',
      [normalizedSource, toIsoString(now)]
    );

    const { rows } = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM event_scheduler_source_events WHERE source = $1',
      [normalizedSource]
    );
    const windowCount = rows[0]?.count ?? 0;

    if (windowCount > config.limit) {
      const until = new Date(now.getTime() + config.pauseMs);
      await insertRateLimitPause(client, normalizedSource, until, {
        limit: config.limit,
        intervalMs: config.intervalMs
      });
      return { allowed: false, reason: 'rate_limit', until: toIsoString(until) };
    }

    return { allowed: true };
  });
}

export async function recordManualSourcePause(
  source: string,
  until: Date,
  reason: string,
  details?: JsonValue
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO event_scheduler_source_pauses (source, paused_until, reason, details, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (source)
         DO UPDATE SET paused_until = EXCLUDED.paused_until,
                       reason = EXCLUDED.reason,
                       details = EXCLUDED.details,
                       updated_at = NOW();`,
      [source.trim() || 'unknown', toIsoString(until), reason, details ?? null]
    );
  });
}

export async function getActiveSourcePauses(): Promise<SourcePauseRecord[]> {
  const now = new Date();
  return withTransaction(async (client) => {
    await client.query('DELETE FROM event_scheduler_source_pauses WHERE paused_until <= NOW()');
    const { rows } = await client.query<{
      source: string;
      paused_until: string;
      reason: string;
      details: JsonValue | null;
    }>(
      'SELECT source, paused_until, reason, details FROM event_scheduler_source_pauses ORDER BY source'
    );
    return rows.map((row) => ({
      source: row.source,
      until: row.paused_until,
      reason: row.reason,
      details: row.details ?? null
    } satisfies SourcePauseRecord));
  });
}

async function removeExpiredTriggerPause(client: PoolClient, triggerId: string, now: Date): Promise<void> {
  await client.query(
    'DELETE FROM event_scheduler_trigger_pauses WHERE trigger_id = $1 AND paused_until <= $2',
    [triggerId, toIsoString(now)]
  );
}

export async function isTriggerPausedInStore(
  triggerId: string,
  now: Date = new Date()
): Promise<{ paused: boolean; until?: string; reason?: string }> {
  const normalized = triggerId.trim();
  if (!normalized) {
    return { paused: false };
  }
  return withTransaction(async (client) => {
    await removeExpiredTriggerPause(client, normalized, now);
    const { rows } = await client.query<{
      paused_until: string;
      reason: string;
    }>(
      'SELECT paused_until, reason FROM event_scheduler_trigger_pauses WHERE trigger_id = $1',
      [normalized]
    );
    if (rows.length === 0) {
      return { paused: false };
    }
    const pause = rows[0];
    return { paused: true, until: pause.paused_until, reason: pause.reason };
  });
}

export async function registerTriggerFailureInStore(
  triggerId: string,
  reason: string | null,
  threshold: number,
  windowMs: number,
  pauseMs: number,
  now: Date = new Date()
): Promise<{ paused: boolean; until?: string }> {
  const normalized = triggerId.trim();
  if (!normalized) {
    return { paused: false };
  }

  return withTransaction(async (client) => {
    const cutoff = new Date(now.getTime() - windowMs);
    await client.query(
      'DELETE FROM event_scheduler_trigger_failures WHERE trigger_id = $1 AND failure_time <= $2',
      [normalized, toIsoString(cutoff)]
    );
    await client.query(
      'INSERT INTO event_scheduler_trigger_failures (trigger_id, failure_time, reason) VALUES ($1, $2, $3)',
      [normalized, toIsoString(now), reason]
    );

    const { rows } = await client.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM event_scheduler_trigger_failures WHERE trigger_id = $1',
      [normalized]
    );
    const failureCount = rows[0]?.count ?? 0;

    if (failureCount >= threshold) {
      const until = new Date(now.getTime() + pauseMs);
      await client.query(
        `INSERT INTO event_scheduler_trigger_pauses (trigger_id, paused_until, reason, failures, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           ON CONFLICT (trigger_id)
           DO UPDATE SET paused_until = EXCLUDED.paused_until,
                         reason = EXCLUDED.reason,
                         failures = EXCLUDED.failures,
                         updated_at = NOW();`,
        [normalized, toIsoString(until), reason ?? 'failure_threshold_exceeded', failureCount]
      );
      return { paused: true, until: toIsoString(until) };
    }

    await removeExpiredTriggerPause(client, normalized, now);
    return { paused: false };
  });
}

export async function registerTriggerSuccessInStore(triggerId: string): Promise<void> {
  const normalized = triggerId.trim();
  if (!normalized) {
    return;
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM event_scheduler_trigger_failures WHERE trigger_id = $1', [normalized]);
    await client.query('DELETE FROM event_scheduler_trigger_pauses WHERE trigger_id = $1', [normalized]);
  });
}

export async function getActiveTriggerPauses(): Promise<TriggerPauseRecord[]> {
  return withTransaction(async (client) => {
    await client.query('DELETE FROM event_scheduler_trigger_pauses WHERE paused_until <= NOW()');
    const { rows } = await client.query<{
      trigger_id: string;
      paused_until: string;
      reason: string;
      failures: number;
    }>(
      'SELECT trigger_id, paused_until, reason, failures FROM event_scheduler_trigger_pauses ORDER BY trigger_id'
    );
    return rows.map((row) => ({
      triggerId: row.trigger_id,
      until: row.paused_until,
      reason: row.reason,
      failures: row.failures ?? 0
    } satisfies TriggerPauseRecord));
  });
}

export async function clearSourceEventWindows(): Promise<void> {
  await withConnection(async (client) => {
    await client.query('TRUNCATE TABLE event_scheduler_source_events');
  });
}
