import type { JsonValue } from '../db/types';

export function mergeJsonObjects(
  base: JsonValue | null | undefined,
  addition: Record<string, JsonValue> | null | undefined
): JsonValue {
  if (!addition) {
    return base ?? null;
  }
  const entries = Object.entries(addition).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return base ?? null;
  }
  const additionObject = Object.fromEntries(entries) as Record<string, JsonValue>;
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return additionObject;
  }
  return {
    ...(base as Record<string, JsonValue>),
    ...additionObject
  } satisfies JsonValue;
}

export function asJsonObject(value: JsonValue | null | undefined): Record<string, JsonValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, JsonValue>;
}
