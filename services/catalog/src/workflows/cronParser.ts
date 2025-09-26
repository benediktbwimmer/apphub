import { parseExpression } from 'cron-parser';
import type { ParserOptions, CronExpression } from 'cron-parser';

export type { ParserOptions, CronExpression } from 'cron-parser';

function normalizeOptions(options: ParserOptions): ParserOptions {
  const normalized: ParserOptions = { ...options };

  if (typeof normalized.tz === 'string') {
    const tz = normalized.tz.trim();
    if (tz.length === 0) {
      delete normalized.tz;
    } else {
      normalized.tz = tz;
    }
  }

  if (typeof normalized.nthDayOfWeek === 'number' && !Number.isFinite(normalized.nthDayOfWeek)) {
    delete normalized.nthDayOfWeek;
  }

  return normalized;
}

export function parseCronExpression(expression: string, options: ParserOptions = {}): CronExpression {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    throw new Error('Cron expression must be a non-empty string');
  }

  const normalizedOptions = normalizeOptions(options);
  return parseExpression(trimmed, normalizedOptions);
}
