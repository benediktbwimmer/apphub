function cloneRegExp(source: RegExp): RegExp {
  const flags = source.flags.replace(/g/g, '');
  return new RegExp(source.source, flags);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SanitizeIdentifierOptions {
  allow?: RegExp;
  replacement?: string;
  collapse?: boolean;
  trim?: boolean;
}

const DEFAULT_ALLOW = /[0-9A-Za-z._-]/;

export function sanitizeIdentifier(value: string, options: SanitizeIdentifierOptions = {}): string {
  const source = value ?? '';
  if (!source) {
    return '';
  }
  const allow = options.allow ? cloneRegExp(options.allow) : cloneRegExp(DEFAULT_ALLOW);
  const replacement = options.replacement ?? '-';

  let result = '';
  for (const char of source) {
    if (allow.test(char)) {
      result += char;
    } else if (replacement.length > 0) {
      result += replacement;
    }
  }

  if (replacement.length > 0 && options.collapse !== false) {
    const pattern = new RegExp(`${escapeRegExp(replacement)}{2,}`, 'g');
    result = result.replace(pattern, replacement);
  }

  if (replacement.length > 0 && options.trim !== false) {
    const boundary = new RegExp(`^${escapeRegExp(replacement)}+|${escapeRegExp(replacement)}+$`, 'g');
    result = result.replace(boundary, '');
  }

  return result;
}

export interface TemporalKeyOptions {
  replacement?: string;
}

export function toTemporalKey(value: string, options: TemporalKeyOptions = {}): string {
  const replacement = options.replacement ?? '-';
  const normalized = value.replace(/[:\s]+/g, replacement);
  return sanitizeIdentifier(normalized, { replacement });
}
