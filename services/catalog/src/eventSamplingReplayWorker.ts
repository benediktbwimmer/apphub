import process from 'node:process';
import { ensureDatabase } from './db/init';
import { replayWorkflowEventSampling } from './eventSamplingReplay';
import { logger } from './observability/logger';
import { normalizeMeta } from './observability/meta';

function normalizeNumber(value: string | undefined, fallback: number, min = 1): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.floor(parsed);
  if (Number.isNaN(normalized) || normalized < min) {
    return fallback;
  }
  return normalized;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const REPLAY_LOOKBACK_MS = normalizeNumber(process.env.EVENT_SAMPLING_REPLAY_LOOKBACK_MS, 7 * 24 * 60 * 60 * 1000);
const REPLAY_CHUNK_SIZE = normalizeNumber(process.env.EVENT_SAMPLING_REPLAY_CHUNK_SIZE, 200);
const REPLAY_INTERVAL_MS = normalizeNumber(process.env.EVENT_SAMPLING_REPLAY_INTERVAL_MS, 60_000, 1000);
const REPLAY_MAX_ATTEMPTS = normalizeNumber(process.env.EVENT_SAMPLING_REPLAY_MAX_ATTEMPTS, 5);
const REPLAY_BACKOFF_MS = normalizeNumber(process.env.EVENT_SAMPLING_REPLAY_BACKOFF_MS, 5_000, 1000);

let shuttingDown = false;

async function runCycle(): Promise<void> {
  const summary = await replayWorkflowEventSampling({
    lookbackMs: REPLAY_LOOKBACK_MS,
    limit: REPLAY_CHUNK_SIZE,
    maxAttempts: REPLAY_MAX_ATTEMPTS
  });

  const pendingMore = summary.pending > 0;
  const delayMs = pendingMore ? Math.min(REPLAY_INTERVAL_MS, REPLAY_BACKOFF_MS) : REPLAY_INTERVAL_MS;

  if (!shuttingDown) {
    await wait(delayMs);
  }
}

async function runWorker(): Promise<void> {
  await ensureDatabase();
  logger.info('Event sampling replay worker starting');

  process.on('SIGINT', () => {
    shuttingDown = true;
    logger.info('Event sampling replay worker received SIGINT');
  });
  process.on('SIGTERM', () => {
    shuttingDown = true;
    logger.info('Event sampling replay worker received SIGTERM');
  });

  while (!shuttingDown) {
    try {
      await runCycle();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Event sampling replay worker cycle failed', normalizeMeta({ error: message }));
      await wait(REPLAY_BACKOFF_MS);
    }
  }

  logger.info('Event sampling replay worker stopped');
}

if (require.main === module) {
  runWorker().catch((err) => {
    logger.error(
      'Event sampling replay worker encountered an unrecoverable error',
      normalizeMeta({ error: err instanceof Error ? err.message : String(err) })
    );
    process.exit(1);
  });
}

export { runWorker as startEventSamplingReplayWorker };
