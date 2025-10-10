import { Pool } from 'pg';
import { useConnection } from './utils';
import { logger } from '../observability/logger';

const LOCAL_SEQUENCE_NAME = 'workflow_events_ingress_seq';
const DEFAULT_EXTERNAL_SEQUENCE_NAME = 'apphub_event_ingress_seq';

const externalDatabaseUrl = (process.env.APPHUB_EVENT_SEQUENCE_DATABASE_URL ?? '').trim();
const externalSequenceName =
  (process.env.APPHUB_EVENT_SEQUENCE_NAME ?? DEFAULT_EXTERNAL_SEQUENCE_NAME).trim()
    || DEFAULT_EXTERNAL_SEQUENCE_NAME;

let externalPool: Pool | null = null;
let shutdownHookRegistered = false;
let lastExternalErrorMessage: string | null = null;
let lastExternalErrorAt = 0;
let lastSyncErrorMessage: string | null = null;
let lastSyncErrorAt = 0;

function isExternalSequencerEnabled(): boolean {
  return externalDatabaseUrl.length > 0;
}

function ensureExternalPool(): Pool {
  if (!externalPool) {
    externalPool = new Pool({
      connectionString: externalDatabaseUrl,
      max: Number(process.env.APPHUB_EVENT_SEQUENCE_POOL_MAX ?? 4)
    });
    registerShutdownHook();
  }
  return externalPool;
}

function registerShutdownHook(): void {
  if (shutdownHookRegistered) {
    return;
  }
  shutdownHookRegistered = true;
  process.once('beforeExit', () => {
    void closeIngressSequencePool();
  });
}

function logExternalError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const now = Date.now();
  if (lastExternalErrorMessage === message && now - lastExternalErrorAt < 30_000) {
    return;
  }
  lastExternalErrorMessage = message;
  lastExternalErrorAt = now;
  logger.warn('External ingress sequence service unavailable; falling back to local sequence', {
    error: message
  });
}

function logSyncError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const now = Date.now();
  if (lastSyncErrorMessage === message && now - lastSyncErrorAt < 30_000) {
    return;
  }
  lastSyncErrorMessage = message;
  lastSyncErrorAt = now;
  logger.warn('Failed to synchronize local ingress sequence with external generator', {
    error: message
  });
}

async function reserveLocalSequence(): Promise<string> {
  const { rows } = await useConnection((client) =>
    client.query<{ seq: string }>(
      `SELECT nextval($1::regclass)::text AS seq`,
      [LOCAL_SEQUENCE_NAME]
    )
  );
  const value = rows[0]?.seq;
  if (!value) {
    throw new Error('Local ingress sequence did not return a value');
  }
  return value;
}

async function fetchExternalSequence(): Promise<string> {
  const pool = ensureExternalPool();
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ seq: string }>(
      `SELECT nextval($1::regclass)::text AS seq`,
      [externalSequenceName]
    );
    const value = rows[0]?.seq;
    if (!value) {
      throw new Error('External ingress sequence did not return a value');
    }
    return value;
  } finally {
    client.release();
  }
}

type SyncResult = {
  syncedValue: bigint;
  maxValue: bigint;
};

async function syncLocalSequence(targetValue: string): Promise<SyncResult | null> {
  try {
    const { rows } = await useConnection((client) =>
      client.query<{ synced_value: string; max_value: string }>(
        `
          WITH existing AS (
            SELECT COALESCE(MAX(ingress_sequence), 0)::bigint AS max_value
            FROM workflow_events
          ),
          updated AS (
            SELECT
              setval(
                $1::regclass,
                GREATEST($2::bigint, existing.max_value),
                true
              ) AS synced_value,
              existing.max_value
            FROM existing
          )
          SELECT synced_value, max_value FROM updated
        `,
        [LOCAL_SEQUENCE_NAME, targetValue]
      )
    );
    const row = rows[0];
    if (!row?.synced_value || row.max_value === undefined || row.max_value === null) {
      return null;
    }
    return {
      syncedValue: BigInt(row.synced_value),
      maxValue: BigInt(row.max_value)
    };
  } catch (err) {
    logSyncError(err);
  }
  return null;
}

export async function reserveIngressSequence(): Promise<string> {
  if (isExternalSequencerEnabled()) {
    try {
      const maxAttempts = Number(process.env.APPHUB_EVENT_SEQUENCE_MAX_SYNC_ATTEMPTS ?? 64);
      const attempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : 64;

      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const externalValue = await fetchExternalSequence();
        const syncResult = await syncLocalSequence(externalValue);
        if (!syncResult) {
          break;
        }
        const externalBigInt = BigInt(externalValue);
        if (syncResult.maxValue >= externalBigInt) {
          // Existing events already occupy this position; skip the stale external cursor value.
          continue;
        }
        if (syncResult.syncedValue === externalBigInt) {
          return externalValue;
        }
        // External sequence is still behind the local cursor; discard this value and continue.
      }

      logger.warn('External ingress sequence lagging; falling back to local sequence');
    } catch (err) {
      logExternalError(err);
    }
  }
  return reserveLocalSequence();
}

export async function closeIngressSequencePool(): Promise<void> {
  if (!externalPool) {
    return;
  }
  const pool = externalPool;
  externalPool = null;
  try {
    await pool.end();
  } catch (err) {
    logger.warn('Failed to close external ingress sequence pool cleanly', {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}
