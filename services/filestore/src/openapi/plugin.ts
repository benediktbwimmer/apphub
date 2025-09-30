import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import type { FastifyInstance, RouteOptions } from 'fastify';
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

    const schemaRecord = schema as Record<string, unknown>;
    const hasNullableFlag = typeof schemaRecord.nullable === 'boolean';
    const nullableValue = hasNullableFlag ? Boolean(schemaRecord.nullable) : false;

    const entries = hasNullableFlag
      ? Object.entries(schemaRecord).filter(([key]) => key !== 'nullable')
      : Object.entries(schemaRecord);

    const transformed: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      transformed[key] = prepareForAjv(value);
    }

    if (hasNullableFlag && nullableValue) {
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
  'GET:/health',
  'GET:/healthz',
  'GET:/ready',
  'GET:/readyz',
  'GET:/v1/backend-mounts',
  'GET:/v1/backend-mounts/:id',
  'POST:/v1/backend-mounts',
  'PATCH:/v1/backend-mounts/:id',
  'POST:/v1/files',
  'GET:/v1/files/:id/content',
  'GET:/v1/files/:id/presign',
  'POST:/v1/directories',
  'DELETE:/v1/nodes',
  'POST:/v1/nodes/move',
  'POST:/v1/nodes/copy',
  'PATCH:/v1/nodes/:id/metadata',
  'GET:/v1/nodes',
  'GET:/v1/nodes/:id/children',
  'GET:/v1/nodes/:id',
  'GET:/v1/nodes/by-path',
  'POST:/v1/reconciliation',
  'GET:/v1/reconciliation/jobs',
  'GET:/v1/reconciliation/jobs/:id',
  'GET:/v1/events/stream',
  'GET:/openapi.json'
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
        description: 'Returns the generated OpenAPI document for the filestore service.',
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
