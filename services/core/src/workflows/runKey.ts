export const RUN_KEY_MAX_LENGTH = 120;
const RUN_KEY_ALLOWED_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const SEPARATOR_TRIM_PATTERN = /^[\-_.:]+|[\-_.:]+$/g;
const DISALLOWED_CHAR_PATTERN = /[^A-Za-z0-9_.:-]+/g;

export function normalizeRunKey(raw: string): { runKey: string; normalized: string } {
  if (typeof raw !== 'string') {
    throw new Error('run key must be a string');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('run key cannot be empty');
  }
  const sliced = trimmed.length > RUN_KEY_MAX_LENGTH ? trimmed.slice(0, RUN_KEY_MAX_LENGTH) : trimmed;
  const collapsed = collapseSeparators(sliced);
  const sanitized = collapsed.replace(SEPARATOR_TRIM_PATTERN, '');
  if (!sanitized) {
    throw new Error('run key cannot consist solely of separators');
  }
  if (!RUN_KEY_ALLOWED_PATTERN.test(sanitized)) {
    throw new Error('run key contains invalid characters');
  }
  const normalized = collapseHyphens(sanitized.toLowerCase()).replace(SEPARATOR_TRIM_PATTERN, '');
  if (!normalized) {
    throw new Error('normalized run key cannot be empty');
  }
  return {
    runKey: sanitized,
    normalized
  };
}

export function computeRunKeyColumns(
  input: string | null | undefined
): { runKey: string | null; runKeyNormalized: string | null } {
  if (input === undefined || input === null) {
    return { runKey: null, runKeyNormalized: null };
  }
  const { runKey, normalized } = normalizeRunKey(input);
  return { runKey, runKeyNormalized: normalized };
}

export function ensureFallbackRunKey(
  base: string,
  suffix: string
): { runKey: string; runKeyNormalized: string } {
  const candidate = `${base}-${suffix}`.slice(0, RUN_KEY_MAX_LENGTH);
  const { runKey, normalized } = normalizeRunKey(candidate);
  return { runKey, runKeyNormalized: normalized };
}

export function buildRunKeyFromParts(...parts: Array<string | number | null | undefined>): string | null {
  const tokens = parts
    .map((part) => {
      if (part === null || part === undefined) {
        return null;
      }
      const text = typeof part === 'number' ? part.toString(10) : String(part);
      const trimmed = text.trim();
      if (!trimmed) {
        return null;
      }
      const sanitized = collapseHyphens(trimmed.replace(DISALLOWED_CHAR_PATTERN, '-')).replace(
        SEPARATOR_TRIM_PATTERN,
        ''
      );
      return sanitized.length > 0 ? sanitized : null;
    })
    .filter((value): value is string => value !== null);

  if (tokens.length === 0) {
    return null;
  }

  const assembled = tokens.join('-');
  return assembled.slice(0, RUN_KEY_MAX_LENGTH);
}

function collapseSeparators(value: string): string {
  return collapseHyphens(value);
}

function collapseHyphens(value: string): string {
  return value.replace(/-{2,}/g, '-');
}
