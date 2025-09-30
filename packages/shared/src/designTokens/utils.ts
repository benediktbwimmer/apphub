import type { DeepPartial } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepCopy(item)) as unknown as T;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value).map(([key, val]) => [key, deepCopy(val)]);
    return Object.fromEntries(entries) as T;
  }

  return value;
}

export function deepMerge<T>(base: T, patch?: DeepPartial<T>): T {
  if (patch === undefined) {
    return deepCopy(base);
  }

  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return deepCopy(patch as T);
  }

  const result: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(base), ...Object.keys(patch)]);

  for (const key of keys) {
    const baseValue = (base as Record<string, unknown>)[key];
    const patchValue = (patch as Record<string, unknown>)[key];

    if (patchValue === undefined) {
      result[key] = deepCopy(baseValue);
      continue;
    }

    if (baseValue === undefined) {
      result[key] = deepCopy(patchValue);
      continue;
    }

    result[key] = deepMerge(baseValue, patchValue as DeepPartial<typeof baseValue>);
  }

  return result as T;
}

export function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach((item) => deepFreeze(item));
    return Object.freeze(value);
  }

  if (isPlainObject(value)) {
    Object.values(value).forEach((val) => deepFreeze(val));
    return Object.freeze(value);
  }

  return value;
}

export function mergeThemeObject<T>(base: T, patch?: DeepPartial<T>): T {
  const merged = deepMerge(base, patch);
  return deepFreeze(merged);
}
