import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConnection } from '../db/client';
import { getLifecycleQueueHealth } from '../lifecycle/queue';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: getLifecycleQueueHealth().ready ? 'ok' : 'degraded',
    lifecycle: getLifecycleQueueHealth()
  }));

  app.get('/ready', async (_request: FastifyRequest, reply: FastifyReply) => {
    const lifecycleHealth = getLifecycleQueueHealth();
    if (!lifecycleHealth.inline && !lifecycleHealth.ready) {
      reply.status(503);
      return {
        status: 'unavailable',
        reason: lifecycleHealth.lastError ?? 'lifecycle queue not ready',
        lifecycle: lifecycleHealth
      };
    }

    await withConnection(async (client) => {
      await client.query('SELECT 1');
    });
    return { status: 'ready' };
  });
}
