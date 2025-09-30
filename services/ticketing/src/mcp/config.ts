import path from 'node:path';

import { loadConfig } from '../config';

export type McpTransport = 'stdio';

export interface TicketingMcpConfig {
  enabled: boolean;
  transport: McpTransport;
  host: string;
  port: number;
  tokens: string[];
  defaultActor: string;
  ticketsDir: string;
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

export const loadMcpConfig = (): TicketingMcpConfig => {
  const serviceConfig = loadConfig();
  const enabled = toBool(process.env.TICKETING_MCP_ENABLED, true);
  const transport: McpTransport = 'stdio';
  const host = process.env.TICKETING_MCP_HOST?.trim() || '127.0.0.1';
  const port = Number.parseInt(process.env.TICKETING_MCP_PORT ?? '4101', 10);
  const defaultActor = process.env.TICKETING_MCP_ACTOR?.trim() || 'mcp';
  const tokenEnv = process.env.TICKETING_MCP_TOKENS ?? '';
  const tokens = tokenEnv
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (Number.isNaN(port) || port <= 0) {
    throw new Error('TICKETING_MCP_PORT must be a positive integer');
  }

  const ticketsDirEnv = process.env.TICKETING_MCP_TICKETS_DIR?.trim();
  const ticketsDir = path.resolve(process.cwd(), ticketsDirEnv || serviceConfig.ticketsDir);

  return {
    enabled,
    transport,
    host,
    port,
    tokens,
    defaultActor,
    ticketsDir
  };
};
