import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConnection } from '../db/client';
import { getLifecycleQueueHealth } from '../lifecycle/queue';
import { schemaRef } from '../openapi/definitions';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Service health',
        description: 'Reports lifecycle queue status for the timestore service.',
        response: {
          200: {
            description: 'The service is available for traffic.',
            content: {
              'application/json': {
                schema: schemaRef('HealthResponse')
              }
            }
          }
        }
      }
    },
    async () => ({
      status: getLifecycleQueueHealth().ready ? 'ok' : 'degraded',
      lifecycle: getLifecycleQueueHealth()
    })
  );

  app.get(
    '/ready',
    {
      schema: {
        tags: ['System'],
        summary: 'Readiness probe',
        description: 'Performs dependency checks to ensure the service can accept requests.',
        response: {
          200: {
            description: 'All dependencies are available.',
            content: {
              'application/json': {
                schema: schemaRef('ReadyResponse')
              }
            }
          },
          503: {
            description: 'One or more dependencies are unavailable.',
            content: {
              'application/json': {
                schema: schemaRef('ReadyUnavailableResponse')
              }
            }
          }
        }
      }
    },
    async (_request: FastifyRequest, reply: FastifyReply) => {
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
    }
  );
}
