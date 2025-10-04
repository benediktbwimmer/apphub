import type { FastifyInstance } from 'fastify';
import { loadServiceConfig } from '../config/serviceConfig';
import { evaluateStreamingStatus } from '../streaming/status';
import { schemaRef } from '../openapi/definitions';

export async function registerStreamingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/streaming/status',
    {
      schema: {
        tags: ['System'],
        summary: 'Streaming runtime status',
        description: 'Reports the current state of streaming brokers, micro-batchers, and the hot buffer.',
        response: {
          200: {
            description: 'Streaming status snapshot.',
            content: {
              'application/json': {
                schema: schemaRef('StreamingStatus')
              }
            }
          }
        }
      }
    },
    async () => {
      const config = loadServiceConfig();
      return evaluateStreamingStatus(config);
    }
  );
}
