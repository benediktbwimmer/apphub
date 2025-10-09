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

async function syncLocalSequence(targetValue: string): Promise<void> {
  try {
    await useConnection((client) =>
      client.query(
        `
          SELECT setval(
            $1::regclass,
            GREATEST($2::bigint, COALESCE((SELECT MAX(ingress_sequence) FROM workflow_events), 0)),
            true
          )
        `,
        [LOCAL_SEQUENCE_NAME, targetValue]
      )
    );
  } catch (err) {
    logSyncError(err);
  }
}

export async function reserveIngressSequence(): Promise<string> {
  if (isExternalSequencerEnabled()) {
    try {
      const value = await fetchExternalSequence();
      await syncLocalSequence(value);
      return value;
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
