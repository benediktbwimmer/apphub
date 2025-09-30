import type { LoggerOptions } from 'pino';
import { stdTimeFunctions } from 'pino';

export const createLogger = (level: string): LoggerOptions => ({
  level,
  base: undefined,
  timestamp: stdTimeFunctions.isoTime
});
