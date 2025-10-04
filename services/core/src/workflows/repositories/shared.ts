import type { JsonValue } from '../../db/types';

export function serializeJson(value: JsonValue | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  return JSON.stringify(value);
}

export function reuseJsonColumn(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export function serializeTriggerJson(value: JsonValue | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

export function jsonValuesEqual(a: JsonValue | null, b: JsonValue | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
