import type { FastifyInstance, RouteOptions } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import {
  openApiComponents,
  openApiInfo,
  openApiServers,
  openApiTags,
  schemaId
} from './definitions';

function prepareForAjv(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => prepareForAjv(entry));
  }
  if (schema && typeof schema === 'object') {
    if ('$ref' in (schema as Record<string, unknown>)) {
      return schema;
    }

    const { nullable, ...rest } = schema as Record<string, unknown> & { nullable?: boolean };
    const transformed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) {
      transformed[key] = prepareForAjv(value);
    }

    if (nullable) {
      if ('type' in transformed && transformed.type !== undefined) {
        const typeValue = transformed.type;
        const types = Array.isArray(typeValue) ? typeValue : [typeValue];
        transformed.type = Array.from(new Set([...types, 'null']));
        return transformed;
      }
      return {
        anyOf: [transformed, { type: 'null' }]
      };
    }

    return transformed;
  }
  return schema;
}

const documentedRoutes = new Set<`${string}:${string}`>([
  'GET:/auth/login',
  'GET:/auth/callback',
  'POST:/auth/logout',
  'GET:/auth/identity',
  'GET:/auth/api-keys',
  'POST:/auth/api-keys',
  'DELETE:/auth/api-keys/:id',
  'GET:/health',
  'GET:/apps',
  'POST:/apps',
  'GET:/apps/:id',
  'GET:/saved-searches',
  'POST:/saved-searches',
  'GET:/saved-searches/:slug',
  'PATCH:/saved-searches/:slug',
  'DELETE:/saved-searches/:slug',
  'POST:/saved-searches/:slug/apply',
  'POST:/saved-searches/:slug/share',
  'GET:/events/saved-views',
  'POST:/events/saved-views',
  'GET:/events/saved-views/:slug',
  'PATCH:/events/saved-views/:slug',
  'DELETE:/events/saved-views/:slug',
  'POST:/events/saved-views/:slug/apply',
  'POST:/events/saved-views/:slug/share',
  'GET:/services',
  'POST:/services',
  'PATCH:/services/:slug',
  'GET:/jobs',
  'POST:/jobs',
  'GET:/jobs/runtimes',
  'GET:/job-runs',
  'GET:/jobs/:slug',
  'GET:/jobs/:slug/bundle-editor',
  'POST:/jobs/:slug/bundle/ai-edit',
  'POST:/jobs/:slug/bundle/regenerate',
  'POST:/jobs/:slug/run',
  'PATCH:/jobs/:slug',
  'POST:/jobs/schema-preview',
  'POST:/jobs/python-snippet/preview',
  'POST:/jobs/python-snippet',
  'GET:/assets/graph',
  'GET:/openapi.json',
  'POST:/workflows/:slug/assets/:assetId/stale',
  'DELETE:/workflows/:slug/assets/:assetId/stale',
  'GET:/workflows/:slug/auto-materialize',
  'GET:/workflows/graph',
  'GET:/workflows',
  'POST:/workflows'
]);

function ensureDocumentedRoutesHaveSchemas(app: FastifyInstance) {
  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (!method) {
        continue;
      }
      const key = `${method.toUpperCase()}:${route.url}` as const;
      if (!documentedRoutes.has(key)) {
        continue;
      }
      if (!route.schema || !route.schema.response) {
        throw new Error(`Missing OpenAPI schema for ${method.toUpperCase()} ${route.url}`);
      }
    }
  });
}

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  ensureDocumentedRoutesHaveSchemas(app);

  const componentSchemas = openApiComponents.schemas ?? {};
  for (const [name, schema] of Object.entries(componentSchemas)) {
    const ajvSchema = prepareForAjv(schema);
    if (ajvSchema && typeof ajvSchema === 'object') {
      app.addSchema({
        $id: schemaId(name),
        ...(ajvSchema as Record<string, unknown>)
      });
    }
  }

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: openApiInfo,
      servers: openApiServers,
      tags: openApiTags,
      components: openApiComponents
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
        description: 'Returns the generated OpenAPI document for the catalog service.',
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
    async () => app.swagger()
  );
}
