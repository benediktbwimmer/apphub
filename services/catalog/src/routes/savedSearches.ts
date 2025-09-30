import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearchBySlug,
  listSavedSearches,
  recordSavedSearchApplied,
  recordSavedSearchShared,
  updateSavedSearch,
  type SavedSearchCreateInput,
  type SavedSearchRecord,
  type SavedSearchUpdateInput,
  type SavedSearchOwner
} from '../db/savedSearches';
import { jsonValueSchema } from '../workflows/zodSchemas';
import { requireOperatorScopes, type OperatorAuthSuccess } from './shared/operatorAuth';
import { schemaRef } from '../openapi/definitions';

const stringArraySchema = z.preprocess((value) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry : String(entry ?? '')))
      .filter((entry) => entry.trim().length > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
  return undefined;
}, z.array(z.string().min(1).max(100)).max(50).optional());

const savedSearchCreateSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.union([z.string().max(500), z.null()]).optional(),
    searchInput: z.string().max(500).optional(),
    statusFilters: stringArraySchema,
    sort: z.string().max(100).optional(),
    category: z.string().min(1).max(100).optional(),
    config: jsonValueSchema.optional()
  })
  .strict();

const savedSearchUpdateSchema = savedSearchCreateSchema.partial().strict();

const savedSearchSlugParamsSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
  })
  .strict();

const savedSearchListQuerySchema = z
  .object({
    category: z.string().min(1).max(100).optional()
  })
  .partial();

const savedSearchListQueryOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: {
      type: 'string',
      description: 'Optional category slug used to filter saved searches.'
    }
  }
} as const;

const savedSearchSlugParamsOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug'],
  properties: {
    slug: {
      type: 'string',
      description: 'Saved search slug assigned when the record was created.'
    }
  }
} as const;

function jsonResponse(schemaName: string, description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef(schemaName)
      }
    }
  } as const;
}

const errorResponse = (description: string) => jsonResponse('ErrorResponse', description);

function resolveOwner(auth: OperatorAuthSuccess): SavedSearchOwner {
  const identity = auth.identity;
  const userId = identity.userId ?? null;
  const tokenHash = identity.tokenHash ?? null;
  const sessionId = identity.sessionId ?? null;

  const ownerKey = userId
    ? `user:${userId}`
    : tokenHash
      ? `token:${tokenHash}`
      : sessionId
        ? `session:${sessionId}`
        : `subject:${identity.subject}`;

  return {
    key: ownerKey,
    userId,
    subject: identity.subject,
    kind: identity.kind,
    tokenHash
  } satisfies SavedSearchOwner;
}

function serializeSavedSearch(record: SavedSearchRecord) {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    searchInput: record.searchInput,
    statusFilters: record.statusFilters,
    sort: record.sort,
    category: record.category,
    config: record.config,
    visibility: record.visibility,
    appliedCount: record.appliedCount,
    sharedCount: record.sharedCount,
    lastAppliedAt: record.lastAppliedAt,
    lastSharedAt: record.lastSharedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function normalizeDescriptionInput(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toCreateInput(payload: z.infer<typeof savedSearchCreateSchema>): SavedSearchCreateInput {
  const description = normalizeDescriptionInput(payload.description);

  return {
    name: payload.name,
    description: description ?? null,
    searchInput: payload.searchInput,
    statusFilters: payload.statusFilters,
    sort: payload.sort,
    category: payload.category,
    config: payload.config
  } satisfies SavedSearchCreateInput;
}

function toUpdateInput(payload: z.infer<typeof savedSearchUpdateSchema>): SavedSearchUpdateInput {
  const description = normalizeDescriptionInput(payload.description);

  return {
    name: payload.name,
    description,
    searchInput: payload.searchInput,
    statusFilters: payload.statusFilters,
    sort: payload.sort,
    category: payload.category,
    config: payload.config
  } satisfies SavedSearchUpdateInput;
}

export async function registerSavedSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/saved-searches',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'List saved catalog searches',
        description: 'Returns saved catalog searches owned by the authenticated operator.',
        security: [{ OperatorToken: [] }],
        querystring: savedSearchListQueryOpenApiSchema,
        response: {
          200: jsonResponse('SavedCatalogSearchListResponse', 'Saved searches available to the caller.'),
          400: errorResponse('The saved search filters were invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to access saved searches.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.list',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parseQuery = savedSearchListQuerySchema.safeParse(request.query ?? {});
      if (!parseQuery.success) {
        reply.status(400);
        await authResult.auth.log('failed', {
          action: 'catalog.saved-searches.list',
          reason: 'invalid_query',
          details: parseQuery.error.flatten()
        });
        return { error: parseQuery.error.flatten() };
      }

      const owner = resolveOwner(authResult.auth);
      const searches = await listSavedSearches(owner, { category: parseQuery.data.category });
      reply.status(200);
      return {
        data: searches.map(serializeSavedSearch)
      };
    }
  );

  app.post(
    '/saved-searches',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'Create a saved catalog search',
        description: 'Persists a reusable catalog search definition for the authenticated operator.',
        security: [{ OperatorToken: [] }],
        body: schemaRef('SavedCatalogSearchCreateRequest'),
        response: {
          201: jsonResponse('SavedCatalogSearchResponse', 'Saved search created successfully.'),
          400: errorResponse('The saved search payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to create saved searches.'),
          500: errorResponse('An unexpected error occurred while creating the saved search.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.create',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parse = savedSearchCreateSchema.safeParse(request.body ?? {});
      if (!parse.success) {
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_payload',
          details: parse.error.flatten()
        });
        return { error: parse.error.flatten() };
      }

      try {
        const owner = resolveOwner(authResult.auth);
        const record = await createSavedSearch(owner, toCreateInput(parse.data));
        reply.status(201);
        await authResult.auth.log('succeeded', {
          action: 'catalog.saved-searches.create',
          slug: record.slug,
          category: record.category
        });
        return { data: serializeSavedSearch(record) };
      } catch (err) {
        request.log.error({ err }, 'Failed to create saved search');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'exception',
          message: err instanceof Error ? err.message : 'unknown_error'
        });
        return { error: 'failed_to_create_saved_search' };
      }
    }
  );

  app.get(
    '/saved-searches/:slug',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'Get a saved catalog search',
        description: 'Retrieves a saved search owned by the authenticated operator.',
        security: [{ OperatorToken: [] }],
        params: savedSearchSlugParamsOpenApiSchema,
        response: {
          200: jsonResponse('SavedCatalogSearchResponse', 'Saved search details.'),
          400: errorResponse('The saved search slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to inspect the saved search.'),
          404: errorResponse('No saved search matches the supplied slug.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.get',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await getSavedSearchBySlug(owner, parseParams.data.slug);
    if (!record) {
      reply.status(404);
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    return { data: serializeSavedSearch(record) };
  }
  );

  app.patch(
    '/saved-searches/:slug',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'Update a saved catalog search',
        description: 'Updates attributes of an existing saved search owned by the caller.',
        security: [{ OperatorToken: [] }],
        params: savedSearchSlugParamsOpenApiSchema,
        body: schemaRef('SavedCatalogSearchUpdateRequest'),
        response: {
          200: jsonResponse('SavedCatalogSearchResponse', 'Saved search updated.'),
          400: errorResponse('The update payload was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to modify the saved search.'),
          404: errorResponse('The saved search does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.update',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseBody = savedSearchUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        action: 'catalog.saved-searches.update',
        reason: 'invalid_payload',
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await updateSavedSearch(owner, parseParams.data.slug, toUpdateInput(parseBody.data));
    if (!record) {
      reply.status(404);
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      action: 'catalog.saved-searches.update',
      slug: record.slug,
      category: record.category
    });
    return { data: serializeSavedSearch(record) };
  }
  );

  app.delete(
    '/saved-searches/:slug',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'Delete a saved catalog search',
        description: 'Removes a saved search owned by the authenticated operator.',
        security: [{ OperatorToken: [] }],
        params: savedSearchSlugParamsOpenApiSchema,
        response: {
          204: { description: 'Saved search deleted.' },
          400: errorResponse('The saved search slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to delete the saved search.'),
          404: errorResponse('The saved search does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.delete',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const deleted = await deleteSavedSearch(owner, parseParams.data.slug);
    if (!deleted) {
      reply.status(404);
      return { error: 'saved_search_not_found' };
    }

    reply.status(204);
    await authResult.auth.log('succeeded', {
      action: 'catalog.saved-searches.delete',
      slug: parseParams.data.slug
    });
    return null;
  }
  );

  app.post(
    '/saved-searches/:slug/apply',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'Record saved search application',
        description: 'Increments usage metrics after applying a saved search.',
        security: [{ OperatorToken: [] }],
        params: savedSearchSlugParamsOpenApiSchema,
        response: {
          200: jsonResponse('SavedCatalogSearchResponse', 'Updated saved search metrics.'),
          400: errorResponse('The saved search slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to update the saved search.'),
          404: errorResponse('The saved search does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.apply',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await recordSavedSearchApplied(owner, parseParams.data.slug);
    if (!record) {
      reply.status(404);
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    return { data: serializeSavedSearch(record) };
  }
  );

  app.post(
    '/saved-searches/:slug/share',
    {
      schema: {
        tags: ['Saved Searches'],
        summary: 'Record saved search share action',
        description: 'Increments share metrics for a saved search.',
        security: [{ OperatorToken: [] }],
        params: savedSearchSlugParamsOpenApiSchema,
        response: {
          200: jsonResponse('SavedCatalogSearchResponse', 'Updated saved search metadata.'),
          400: errorResponse('The saved search slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to update the saved search.'),
          404: errorResponse('The saved search does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'catalog.saved-searches.share',
        resource: 'catalog/saved-searches',
        requiredScopes: []
      });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = savedSearchSlugParamsSchema.safeParse(request.params ?? {});
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const owner = resolveOwner(authResult.auth);
    const record = await recordSavedSearchShared(owner, parseParams.data.slug);
    if (!record) {
      reply.status(404);
      return { error: 'saved_search_not_found' };
    }

    reply.status(200);
    return { data: serializeSavedSearch(record) };
  }
  );
}
