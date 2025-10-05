import type { FastifyInstance } from 'fastify';
import { z, ZodError } from 'zod';
import {
  createWorkflowEventTrigger,
  deleteWorkflowEventTrigger,
  getWorkflowDefinitionBySlug,
  getWorkflowEventTriggerById,
  listWorkflowEventTriggers,
  listWorkflowTriggerDeliveries,
  updateWorkflowEventTrigger
} from '../../db';
import type {
  WorkflowEventTriggerCreateInput,
  WorkflowEventTriggerUpdateInput
} from '../../db/types';
import {
  serializeWorkflowEventTrigger,
  serializeWorkflowTriggerDelivery,
  type JsonValue
} from '../shared/serializers';
import { requireOperatorScopes } from '../shared/operatorAuth';
import { WORKFLOW_READ_SCOPES, WORKFLOW_RUN_SCOPES, WORKFLOW_WRITE_SCOPES } from '../shared/scopes';
import {
  normalizeWorkflowEventTriggerCreate,
  normalizeWorkflowEventTriggerUpdate,
  normalizeTriggerSampleEvent,
  type NormalizedTriggerSampleEvent
} from '../../workflows/eventTriggerValidation';
import { assertNoTemplateIssues, validateTriggerTemplates } from '../../workflows/liquidTemplateValidation';

const workflowSlugParamSchema = z
  .object({
    slug: z.string().min(1)
  })
  .strict();

const triggerIdParamSchema = workflowSlugParamSchema.extend({
  triggerId: z.string().min(1)
});

const triggerListQuerySchema = z
  .object({
    status: z.enum(['active', 'disabled']).optional(),
    eventType: z.string().min(1).max(200).optional(),
    eventSource: z.string().min(1).max(200).optional()
  })
  .partial();

const deliveryStatusSchema = z.enum(['pending', 'matched', 'throttled', 'skipped', 'launched', 'failed']);

const deliveryListQuerySchema = z
  .object({
    limit: z
      .preprocess((value) => (value === undefined ? undefined : Number(value)), z.number().int().min(1).max(200).optional()),
    status: deliveryStatusSchema.optional(),
    eventId: z.string().min(1).max(200).optional(),
    dedupeKey: z.string().min(1).max(200).optional()
  })
  .partial();

function formatZodError(error: ZodError): JsonValue {
  const flattened = error.flatten();
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(flattened.fieldErrors)) {
    if (Array.isArray(values) && values.length > 0) {
      fieldErrors[key] = values;
    }
  }
  return {
    formErrors: flattened.formErrors,
    fieldErrors
  } satisfies JsonValue;
}


export async function registerWorkflowTriggerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workflows/:slug/triggers', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-triggers.list',
      resource: 'workflows',
      requiredScopes: [],
      anyOfScopes: [WORKFLOW_READ_SCOPES, WORKFLOW_WRITE_SCOPES, WORKFLOW_RUN_SCOPES]
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = triggerListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_query',
        details: parseQuery.error.flatten()
      });
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const filters = parseQuery.data;
    const triggers = await listWorkflowEventTriggers({
      workflowDefinitionId: workflow.id,
      status: filters.status,
      eventType: filters.eventType,
      eventSource: filters.eventSource
    });

    reply.status(200);
    await authResult.auth.log('succeeded', {
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      count: triggers.length
    });
    return {
      data: {
        workflow: {
          id: workflow.id,
          slug: workflow.slug,
          name: workflow.name
        },
        triggers: triggers.map((trigger) => serializeWorkflowEventTrigger(trigger))
      }
    };
  });

  app.get('/workflows/:slug/triggers/:triggerId', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-triggers.get',
      resource: 'workflows',
      requiredScopes: [],
      anyOfScopes: [WORKFLOW_READ_SCOPES, WORKFLOW_WRITE_SCOPES, WORKFLOW_RUN_SCOPES]
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = triggerIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const trigger = await getWorkflowEventTriggerById(parseParams.data.triggerId);
    if (!trigger || trigger.workflowDefinitionId !== workflow.id) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'trigger_not_found',
        workflowId: workflow.id,
        triggerId: parseParams.data.triggerId
      });
      return { error: 'trigger not found' };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      triggerId: trigger.id
    });
    return {
      data: serializeWorkflowEventTrigger(trigger)
    };
  });

  app.post('/workflows/:slug/triggers', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-triggers.create',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const rawPayload = (request.body ?? {}) as Record<string, unknown>;
    const { sampleEvent: rawSampleEvent, ...rawTriggerInput } = rawPayload;

    let normalized: ReturnType<typeof normalizeWorkflowEventTriggerCreate>;
    let sampleEvent: NormalizedTriggerSampleEvent | null = null;
    try {
      normalized = normalizeWorkflowEventTriggerCreate(
        rawTriggerInput as WorkflowEventTriggerCreateInput
      );
      sampleEvent = normalizeTriggerSampleEvent(rawSampleEvent);
      const templateIssues = await validateTriggerTemplates(
        {
          parameterTemplate: normalized.parameterTemplate,
          idempotencyKeyExpression: normalized.idempotencyKeyExpression,
          runKeyTemplate: normalized.runKeyTemplate
        },
        {
          trigger: {
            workflowDefinitionId: workflow.id,
            name: normalized.name,
            description: normalized.description,
            eventType: normalized.eventType,
            eventSource: normalized.eventSource ?? null,
            predicates: normalized.predicates,
            parameterTemplate: normalized.parameterTemplate,
            runKeyTemplate: normalized.runKeyTemplate,
            idempotencyKeyExpression: normalized.idempotencyKeyExpression,
            metadata: normalized.metadata,
            throttleWindowMs: normalized.throttleWindowMs,
            throttleCount: normalized.throttleCount,
            maxConcurrency: normalized.maxConcurrency,
            status: normalized.status
          },
          sampleEvent
        }
      );
      assertNoTemplateIssues(templateIssues);
    } catch (err) {
      if (err instanceof ZodError) {
        const errorPayload = formatZodError(err);
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_payload',
          details: errorPayload
        });
        return { error: errorPayload };
      }
      throw err;
    }

    const actor = normalized.createdBy ?? authResult.auth.identity.subject ?? null;

    const created = await createWorkflowEventTrigger({
      workflowDefinitionId: workflow.id,
      name: normalized.name,
      description: normalized.description,
      eventType: normalized.eventType,
      eventSource: normalized.eventSource,
      predicates: normalized.predicates,
      parameterTemplate: normalized.parameterTemplate,
      runKeyTemplate: normalized.runKeyTemplate,
      throttleWindowMs: normalized.throttleWindowMs,
      throttleCount: normalized.throttleCount,
      maxConcurrency: normalized.maxConcurrency,
      idempotencyKeyExpression: normalized.idempotencyKeyExpression,
      metadata: normalized.metadata,
      status: normalized.status,
      createdBy: actor
    });

    reply.status(201);
    await authResult.auth.log('succeeded', {
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      triggerId: created.id
    });
    return {
      data: serializeWorkflowEventTrigger(created)
    };
  });

  app.patch('/workflows/:slug/triggers/:triggerId', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-triggers.update',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = triggerIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const trigger = await getWorkflowEventTriggerById(parseParams.data.triggerId);
    if (!trigger || trigger.workflowDefinitionId !== workflow.id) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'trigger_not_found',
        workflowId: workflow.id,
        triggerId: parseParams.data.triggerId
      });
      return { error: 'trigger not found' };
    }

    const rawPayload = (request.body ?? {}) as Record<string, unknown>;
    const { sampleEvent: rawSampleEvent, ...rawUpdateInput } = rawPayload;

    let normalized: ReturnType<typeof normalizeWorkflowEventTriggerUpdate>;
    let sampleEvent: NormalizedTriggerSampleEvent | null = null;
    try {
      normalized = normalizeWorkflowEventTriggerUpdate(
        rawUpdateInput as WorkflowEventTriggerUpdateInput
      );
      sampleEvent = normalizeTriggerSampleEvent(rawSampleEvent);

      const nextParameterTemplate =
        normalized.parameterTemplate !== undefined
          ? normalized.parameterTemplate
          : trigger.parameterTemplate;
      const nextIdempotencyExpression =
        normalized.idempotencyKeyExpression !== undefined
          ? normalized.idempotencyKeyExpression
          : trigger.idempotencyKeyExpression;
      const nextRunKeyTemplate =
        normalized.runKeyTemplate !== undefined ? normalized.runKeyTemplate : trigger.runKeyTemplate;

      const templateIssues = await validateTriggerTemplates(
        {
          parameterTemplate: nextParameterTemplate ?? null,
          idempotencyKeyExpression: nextIdempotencyExpression ?? null,
          runKeyTemplate: nextRunKeyTemplate ?? null
        },
        {
          trigger: {
            ...trigger,
            ...normalized,
            predicates: normalized.predicates ?? trigger.predicates,
            parameterTemplate: nextParameterTemplate ?? null,
            runKeyTemplate: nextRunKeyTemplate ?? null,
            idempotencyKeyExpression: nextIdempotencyExpression ?? null,
            throttleWindowMs: normalized.throttleWindowMs ?? trigger.throttleWindowMs,
            throttleCount: normalized.throttleCount ?? trigger.throttleCount,
            maxConcurrency: normalized.maxConcurrency ?? trigger.maxConcurrency,
            status: normalized.status ?? trigger.status,
            metadata: normalized.metadata ?? trigger.metadata
          },
          sampleEvent
        }
      );
      assertNoTemplateIssues(templateIssues);
    } catch (err) {
      if (err instanceof ZodError) {
        const errorPayload = formatZodError(err);
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_payload',
          details: errorPayload
        });
        return { error: errorPayload };
      }
      throw err;
    }

    const actor = normalized.updatedBy ?? authResult.auth.identity.subject ?? null;

    const updated = await updateWorkflowEventTrigger(trigger.id, {
      name: normalized.name,
      description: normalized.description,
      eventType: normalized.eventType,
      eventSource: normalized.eventSource,
      predicates: normalized.predicates,
      parameterTemplate: normalized.parameterTemplate,
      runKeyTemplate: normalized.runKeyTemplate,
      throttleWindowMs: normalized.throttleWindowMs,
      throttleCount: normalized.throttleCount,
      maxConcurrency: normalized.maxConcurrency,
      idempotencyKeyExpression: normalized.idempotencyKeyExpression,
      metadata: normalized.metadata,
      status: normalized.status,
      updatedBy: actor
    });

    if (!updated) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'trigger_not_found',
        workflowId: workflow.id,
        triggerId: trigger.id
      });
      return { error: 'trigger not found' };
    }

    reply.status(200);
    await authResult.auth.log('succeeded', {
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      triggerId: updated.id
    });
    return {
      data: serializeWorkflowEventTrigger(updated)
    };
  });

  app.delete('/workflows/:slug/triggers/:triggerId', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-triggers.delete',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = triggerIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const trigger = await getWorkflowEventTriggerById(parseParams.data.triggerId);
    if (!trigger || trigger.workflowDefinitionId !== workflow.id) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'trigger_not_found',
        workflowId: workflow.id,
        triggerId: parseParams.data.triggerId
      });
      return { error: 'trigger not found' };
    }

    const removed = await deleteWorkflowEventTrigger(trigger.id);
    if (!removed) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'trigger_not_found',
        workflowId: workflow.id,
        triggerId: trigger.id
      });
      return { error: 'trigger not found' };
    }

    reply.status(204);
    await authResult.auth.log('succeeded', {
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      triggerId: trigger.id
    });
    return null;
  });

  app.get('/workflows/:slug/triggers/:triggerId/deliveries', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflow-triggers.deliveries',
      resource: 'workflows',
      requiredScopes: [],
      anyOfScopes: [WORKFLOW_READ_SCOPES, WORKFLOW_WRITE_SCOPES, WORKFLOW_RUN_SCOPES]
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = triggerIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten()
      });
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = deliveryListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_query',
        details: parseQuery.error.flatten()
      });
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'workflow_not_found',
        workflowSlug: parseParams.data.slug
      });
      return { error: 'workflow not found' };
    }

    const trigger = await getWorkflowEventTriggerById(parseParams.data.triggerId);
    if (!trigger || trigger.workflowDefinitionId !== workflow.id) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'trigger_not_found',
        workflowId: workflow.id,
        triggerId: parseParams.data.triggerId
      });
      return { error: 'trigger not found' };
    }

    const query = parseQuery.data;
    const limit = query.limit ?? 50;
    const deliveries = await listWorkflowTriggerDeliveries({
      triggerId: trigger.id,
      limit,
      status: query.status,
      eventId: query.eventId,
      dedupeKey: query.dedupeKey
    });

    reply.status(200);
    await authResult.auth.log('succeeded', {
      workflowId: workflow.id,
      workflowSlug: workflow.slug,
      triggerId: trigger.id,
      count: deliveries.length,
      limit
    });
    return {
      data: deliveries.map((delivery) => serializeWorkflowTriggerDelivery(delivery)),
      meta: {
        workflow: {
          id: workflow.id,
          slug: workflow.slug,
          name: workflow.name
        },
        trigger: {
          id: trigger.id,
          name: trigger.name,
          eventType: trigger.eventType,
          status: trigger.status
        },
        limit
      }
    };
  });
}
