import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  TicketStore,
  newTicketInputSchema,
  ticketIdSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
  ticketSchema
} from '@apphub/ticketing';

type TicketStatus = z.infer<typeof ticketStatusSchema>;

const statusAliases = ['open', 'closed'] as const;
type StatusAlias = (typeof statusAliases)[number];

const statusAliasMap: Record<StatusAlias, TicketStatus[]> = {
  open: ['backlog', 'in_progress', 'blocked', 'review'],
  closed: ['done', 'archived']
};

const isStatusAlias = (value: string): value is StatusAlias =>
  (statusAliases as readonly string[]).includes(value);

const statusAliasSchema = z.enum(statusAliases);
const ticketStatusFilterSchema = ticketStatusSchema.or(statusAliasSchema);

const authShape = {
  authToken: z.string().trim().min(1).optional()
} as const;

const createTicketIdInput = () =>
  z
    .string()
    .trim()
    .min(3, 'Ticket id must be at least 3 characters long')
    .max(120, 'Ticket id must be at most 120 characters long')
    .regex(
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      'Ticket id must start with an alphanumeric character and contain only alphanumerics, dot, underscore, or dash'
    );

const createTicketShape = {
  ...authShape,
  id: createTicketIdInput().optional(),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  assignees: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  dependencies: z.array(createTicketIdInput()).optional(),
  dueAt: z.string().trim().datetime({ message: 'dueAt must be an ISO-8601 timestamp' }).optional(),
  actor: z.string().trim().min(1).optional(),
  message: z.string().trim().optional()
} as const;

const updateStatusShape = {
  ...authShape,
  id: ticketIdSchema,
  status: ticketStatusSchema,
  comment: z.string().trim().optional(),
  actor: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional()
} as const;

const addDependencyShape = {
  ...authShape,
  id: ticketIdSchema,
  dependencyId: ticketIdSchema,
  actor: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional()
} as const;

const commentShape = {
  ...authShape,
  id: ticketIdSchema,
  comment: z.string().trim().min(1),
  actor: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional()
} as const;

const assignShape = {
  ...authShape,
  id: ticketIdSchema,
  assignees: z.array(z.string().trim().min(1)).min(1),
  mode: z.enum(['set', 'merge']).default('set').optional(),
  actor: z.string().trim().min(1).optional(),
  expectedRevision: z.number().int().positive().optional()
} as const;

const listShape = {
  ...authShape,
  status: z.array(ticketStatusFilterSchema).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  assignee: z.string().trim().min(1).optional()
} as const;

const historyShape = {
  ...authShape,
  id: ticketIdSchema
} as const;

const createTicketSchema = z.object(createTicketShape);
const updateStatusSchema = z.object(updateStatusShape);
const addDependencySchema = z.object(addDependencyShape);
const commentSchema = z.object(commentShape);
const assignSchema = z.object(assignShape);
const listSchema = z.object(listShape);
const historySchema = z.object(historyShape);

export const toolSchemas = {
  createTicket: createTicketSchema,
  updateStatus: updateStatusSchema,
  addDependency: addDependencySchema,
  comment: commentSchema,
  assign: assignSchema,
  list: listSchema,
  history: historySchema
};

export const toolShapes = {
  createTicket: createTicketShape,
  updateStatus: updateStatusShape,
  addDependency: addDependencyShape,
  comment: commentShape,
  assign: assignShape,
  list: listShape,
  history: historyShape
};

export interface TicketingToolContext {
  store: TicketStore;
  tokens: string[];
  defaultActor: string;
}

class AuthorizationError extends Error {
  constructor() {
    super('MCP token is required for this operation');
    this.name = 'AuthorizationError';
  }
}

const requireToken = (tokens: string[], provided?: string | null) => {
  if (tokens.length === 0) {
    return;
  }

  if (!provided || !tokens.includes(provided.trim())) {
    throw new AuthorizationError();
  }
};

const toResult = (data: unknown, description?: string): CallToolResult => {
  const content: CallToolResult['content'] = [];
  if (description) {
    content.push({ type: 'text', text: description });
  }
  content.push({ type: 'text', text: JSON.stringify(data, null, 2) });
  return { content };
};

const summarizeTicket = (ticket: z.infer<typeof ticketSchema>) => ({
  id: ticket.id,
  title: ticket.title,
  status: ticket.status,
  priority: ticket.priority,
  assignees: ticket.assignees,
  tags: ticket.tags,
  updatedAt: ticket.updatedAt,
  revision: ticket.revision
});

const expandStatusFilters = (statuses?: Array<z.infer<typeof ticketStatusFilterSchema>>): TicketStatus[] => {
  if (!statuses || statuses.length === 0) {
    return [];
  }

  const expanded = new Set<TicketStatus>();
  for (const status of statuses) {
    if (isStatusAlias(status)) {
      for (const aliasStatus of statusAliasMap[status]) {
        expanded.add(aliasStatus);
      }
      continue;
    }

    expanded.add(status);
  }

  return Array.from(expanded);
};

export const buildToolHandlers = (ctx: TicketingToolContext) => {
  const { store, tokens, defaultActor } = ctx;

  return {
    createTicket: async (input: z.infer<typeof createTicketSchema>) => {
      requireToken(tokens, input.authToken ?? null);
      const { actor: providedActor, message, authToken: _authToken, ...ticketDraft } = input;
      const actor = providedActor ?? defaultActor;
      const ticket = await store.createTicket(newTicketInputSchema.parse(ticketDraft), {
        actor,
        message: message ?? 'Ticket created via MCP tool'
      });
      return toResult({ ticket }, `Created ticket ${ticket.id}`);
    },

    updateStatus: async (input: z.infer<typeof updateStatusSchema>) => {
      requireToken(tokens, input.authToken ?? null);
      const actor = input.actor ?? defaultActor;
      const updates: Record<string, unknown> = { status: input.status };
      if (input.comment) {
        updates.comment = input.comment;
      }
      const updated = await store.updateTicket(input.id, updates, {
        actor,
        expectedRevision: input.expectedRevision,
        message: input.comment ?? `Status set to ${input.status}`
      });
      return toResult({ ticket: updated }, `Updated ${updated.id} to ${updated.status}`);
    },

    addDependency: async (input: z.infer<typeof addDependencySchema>) => {
      requireToken(tokens, input.authToken ?? null);
      if (input.id === input.dependencyId) {
        throw new Error('A ticket cannot depend on itself');
      }
      const actor = input.actor ?? defaultActor;
      await store.getTicket(input.dependencyId); // ensure dependency exists
      const ticket = await store.getTicket(input.id);
      const nextDependencies = Array.from(new Set([...ticket.dependencies, input.dependencyId]));
      const updated = await store.updateTicket(
        input.id,
        { dependencies: nextDependencies },
        {
          actor,
          expectedRevision: input.expectedRevision,
          message: `Added dependency ${input.dependencyId}`
        }
      );
      return toResult({ ticket: updated }, `Added dependency ${input.dependencyId} to ${updated.id}`);
    },

    comment: async (input: z.infer<typeof commentSchema>) => {
      requireToken(tokens, input.authToken ?? null);
      const actor = input.actor ?? defaultActor;
      const updated = await store.updateTicket(
        input.id,
        { comment: input.comment },
        {
          actor,
          expectedRevision: input.expectedRevision,
          message: 'Comment added via MCP tool'
        }
      );
      return toResult({ ticket: updated }, `Commented on ${updated.id}`);
    },

    assign: async (input: z.infer<typeof assignSchema>) => {
      requireToken(tokens, input.authToken ?? null);
      const actor = input.actor ?? defaultActor;
      const ticket = await store.getTicket(input.id);
      const nextAssignees = input.mode === 'merge'
        ? Array.from(new Set([...ticket.assignees, ...input.assignees]))
        : input.assignees;
      const updated = await store.updateTicket(
        input.id,
        { assignees: nextAssignees },
        {
          actor,
          expectedRevision: input.expectedRevision,
          message: `Assignees ${input.mode === 'merge' ? 'merged' : 'set'} via MCP`
        }
      );
      return toResult({ ticket: updated }, `Updated assignees for ${updated.id}`);
    },

    list: async (input: z.infer<typeof listSchema>) => {
      requireToken(tokens, input.authToken ?? null);
      const tickets = await store.listTickets();
      const expandedStatuses = expandStatusFilters(input.status);
      const hasStatusFilter = expandedStatuses.length > 0;
      const filtered = tickets.filter((ticket) => {
        if (hasStatusFilter && !expandedStatuses.includes(ticket.status)) {
          return false;
        }
        if (input.tags && input.tags.length > 0 && !input.tags.some((tag) => ticket.tags.includes(tag))) {
          return false;
        }
        if (input.assignee && !ticket.assignees.includes(input.assignee)) {
          return false;
        }
        return true;
      });

      return toResult(
        {
          tickets: filtered.map(summarizeTicket)
        },
        `Found ${filtered.length} ticket${filtered.length === 1 ? '' : 's'}`
      );
    },

    history: async (input: z.infer<typeof historySchema>) => {
      requireToken(tokens, input.authToken ?? null);
      const ticket = await store.getTicket(input.id);
      return toResult(
        {
          id: ticket.id,
          history: ticket.history
        },
        `History for ${ticket.id}`
      );
    }
  };
};

export type TicketingToolHandlers = ReturnType<typeof buildToolHandlers>;
