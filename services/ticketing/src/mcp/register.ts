import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { buildToolHandlers, toolSchemas, toolShapes, type TicketingToolContext } from './tools';

export const registerTicketingTools = (server: McpServer, ctx: TicketingToolContext) => {
  const handlers = buildToolHandlers(ctx);

  server.tool('ticket.create', toolShapes.createTicket, async (args, _extra) => handlers.createTicket(toolSchemas.createTicket.parse(args)));
  server.tool('ticket.updateStatus', toolShapes.updateStatus, async (args, _extra) => handlers.updateStatus(toolSchemas.updateStatus.parse(args)));
  server.tool('ticket.addDependency', toolShapes.addDependency, async (args, _extra) => handlers.addDependency(toolSchemas.addDependency.parse(args)));
  server.tool('ticket.comment', toolShapes.comment, async (args, _extra) => handlers.comment(toolSchemas.comment.parse(args)));
  server.tool('ticket.assign', toolShapes.assign, async (args, _extra) => handlers.assign(toolSchemas.assign.parse(args)));
  server.tool('ticket.list', toolShapes.list, async (args, _extra) => handlers.list(toolSchemas.list.parse(args)));
  server.tool('ticket.history', toolShapes.history, async (args, _extra) => handlers.history(toolSchemas.history.parse(args)));

  return handlers;
};

export type TicketingToolRegistration = ReturnType<typeof registerTicketingTools>;
