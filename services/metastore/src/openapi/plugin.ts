import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { openApiDocument } from './document';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    mode: 'static',
    specification: {
      document: openApiDocument
    }
  });

  await app.register(swaggerUI, {
    routePrefix: '/docs',
    staticCSP: true,
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true
    }
  });

  app.get(
    '/openapi.json',
    {
      schema: {
        tags: ['System'],
        summary: 'OpenAPI specification',
        description: 'Returns the generated OpenAPI document for the metastore service.',
        response: {
          200: {
            description: 'The generated OpenAPI document.',
            content: {
              'application/json': {
                schema: {
                  type: 'object'
                }
              }
            }
          }
        }
      }
    },
    async () => openApiDocument
  );
}
