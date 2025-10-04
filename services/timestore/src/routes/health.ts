import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withConnection } from '../db/client';
import { getLifecycleQueueHealth } from '../lifecycle/queue';
import { schemaRef } from '../openapi/definitions';
import { loadServiceConfig } from '../config/serviceConfig';
import { evaluateStreamingStatus } from '../streaming/status';

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
          },
          503: {
            description: 'Streaming is enabled but not ready.',
            content: {
              'application/json': {
                schema: schemaRef('HealthUnavailableResponse')
              }
            }
          }
        }
      }
    },
    async (_request, reply) => {
      const config = loadServiceConfig();
      const lifecycleHealth = getLifecycleQueueHealth();
      const streamingStatus = evaluateStreamingStatus(config);

      const streamingReady = !streamingStatus.enabled || streamingStatus.state === 'ready';
      const overallStatus = lifecycleHealth.ready && streamingReady ? 'ok' : 'degraded';

      if (!streamingReady) {
        reply.status(streamingStatus.state === 'degraded' ? 503 : 503);
        return {
          status: streamingStatus.state === 'degraded' ? 'degraded' : 'unavailable',
          lifecycle: lifecycleHealth,
          features: {
            streaming: streamingStatus
          }
        };
      }

      return {
        status: overallStatus,
        lifecycle: lifecycleHealth,
        features: {
          streaming: streamingStatus
        }
      };
    }
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
      const config = loadServiceConfig();
      const lifecycleHealth = getLifecycleQueueHealth();
      const streamingStatus = evaluateStreamingStatus(config);

      if (!lifecycleHealth.inline && !lifecycleHealth.ready) {
        reply.status(503);
        return {
          status: 'unavailable',
          reason: lifecycleHealth.lastError ?? 'lifecycle queue not ready',
          lifecycle: lifecycleHealth,
          features: {
            streaming: streamingStatus
          }
        };
      }

      const streamingReady = !streamingStatus.enabled || streamingStatus.state === 'ready';

      if (!streamingReady) {
        reply.status(503);
        return {
          status: 'unavailable',
          reason: streamingStatus.reason ?? 'streaming dependencies are not ready',
          lifecycle: lifecycleHealth,
          features: {
            streaming: streamingStatus
          }
        };
      }

      await withConnection(async (client) => {
        await client.query('SELECT 1');
      });
      return {
        status: 'ready',
        features: {
          streaming: streamingStatus
        }
      };
    }
  );
}
