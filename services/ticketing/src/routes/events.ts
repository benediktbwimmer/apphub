import type { FastifyInstance } from 'fastify';

import type { Ticket } from '@apphub/ticketing';

import type { AppContext } from '../types';

const formatEvent = (event: string, payload: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;

export const registerEventRoutes = (app: FastifyInstance, ctx: AppContext) => {
  app.get('/tickets/events', async (request, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.flushHeaders?.();
    reply.hijack();
    reply.raw.write(': connected\n\n');

    const send = (event: string, payload: unknown) => {
      try {
        reply.raw.write(formatEvent(event, payload));
      } catch (error) {
        app.log.error({ err: error, event }, 'Failed to write SSE event');
      }
    };

    const onCreated = (ticket: Ticket) => {
      send('ticket.created', {
        id: ticket.id,
        status: ticket.status,
        revision: ticket.revision
      });
    };

    const onUpdated = (ticket: Ticket) => {
      send('ticket.updated', {
        id: ticket.id,
        status: ticket.status,
        revision: ticket.revision
      });
    };

    const onDeleted = (id: string) => {
      send('ticket.deleted', { id });
    };

    const onRefreshed = () => {
      send('tickets.refreshed', { at: new Date().toISOString() });
    };

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': keep-alive\n\n');
      } catch (error) {
        app.log.warn({ err: error }, 'Failed to send heartbeat, closing stream');
        request.raw.destroy();
      }
    }, 15_000);

    ctx.store.on('ticket:created', onCreated);
    ctx.store.on('ticket:updated', onUpdated);
    ctx.store.on('ticket:deleted', onDeleted);
    ctx.store.on('tickets:refreshed', onRefreshed);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      ctx.store.off('ticket:created', onCreated);
      ctx.store.off('ticket:updated', onUpdated);
      ctx.store.off('ticket:deleted', onDeleted);
      ctx.store.off('tickets:refreshed', onRefreshed);
    });

    return reply;
  });
};
