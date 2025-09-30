import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TicketStore } from '@apphub/ticketing';

import { registerTicketingTools } from './register';
import type { TicketingToolContext } from './tools';

export interface StartTicketingMcpOptions {
  name: string;
  version: string;
  tokens: string[];
  defaultActor: string;
}

export const startTicketingMcpServer = async (
  store: TicketStore,
  options: StartTicketingMcpOptions
) => {
  const server = new McpServer({
    name: options.name,
    version: options.version,
    capabilities: {
      tools: {}
    }
  });

  const ctx: TicketingToolContext = {
    store,
    tokens: options.tokens,
    defaultActor: options.defaultActor
  };

  registerTicketingTools(server, ctx);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  return server;
};
