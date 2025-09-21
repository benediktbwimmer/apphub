import type { JsonValue } from '../db/types';

type LogLevel = 'info' | 'warn' | 'error';

type LogPayload = {
  level: LogLevel;
  message: string;
  timestamp: string;
  source: string;
  meta?: Record<string, JsonValue>;
};

const LOG_SOURCE = process.env.APPHUB_LOG_SOURCE || 'catalog-service';
const AGGREGATOR_URL = process.env.APPHUB_LOG_AGGREGATOR_URL?.trim() || '';
const AGGREGATOR_TOKEN = process.env.APPHUB_LOG_AGGREGATOR_TOKEN?.trim() || '';

function outputToConsole(payload: LogPayload): void {
  const record = JSON.stringify(payload);
  switch (payload.level) {
    case 'info':
      console.log(record); // eslint-disable-line no-console
      break;
    case 'warn':
      console.warn(record); // eslint-disable-line no-console
      break;
    case 'error':
    default:
      console.error(record); // eslint-disable-line no-console
      break;
  }
}

async function sendToAggregator(payload: LogPayload): Promise<void> {
  if (!AGGREGATOR_URL) {
    return;
  }
  try {
    await fetch(AGGREGATOR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(AGGREGATOR_TOKEN ? { authorization: `Bearer ${AGGREGATOR_TOKEN}` } : {})
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'Failed to deliver log payload to aggregator',
        timestamp: new Date().toISOString(),
        source: LOG_SOURCE,
        meta: { error: message }
      })
    );
  }
}

export function logStructured(
  level: LogLevel,
  message: string,
  meta?: Record<string, JsonValue>
): void {
  const payload: LogPayload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    source: LOG_SOURCE,
    ...(meta ? { meta } : {})
  };
  outputToConsole(payload);
  void sendToAggregator(payload);
}

export const logger = {
  info(message: string, meta?: Record<string, JsonValue>) {
    logStructured('info', message, meta);
  },
  warn(message: string, meta?: Record<string, JsonValue>) {
    logStructured('warn', message, meta);
  },
  error(message: string, meta?: Record<string, JsonValue>) {
    logStructured('error', message, meta);
  }
};
