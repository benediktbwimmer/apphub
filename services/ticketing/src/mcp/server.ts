import process from 'node:process';

import { TicketStore } from '@apphub/ticketing';

import { loadMcpConfig } from './config';
import { startTicketingMcpServer } from './runtime';
import pkg from '../../package.json';

const start = async () => {
  const config = loadMcpConfig();
  if (!config.enabled) {
    // eslint-disable-next-line no-console
    console.error('Ticketing MCP server is disabled via TICKETING_MCP_ENABLED');
    process.exit(0);
  }

  const store = new TicketStore({
    rootDir: config.ticketsDir,
    defaultActor: config.defaultActor
  });
  await store.init();

  // eslint-disable-next-line no-console
  console.error('Starting ticketing MCP server (stdio transport)...');
  await startTicketingMcpServer(store, {
    name: 'apphub-ticketing',
    version: pkg.version ?? '0.1.0',
    tokens: config.tokens,
    defaultActor: config.defaultActor
  });
};

start().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Uncaught error in ticketing MCP server', error);
  process.exit(1);
});
