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
  app.get('/saved-searches', async (request, reply) => {
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
  });

  app.post('/saved-searches', async (request, reply) => {
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
  });

  app.get('/saved-searches/:slug', async (request, reply) => {
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
  });

  app.patch('/saved-searches/:slug', async (request, reply) => {
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
  });

  app.delete('/saved-searches/:slug', async (request, reply) => {
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
  });

  app.post('/saved-searches/:slug/apply', async (request, reply) => {
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
  });

  app.post('/saved-searches/:slug/share', async (request, reply) => {
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
  });
}
