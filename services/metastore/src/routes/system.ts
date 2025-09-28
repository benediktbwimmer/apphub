import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConnection } from '../db/client';
import { getFilestoreHealthSnapshot } from '../filestore/consumer';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get('/healthz', async () => ({
    status: 'ok',
    filestore: getFilestoreHealthSnapshot()
  }));

  app.get('/readyz', async (_request: FastifyRequest, reply: FastifyReply) => {
    const filestoreHealth = getFilestoreHealthSnapshot();
    if (filestoreHealth.enabled && !filestoreHealth.inline && !filestoreHealth.connected) {
      reply.status(503);
      return {
        status: 'unavailable',
        reason: filestoreHealth.lastError ?? 'filestore redis connection not ready',
        filestore: filestoreHealth
      };
    }

    await withConnection(async (client) => {
      await client.query('SELECT 1 AS readiness_check');
    });
    return { status: 'ok' };
  });
}
