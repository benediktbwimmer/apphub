import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConnection } from '../db/client';
import { getFilestoreEventsHealth, isFilestoreEventsReady } from '../events/publisher';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    status: isFilestoreEventsReady() ? 'ok' : 'degraded',
    events: getFilestoreEventsHealth()
  }));
  app.get('/health', async () => ({
    status: isFilestoreEventsReady() ? 'ok' : 'degraded',
    events: getFilestoreEventsHealth()
  }));

  async function readinessCheck(_request: FastifyRequest, reply: FastifyReply) {
    const eventsHealth = getFilestoreEventsHealth();
    if (!eventsHealth.ready) {
      reply.status(503);
      return {
        status: 'unavailable',
        reason: eventsHealth.lastError ?? 'filestore events redis connection not ready',
        events: eventsHealth
      };
    }
    await withConnection(async (client) => {
      await client.query('SELECT 1 AS readiness_check');
    });
    return { status: 'ok' };
  }

  app.get('/readyz', readinessCheck);
  app.get('/ready', readinessCheck);
}
