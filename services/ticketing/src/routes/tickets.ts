import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  newTicketInputSchema,
  ticketDependencyGraphSchema,
  ticketUpdateSchema
} from '@apphub/ticketing';

import type { AppContext } from '../types';
import { mapErrorToResponse } from '../errors';

const listTicketsQuerySchema = z.object({
  view: z.enum(['index']).optional()
});

const createTicketBodySchema = z.object({
  ticket: newTicketInputSchema,
  actor: z.string().trim().min(1).optional(),
  message: z.string().trim().optional()
});

const updateTicketBodySchema = z.object({
  updates: ticketUpdateSchema,
  actor: z.string().trim().min(1).optional(),
  message: z.string().trim().optional(),
  expectedRevision: z.number().int().positive().optional()
});

const deleteTicketBodySchema = z.object({
  expectedRevision: z.number().int().positive().optional()
});

export const registerTicketRoutes = (app: FastifyInstance, ctx: AppContext) => {
  app.get('/tickets', async (request, reply) => {
    const parseResult = listTicketsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      const mapped = mapErrorToResponse(parseResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    const { view } = parseResult.data;

    if (view === 'index') {
      const index = await ctx.store.getIndex();
      return index;
    }

    const tickets = await ctx.store.listTickets();
    return { tickets };
  });

  app.get('/tickets/:ticketId', async (request, reply) => {
    const paramsSchema = z.object({ ticketId: z.string() });
    const parseResult = paramsSchema.safeParse(request.params);
    if (!parseResult.success) {
      const mapped = mapErrorToResponse(parseResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    try {
      const ticket = await ctx.store.getTicket(parseResult.data.ticketId);
      return ticket;
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }
  });

  app.get('/tickets/:ticketId/history', async (request, reply) => {
    const paramsSchema = z.object({ ticketId: z.string() });
    const parseResult = paramsSchema.safeParse(request.params);
    if (!parseResult.success) {
      const mapped = mapErrorToResponse(parseResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    try {
      const ticket = await ctx.store.getTicket(parseResult.data.ticketId);
      return { id: ticket.id, history: ticket.history };
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }
  });

  app.get('/tickets/dependencies', async (request, reply) => {
    try {
      const graph = await ctx.store.getDependencyGraph();
      const validation = ticketDependencyGraphSchema.safeParse(graph);
      if (!validation.success) {
        return reply.status(500).send({ message: 'Dependency graph failed validation', details: validation.error.format() });
      }
      return graph;
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }
  });

  app.post('/tickets', async (request, reply) => {
    const parseResult = createTicketBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const mapped = mapErrorToResponse(parseResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    const { ticket, actor, message } = parseResult.data;

    try {
      const created = await ctx.store.createTicket(ticket, {
        actor,
        message
      });
      ctx.metrics.ticketsCreated.inc({ source: 'api' });
      reply.status(201);
      return created;
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }
  });

  app.patch('/tickets/:ticketId', async (request, reply) => {
    const paramsSchema = z.object({ ticketId: z.string() });
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const mapped = mapErrorToResponse(paramsResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    const bodyResult = updateTicketBodySchema.safeParse(request.body);
    if (!bodyResult.success) {
      const mapped = mapErrorToResponse(bodyResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    const { ticketId } = paramsResult.data;
    const { updates, actor, message, expectedRevision } = bodyResult.data;

    try {
      const updated = await ctx.store.updateTicket(ticketId, updates, {
        actor,
        message,
        expectedRevision
      });
      ctx.metrics.ticketsUpdated.inc({ source: 'api' });
      return updated;
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }
  });

  app.delete('/tickets/:ticketId', async (request, reply) => {
    const paramsSchema = z.object({ ticketId: z.string() });
    const paramsResult = paramsSchema.safeParse(request.params);
    if (!paramsResult.success) {
      const mapped = mapErrorToResponse(paramsResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    const bodyResult = deleteTicketBodySchema.safeParse(request.body ?? {});
    if (!bodyResult.success) {
      const mapped = mapErrorToResponse(bodyResult.error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }

    const { ticketId } = paramsResult.data;
    const { expectedRevision } = bodyResult.data;

    try {
      await ctx.store.deleteTicket(ticketId, { expectedRevision });
      ctx.metrics.ticketsDeleted.inc({ source: 'api' });
      return reply.status(204).send();
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.status(mapped.statusCode).send({ message: mapped.message, details: mapped.details });
    }
  });
};
