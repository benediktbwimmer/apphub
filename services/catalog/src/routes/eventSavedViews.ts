import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  listEventSavedViews,
  createEventSavedView,
  updateEventSavedView,
  deleteEventSavedView,
  getEventSavedViewBySlug,
  recordEventSavedViewApplied,
  recordEventSavedViewShared,
  getEventSavedViewAnalytics,
  type EventSavedViewRecord,
  type EventSavedViewOwner
} from '../db/eventSavedViews';
import { requireOperatorScopes, type OperatorAuthSuccess } from './shared/operatorAuth';
import { schemaRef } from '../openapi/definitions';

const SEVERITY_VALUES = ['critical', 'error', 'warning', 'info', 'debug'] as const;

const filterSchema = z
  .object({
    type: z.string().trim().max(200).optional(),
    source: z.string().trim().max(200).optional(),
    correlationId: z.string().trim().max(200).optional(),
    from: z.string().trim().max(200).optional(),
    to: z.string().trim().max(200).optional(),
    jsonPath: z.string().trim().max(500).optional(),
    severity: z.array(z.enum(SEVERITY_VALUES)).max(5).optional(),
    limit: z.number().int().min(1).max(200).optional()
  })
  .partial()
  .optional();

const createSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    filters: filterSchema,
    visibility: z.enum(['private', 'shared']).optional()
  })
  .strict();

const updateSchema = createSchema.partial().strict();

const slugParamsSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(120)
  })
  .strict();

const slugParamsOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug'],
  properties: {
    slug: {
      type: 'string',
      description: 'Saved view slug assigned when the record was created.'
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
const eventSavedViewResponse = jsonResponse.bind(null, 'EventSavedViewResponse');
const eventSavedViewListResponse = jsonResponse.bind(null, 'EventSavedViewListResponse');

function resolveOwner(auth: OperatorAuthSuccess): EventSavedViewOwner {
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
  } satisfies EventSavedViewOwner;
}

function serializeEventSavedView(record: EventSavedViewRecord) {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    description: record.description,
    filters: record.filters,
    visibility: record.visibility,
    appliedCount: record.appliedCount,
    sharedCount: record.sharedCount,
    lastAppliedAt: record.lastAppliedAt,
    lastSharedAt: record.lastSharedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    owner: {
      key: record.ownerKey,
      subject: record.ownerSubject,
      kind: record.ownerKind,
      userId: record.ownerUserId
    },
    analytics: record.analytics
  };
}

async function attachAnalyticsSafely(request: FastifyRequest, record: EventSavedViewRecord) {
  try {
    const analytics = await getEventSavedViewAnalytics(record.filters ?? {});
    return { ...record, analytics } satisfies EventSavedViewRecord;
  } catch (err) {
    request.log.error({ err, slug: record.slug }, 'Failed to compute event saved view analytics');
    return { ...record, analytics: null } satisfies EventSavedViewRecord;
  }
}

export async function registerEventSavedViewRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/events/saved-views',
    {
      schema: {
        tags: ['Events'],
        summary: 'List saved event views',
        description: 'Returns saved event views available to the authenticated operator, including shared presets.',
        security: [{ OperatorToken: [] }],
        response: {
          200: eventSavedViewListResponse('Saved event views available to the caller.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to view saved event overlays.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.list',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const owner = resolveOwner(authResult.auth);
      const views = await listEventSavedViews(owner, { includeShared: true });
      const enriched = await Promise.all(views.map((view) => attachAnalyticsSafely(request, view)));
      reply.status(200);
      return { data: enriched.map(serializeEventSavedView) };
    }
  );

  app.post(
    '/events/saved-views',
    {
      schema: {
        tags: ['Events'],
        summary: 'Create a saved event view',
        description: 'Persists a reusable filter preset for the events explorer.',
        security: [{ OperatorToken: [] }],
        body: schemaRef('EventSavedViewCreateRequest'),
        response: {
          201: eventSavedViewResponse('Saved event view created successfully.'),
          400: errorResponse('The saved view payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to create saved event views.'),
          500: errorResponse('An unexpected error occurred while creating the saved event view.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.create',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parse = createSchema.safeParse(request.body ?? {});
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
        const record = await createEventSavedView(owner, {
          ...parse.data,
          filters: parse.data.filters ?? {}
        });
        const enriched = await attachAnalyticsSafely(request, record);
        reply.status(201);
        await authResult.auth.log('succeeded', {
          action: 'events.saved-views.create',
          slug: record.slug
        });
        return { data: serializeEventSavedView(enriched) };
      } catch (err) {
        request.log.error({ err }, 'Failed to create event saved view');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'exception',
          message: err instanceof Error ? err.message : 'unknown_error'
        });
        return { error: 'failed_to_create_event_saved_view' };
      }
    }
  );

  app.get(
    '/events/saved-views/:slug',
    {
      schema: {
        tags: ['Events'],
        summary: 'Get a saved event view',
        description: 'Retrieves a saved event view, including analytics, owned or shared to the caller.',
        security: [{ OperatorToken: [] }],
        params: slugParamsOpenApiSchema,
        response: {
          200: eventSavedViewResponse('Saved event view details.'),
          400: errorResponse('The saved view slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to inspect the saved view.'),
          404: errorResponse('No saved event view matches the supplied slug.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.get',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parseParams = slugParamsSchema.safeParse(request.params ?? {});
      if (!parseParams.success) {
        reply.status(400);
        return { error: parseParams.error.flatten() };
      }

      const owner = resolveOwner(authResult.auth);
      const record = await getEventSavedViewBySlug(owner, parseParams.data.slug, { includeShared: true });
      if (!record) {
        reply.status(404);
        return { error: 'event_saved_view_not_found' };
      }
      const enriched = await attachAnalyticsSafely(request, record);
      reply.status(200);
      return { data: serializeEventSavedView(enriched) };
    }
  );

  app.patch(
    '/events/saved-views/:slug',
    {
      schema: {
        tags: ['Events'],
        summary: 'Update a saved event view',
        description: 'Updates a saved event view owned by the caller.',
        security: [{ OperatorToken: [] }],
        params: slugParamsOpenApiSchema,
        body: schemaRef('EventSavedViewUpdateRequest'),
        response: {
          200: eventSavedViewResponse('Saved event view updated.'),
          400: errorResponse('The saved view update payload was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to modify the saved view.'),
          404: errorResponse('The saved event view does not exist.'),
          500: errorResponse('An unexpected error occurred while updating the saved event view.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.update',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parseParams = slugParamsSchema.safeParse(request.params ?? {});
      if (!parseParams.success) {
        reply.status(400);
        return { error: parseParams.error.flatten() };
      }

      const parseBody = updateSchema.safeParse(request.body ?? {});
      if (!parseBody.success) {
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_payload',
          details: parseBody.error.flatten()
        });
        return { error: parseBody.error.flatten() };
      }

      try {
        const owner = resolveOwner(authResult.auth);
        const record = await updateEventSavedView(owner, parseParams.data.slug, {
          ...parseBody.data,
          filters: parseBody.data.filters ?? undefined
        });
        if (!record) {
          reply.status(404);
          return { error: 'event_saved_view_not_found' };
        }
        const enriched = await attachAnalyticsSafely(request, record);
        reply.status(200);
        await authResult.auth.log('succeeded', {
          action: 'events.saved-views.update',
          slug: record.slug
        });
        return { data: serializeEventSavedView(enriched) };
      } catch (err) {
        request.log.error({ err }, 'Failed to update event saved view');
        reply.status(500);
        await authResult.auth.log('failed', {
          reason: 'exception',
          message: err instanceof Error ? err.message : 'unknown_error'
        });
        return { error: 'failed_to_update_event_saved_view' };
      }
    }
  );

  app.delete(
    '/events/saved-views/:slug',
    {
      schema: {
        tags: ['Events'],
        summary: 'Delete a saved event view',
        description: 'Removes a saved event view owned by the authenticated operator.',
        security: [{ OperatorToken: [] }],
        params: slugParamsOpenApiSchema,
        response: {
          204: { description: 'Saved event view deleted.' },
          400: errorResponse('The saved view slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to delete the saved view.'),
          404: errorResponse('The saved event view does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.delete',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parseParams = slugParamsSchema.safeParse(request.params ?? {});
      if (!parseParams.success) {
        reply.status(400);
        return { error: parseParams.error.flatten() };
      }

      const owner = resolveOwner(authResult.auth);
      const deleted = await deleteEventSavedView(owner, parseParams.data.slug);
      if (!deleted) {
        reply.status(404);
        return { error: 'event_saved_view_not_found' };
      }

      reply.status(204);
      await authResult.auth.log('succeeded', {
        action: 'events.saved-views.delete',
        slug: parseParams.data.slug
      });
      return null;
    }
  );

  app.post(
    '/events/saved-views/:slug/apply',
    {
      schema: {
        tags: ['Events'],
        summary: 'Record saved event view usage',
        description: 'Increments usage metrics after applying a saved event view.',
        security: [{ OperatorToken: [] }],
        params: slugParamsOpenApiSchema,
        response: {
          200: eventSavedViewResponse('Updated saved event view metrics.'),
          400: errorResponse('The saved view slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to update the saved view.'),
          404: errorResponse('The saved event view does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.apply',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parseParams = slugParamsSchema.safeParse(request.params ?? {});
      if (!parseParams.success) {
        reply.status(400);
        return { error: parseParams.error.flatten() };
      }

      const record = await recordEventSavedViewApplied(parseParams.data.slug);
      if (!record) {
        reply.status(404);
        return { error: 'event_saved_view_not_found' };
      }

      const enriched = await attachAnalyticsSafely(request, record);
      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'events.saved-views.apply',
        slug: enriched.slug
      });
      return { data: serializeEventSavedView(enriched) };
    }
  );

  app.post(
    '/events/saved-views/:slug/share',
    {
      schema: {
        tags: ['Events'],
        summary: 'Record saved event view share action',
        description: 'Increments share metrics for a saved event view.',
        security: [{ OperatorToken: [] }],
        params: slugParamsOpenApiSchema,
        response: {
          200: eventSavedViewResponse('Updated saved event view metadata.'),
          400: errorResponse('The saved view slug was invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to update the saved view.'),
          404: errorResponse('The saved event view does not exist.')
        }
      }
    },
    async (request, reply) => {
      const authResult = await requireOperatorScopes(request, reply, {
        action: 'events.saved-views.share',
        resource: 'events/saved-views',
        requiredScopes: []
      });
      if (!authResult.ok) {
        return { error: authResult.error };
      }

      const parseParams = slugParamsSchema.safeParse(request.params ?? {});
      if (!parseParams.success) {
        reply.status(400);
        return { error: parseParams.error.flatten() };
      }

      const owner = resolveOwner(authResult.auth);
      const record = await recordEventSavedViewShared(owner, parseParams.data.slug);
      if (!record) {
        reply.status(404);
        return { error: 'event_saved_view_not_found' };
      }

      const enriched = await attachAnalyticsSafely(request, record);
      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'events.saved-views.share',
        slug: enriched.slug
      });
      return { data: serializeEventSavedView(enriched) };
    }
  );
}
