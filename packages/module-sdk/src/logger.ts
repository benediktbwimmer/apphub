export interface ModuleLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string | Error, meta?: Record<string, unknown>): void;
}

export const noopLogger: ModuleLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
};

export function createConsoleLogger(prefix?: string): ModuleLogger {
  const base = prefix ? `[${prefix}]` : undefined;
  return {
    debug(message, meta) {
      console.debug(base ? `${base} ${message}` : message, meta ?? '');
    },
    info(message, meta) {
      console.info(base ? `${base} ${message}` : message, meta ?? '');
    },
    warn(message, meta) {
      console.warn(base ? `${base} ${message}` : message, meta ?? '');
    },
    error(message, meta) {
      if (message instanceof Error) {
        console.error(base ? `${base} ${message.message}` : message.message, meta ?? '', message);
      } else {
        console.error(base ? `${base} ${message}` : message, meta ?? '');
      }
    }
  } satisfies ModuleLogger;
}
