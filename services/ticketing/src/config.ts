import path from 'node:path';

export interface TicketingConfig {
  host: string;
  port: number;
  logLevel: string;
  ticketsDir: string;
  enableWatcher: boolean;
}

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
};

export const loadConfig = (): TicketingConfig => {
  const port = Number.parseInt(process.env.TICKETING_PORT ?? '4100', 10);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error('TICKETING_PORT must be a positive integer');
  }

  const host = process.env.TICKETING_HOST?.trim() || '0.0.0.0';
  const logLevel = process.env.TICKETING_LOG_LEVEL?.trim() || 'info';
  const ticketsDirEnv = process.env.TICKETING_TICKETS_DIR?.trim();
  const ticketsDir = path.resolve(process.cwd(), ticketsDirEnv || 'tickets');
  const enableWatcher = toBool(process.env.TICKETING_ENABLE_WATCHER, true);

  return {
    host,
    port,
    logLevel,
    ticketsDir,
    enableWatcher
  };
};
