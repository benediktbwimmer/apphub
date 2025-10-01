import type { JsonValue } from '../serviceManifestTypes';

const TEMPLATE_PATTERN = /{{\s*([^}]+)\s*}}/g;

type TemplateScope = Record<string, unknown>;

function resolveScopePath(scope: TemplateScope, expression: string): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return undefined;
  }
  const segments = trimmed.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  let current: unknown = scope;
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isNaN(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

function applyModifier(value: unknown, modifierRaw: string): unknown {
  let modifier = modifierRaw.trim();
  let arg: string | undefined;
  const parenMatch = modifier.match(/^([a-zA-Z0-9_-]+)\((.*)\)$/);
  if (parenMatch) {
    modifier = parenMatch[1];
    arg = parenMatch[2]?.trim();
  } else {
    const [name, rawArg] = modifier.split(':', 2).map((part) => part.trim());
    modifier = name;
    arg = rawArg;
  }

  if (!modifier) {
    return value;
  }

  switch (modifier) {
    case 'trim':
      return typeof value === 'string' ? value.trim() : value;
    case 'lower':
      return typeof value === 'string' ? value.toLowerCase() : value;
    case 'upper':
      return typeof value === 'string' ? value.toUpperCase() : value;
    case 'number':
    case 'int':
    case 'float': {
      if (typeof value === 'number') {
        return value;
      }
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : value;
    }
    case 'bool':
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', 'on'].includes(normalized)) {
          return true;
        }
        if (['false', '0', 'no', 'off'].includes(normalized)) {
          return false;
        }
      }
      if (typeof value === 'number') {
        return value !== 0;
      }
      return Boolean(value);
    }
    case 'default':
      if (value === undefined || value === null || (typeof value === 'string' && value.length === 0)) {
        if (!arg) {
          return '';
        }
        const lowered = arg.toLowerCase();
        if (lowered === 'null') {
          return null;
        }
        if (lowered === 'true') {
          return true;
        }
        if (lowered === 'false') {
          return false;
        }
        const numeric = Number(arg);
        if (!Number.isNaN(numeric)) {
          return numeric;
        }
        return arg;
      }
      return value;
    default:
      return value;
  }
}

function resolveExpression(expression: string, scope: TemplateScope): unknown {
  const segments = expression
    .split('|')
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  let value = resolveScopePath(scope, segments[0]);
  for (let index = 1; index < segments.length; index += 1) {
    value = applyModifier(value, segments[index]);
  }
  return value;
}

function coercePrimitive(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(value);
}

export function renderTemplateString(value: string, scope: TemplateScope): string {
  const matches = [...value.matchAll(TEMPLATE_PATTERN)];
  if (matches.length === 0) {
    return value;
  }

  const trimmed = value.trim();
  if (matches.length === 1 && trimmed === matches[0][0]) {
    const resolved = resolveExpression(matches[0][1], scope);
    return coercePrimitive(resolved);
  }

  return value.replace(TEMPLATE_PATTERN, (_match, expression) => {
    const resolved = resolveExpression(expression, scope);
    return coercePrimitive(resolved);
  });
}

export function renderJsonTemplates(value: JsonValue, scope: TemplateScope): JsonValue {
  if (typeof value === 'string') {
    const matches = [...value.matchAll(TEMPLATE_PATTERN)];
    if (matches.length === 1 && value.trim() === matches[0][0]) {
      const resolved = resolveExpression(matches[0][1], scope);
      return normalizeJsonValue(resolved);
    }
    return renderTemplateString(value, scope);
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderJsonTemplates(entry as JsonValue, scope)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      result[key] = renderJsonTemplates(entry, scope);
    }
    return result;
  }
  return value;
}

export function ensureJsonObject(value: JsonValue | undefined, context: string): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context} must resolve to a JSON object`);
  }
  return value as Record<string, JsonValue>;
}

export function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry as JsonValue)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, JsonValue>)) {
      result[key] = cloneJsonValue(entry);
    }
    return result;
  }
  return value;
}

function normalizeJsonValue(value: unknown): JsonValue {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonValue(entry)) as JsonValue;
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = normalizeJsonValue(entry);
    }
    return result;
  }
  return coercePrimitive(value);
}
