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
const LOG_STRING_CHUNK_SIZE = Math.max(1024, Number(process.env.APPHUB_LOG_STRING_CHUNK_SIZE ?? 8192));

function chunkJsonValue(value: JsonValue): { value: JsonValue; changed: boolean } {
  if (typeof value === 'string') {
    if (value.length <= LOG_STRING_CHUNK_SIZE) {
      return { value, changed: false };
    }
    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += LOG_STRING_CHUNK_SIZE) {
      chunks.push(value.slice(index, index + LOG_STRING_CHUNK_SIZE));
    }
    return { value: chunks as unknown as JsonValue, changed: true };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next: JsonValue[] = value.map((entry) => {
      const result = chunkJsonValue(entry as JsonValue);
      if (result.changed) {
        changed = true;
      }
      return result.value;
    });
    if (!changed) {
      return { value, changed: false };
    }
    return { value: next as JsonValue, changed: true };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const next: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      const result = chunkJsonValue(entry);
      next[key] = result.value;
      if (result.changed) {
        changed = true;
      }
    }
    if (!changed) {
      return { value, changed: false };
    }
    return { value: next as JsonValue, changed: true };
  }
  return { value, changed: false };
}

function normalizeLogMeta(meta?: Record<string, JsonValue>): Record<string, JsonValue> | undefined {
  if (!meta) {
    return undefined;
  }
  let changed = false;
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(meta)) {
    const { value: chunked, changed: entryChanged } = chunkJsonValue(value);
    result[key] = chunked;
    if (entryChanged) {
      changed = true;
    }
  }
  return changed ? result : meta;
}

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
  const normalizedMeta = normalizeLogMeta(meta);
  const payload: LogPayload = {
    level,
    message,
    timestamp: new Date().toISOString(),
    source: LOG_SOURCE,
    ...(normalizedMeta ? { meta: normalizedMeta } : {})
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
