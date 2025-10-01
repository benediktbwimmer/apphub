import type { JsonValue } from '../db/types';

function convert(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      const converted = convert(item);
      if (converted !== undefined) {
        result.push(converted);
      }
    }
    return result;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of entries) {
      const converted = convert(entryValue);
      if (converted !== undefined) {
        result[key] = converted;
      }
    }
    return result;
  }
  return String(value);
}

export function normalizeMeta(meta?: Record<string, unknown>): Record<string, JsonValue> | undefined {
  if (!meta) {
    return undefined;
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(meta)) {
    const converted = convert(value);
    if (converted !== undefined) {
      result[key] = converted;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
