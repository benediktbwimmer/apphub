import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { buildToolHandlers, toolSchemas, toolShapes, type TicketingToolContext } from './tools';

type ToolKey = keyof typeof toolSchemas;

export const ticketingToolNames = {
  createTicket: 'ticket_create',
  updateStatus: 'ticket_update_status',
  addDependency: 'ticket_add_dependency',
  comment: 'ticket_comment',
  assign: 'ticket_assign',
  list: 'ticket_list',
  history: 'ticket_history'
} as const satisfies Record<ToolKey, string>;

export const ticketingToolNameList = Object.values(ticketingToolNames);

export const registerTicketingTools = (server: McpServer, ctx: TicketingToolContext) => {
  const handlers = buildToolHandlers(ctx);

  server.tool(
    ticketingToolNames.createTicket,
    toolShapes.createTicket,
    async (args: unknown, _extra: unknown) => handlers.createTicket(toolSchemas.createTicket.parse(args))
  );
  server.tool(
    ticketingToolNames.updateStatus,
    toolShapes.updateStatus,
    async (args: unknown, _extra: unknown) => handlers.updateStatus(toolSchemas.updateStatus.parse(args))
  );
  server.tool(
    ticketingToolNames.addDependency,
    toolShapes.addDependency,
    async (args: unknown, _extra: unknown) => handlers.addDependency(toolSchemas.addDependency.parse(args))
  );
  server.tool(
    ticketingToolNames.comment,
    toolShapes.comment,
    async (args: unknown, _extra: unknown) => handlers.comment(toolSchemas.comment.parse(args))
  );
  server.tool(
    ticketingToolNames.assign,
    toolShapes.assign,
    async (args: unknown, _extra: unknown) => handlers.assign(toolSchemas.assign.parse(args))
  );
  server.tool(
    ticketingToolNames.list,
    toolShapes.list,
    async (args: unknown, _extra: unknown) => handlers.list(toolSchemas.list.parse(args))
  );
  server.tool(
    ticketingToolNames.history,
    toolShapes.history,
    async (args: unknown, _extra: unknown) => handlers.history(toolSchemas.history.parse(args))
  );

  return handlers;
};

export type TicketingToolRegistration = ReturnType<typeof registerTicketingTools>;
