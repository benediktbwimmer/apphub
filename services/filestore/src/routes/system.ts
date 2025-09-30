import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConnection } from '../db/client';
import { getFilestoreEventsHealth, isFilestoreEventsReady } from '../events/publisher';
import { schemaRef } from '../openapi/definitions';

export async function registerSystemRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/healthz',
    {
      schema: {
        tags: ['System'],
        summary: 'Legacy health probe',
        description: 'Returns basic service health including event subsystem status.',
        response: {
          200: {
            description: 'Service is reachable.',
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
      status: isFilestoreEventsReady() ? 'ok' : 'degraded',
      events: getFilestoreEventsHealth()
    })
  );

  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Service health',
        description: 'Reports high-level health information for the filestore service.',
        response: {
          200: {
            description: 'Service is reachable.',
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
      status: isFilestoreEventsReady() ? 'ok' : 'degraded',
      events: getFilestoreEventsHealth()
    })
  );

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

  const readinessSchema = {
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
  } as const;

  app.get('/readyz', { schema: readinessSchema }, readinessCheck);
  app.get('/ready', { schema: readinessSchema }, readinessCheck);
}
