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

    const schemaRecord = schema as Record<string, unknown>;
    const hasBooleanNullable = typeof schemaRecord.nullable === 'boolean';
    const nullableFlag = hasBooleanNullable ? Boolean(schemaRecord.nullable) : false;

    const entries = hasBooleanNullable
      ? Object.entries(schemaRecord).filter(([key]) => key !== 'nullable')
      : Object.entries(schemaRecord);

    const transformed: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      transformed[key] = prepareForAjv(value);
    }

    if (hasBooleanNullable && nullableFlag) {
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

const documentedRouteEntries: Array<`${string}:${string}`> = [
  'GET:/health',
  'GET:/ready',
  'POST:/datasets/:datasetSlug/ingest',
  'POST:/datasets/:datasetSlug/query',
  'GET:/sql/schema',
  'POST:/sql/read',
  'POST:/sql/exec',
  'GET:/sql/saved',
  'GET:/sql/saved/:id',
  'PUT:/sql/saved/:id',
  'DELETE:/sql/saved/:id',
  'POST:/v1/datasets/:datasetSlug/ingest',
  'POST:/v1/datasets/:datasetSlug/query',
  'GET:/v1/sql/schema',
  'POST:/v1/sql/read',
  'POST:/v1/sql/exec',
  'GET:/v1/sql/saved',
  'GET:/v1/sql/saved/:id',
  'PUT:/v1/sql/saved/:id',
  'DELETE:/v1/sql/saved/:id',
  'GET:/openapi.json'
];

const documentedRoutes = new Set(documentedRouteEntries);

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
        description: 'Returns the generated OpenAPI document for the timestore service.',
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
