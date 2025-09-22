import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createWorkflowDefinition,
  createWorkflowRun,
  getWorkflowDefinitionBySlug,
  getWorkflowRunById,
  listWorkflowDefinitions,
  listWorkflowRunSteps,
  listWorkflowRunsForDefinition,
  updateWorkflowDefinition,
  updateWorkflowRun
} from '../db/index';
import type {
  WorkflowFanOutTemplateDefinition,
  WorkflowStepDefinition
} from '../db/types';
import {
  applyDagMetadataToSteps,
  buildWorkflowDagMetadata,
  WorkflowDagValidationError
} from '../workflows/dag';
import {
  workflowDefinitionCreateSchema,
  workflowDefinitionUpdateSchema,
  workflowTriggerSchema,
  jsonValueSchema,
  type WorkflowFanOutTemplateInput,
  type WorkflowStepInput,
  type WorkflowTriggerInput
} from '../workflows/zodSchemas';
import {
  enqueueWorkflowRun
} from '../queue';
import {
  serializeWorkflowDefinition,
  serializeWorkflowRun,
  serializeWorkflowRunStep
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { WORKFLOW_RUN_SCOPES, WORKFLOW_WRITE_SCOPES } from './shared/scopes';
import type { JsonValue } from './shared/serializers';

function normalizeWorkflowDependsOn(dependsOn?: string[]) {
  if (!dependsOn) {
    return undefined;
  }
  const unique = Array.from(new Set(dependsOn.map((id) => id.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

function normalizeWorkflowFanOutTemplate(template: WorkflowFanOutTemplateInput) {
  const base = {
    id: template.id,
    name: template.name,
    description: template.description ?? null,
    dependsOn: normalizeWorkflowDependsOn(template.dependsOn)
  };

  if (template.type === 'service') {
    return {
      ...base,
      type: 'service' as const,
      serviceSlug: template.serviceSlug.trim().toLowerCase(),
      parameters: template.parameters ?? undefined,
      timeoutMs: template.timeoutMs ?? null,
      retryPolicy: template.retryPolicy ?? null,
      requireHealthy: template.requireHealthy ?? undefined,
      allowDegraded: template.allowDegraded ?? undefined,
      captureResponse: template.captureResponse ?? undefined,
      storeResponseAs: template.storeResponseAs ?? undefined,
      request: template.request
    } satisfies WorkflowFanOutTemplateDefinition;
  }

  return {
    ...base,
    type: 'job' as const,
    jobSlug: template.jobSlug,
    parameters: template.parameters ?? undefined,
    timeoutMs: template.timeoutMs ?? null,
    retryPolicy: template.retryPolicy ?? null,
    storeResultAs: template.storeResultAs ?? undefined
  } satisfies WorkflowFanOutTemplateDefinition;
}

function normalizeWorkflowSteps(steps: WorkflowStepInput[]) {
  return steps.map((step) => {
    const base = {
      id: step.id,
      name: step.name,
      description: step.description ?? null,
      dependsOn: normalizeWorkflowDependsOn(step.dependsOn)
    };

    if (step.type === 'fanout') {
      return {
        ...base,
        type: 'fanout' as const,
        collection: step.collection,
        template: normalizeWorkflowFanOutTemplate(step.template),
        maxItems: step.maxItems ?? null,
        maxConcurrency: step.maxConcurrency ?? null,
        storeResultsAs: step.storeResultsAs ?? undefined
      };
    }

    if (step.type === 'service') {
      return {
        ...base,
        type: 'service' as const,
        serviceSlug: step.serviceSlug.trim().toLowerCase(),
        parameters: step.parameters ?? undefined,
        timeoutMs: step.timeoutMs ?? null,
        retryPolicy: step.retryPolicy ?? null,
        requireHealthy: step.requireHealthy ?? undefined,
        allowDegraded: step.allowDegraded ?? undefined,
        captureResponse: step.captureResponse ?? undefined,
        storeResponseAs: step.storeResponseAs ?? undefined,
        request: step.request
      };
    }

    return {
      ...base,
      type: 'job' as const,
      jobSlug: step.jobSlug,
      parameters: step.parameters ?? undefined,
      timeoutMs: step.timeoutMs ?? null,
      retryPolicy: step.retryPolicy ?? null,
      storeResultAs: step.storeResultAs ?? undefined
    };
  });
}

function normalizeWorkflowTriggers(triggers?: WorkflowTriggerInput[]) {
  if (!triggers) {
    return undefined;
  }
  return triggers.map((trigger) => ({
    type: trigger.type,
    options: trigger.options ?? null
  }));
}

const workflowRunRequestSchema = z
  .object({
    parameters: jsonValueSchema.optional(),
    triggeredBy: z.string().min(1).max(200).optional(),
    trigger: workflowTriggerSchema.optional()
  })
  .strict();

const workflowRunListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50).optional()),
    offset: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0).optional())
  })
  .partial();

const workflowSlugParamSchema = z
  .object({
    slug: z.string().min(1)
  })
  .strict();

const workflowRunIdParamSchema = z
  .object({
    runId: z.string().min(1)
  })
  .strict();

export async function registerWorkflowRoutes(app: FastifyInstance): Promise<void> {
  app.get('/workflows', async (_request, reply) => {
    try {
      const workflows = await listWorkflowDefinitions();
      reply.status(200);
      return { data: workflows.map((workflow) => serializeWorkflowDefinition(workflow)) };
    } catch (err) {
      reply.status(500);
      return { error: 'Failed to list workflows' };
    }
  });

  app.post('/workflows', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.create',
      resource: 'workflows',
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = workflowDefinitionCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const normalizedSteps = normalizeWorkflowSteps(payload.steps);
    const triggers = normalizeWorkflowTriggers(payload.triggers);

    let dagMetadata: ReturnType<typeof buildWorkflowDagMetadata>;
    let stepsWithDag: WorkflowStepDefinition[];
    try {
      dagMetadata = buildWorkflowDagMetadata(normalizedSteps);
      stepsWithDag = applyDagMetadataToSteps(normalizedSteps, dagMetadata) as WorkflowStepDefinition[];
    } catch (err) {
      if (err instanceof WorkflowDagValidationError) {
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_dag',
          message: err.message,
          detail: err.detail
        });
        return {
          error: {
            message: err.message,
            reason: err.reason,
            detail: err.detail
          }
        };
      }
      throw err;
    }

    try {
      const workflow = await createWorkflowDefinition({
        slug: payload.slug,
        name: payload.name,
        version: payload.version,
        description: payload.description ?? null,
        steps: stepsWithDag,
        triggers,
        parametersSchema: payload.parametersSchema ?? {},
        defaultParameters: payload.defaultParameters ?? {},
        metadata: payload.metadata ?? null,
        dag: dagMetadata
      });
      reply.status(201);
      await authResult.auth.log('succeeded', { workflowSlug: workflow.slug, workflowId: workflow.id });
      return { data: serializeWorkflowDefinition(workflow) };
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        reply.status(409);
        await authResult.auth.log('failed', { reason: 'duplicate_workflow', message: err.message });
        return { error: err.message };
      }
      request.log.error({ err }, 'Failed to create workflow definition');
      reply.status(500);
      const message = err instanceof Error ? err.message : 'Failed to create workflow definition';
      await authResult.auth.log('failed', { reason: 'exception', message });
      return { error: 'Failed to create workflow definition' };
    }
  });

  app.patch('/workflows/:slug', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.update',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowDefinitionUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const updates: Parameters<typeof updateWorkflowDefinition>[1] = {};

    if (payload.name !== undefined) {
      updates.name = payload.name;
    }
    if (payload.version !== undefined) {
      updates.version = payload.version;
    }
    if (payload.description !== undefined) {
      updates.description = payload.description ?? null;
    }
    if (payload.parametersSchema !== undefined) {
      updates.parametersSchema = payload.parametersSchema ?? {};
    }
    if (payload.defaultParameters !== undefined) {
      updates.defaultParameters = payload.defaultParameters ?? {};
    }
    if (payload.metadata !== undefined) {
      updates.metadata = payload.metadata ?? null;
    }

    if (payload.steps !== undefined) {
      const normalizedSteps = normalizeWorkflowSteps(payload.steps);
      try {
        const dagMetadata = buildWorkflowDagMetadata(normalizedSteps);
        const stepsWithDag = applyDagMetadataToSteps(normalizedSteps, dagMetadata) as WorkflowStepDefinition[];
        updates.steps = stepsWithDag;
        updates.dag = dagMetadata;
      } catch (err) {
        if (err instanceof WorkflowDagValidationError) {
          reply.status(400);
          await authResult.auth.log('failed', {
            reason: 'invalid_dag',
            message: err.message,
            detail: err.detail
          });
          return {
            error: {
              message: err.message,
              reason: err.reason,
              detail: err.detail
            }
          };
        }
        throw err;
      }
    }

    if (payload.triggers !== undefined) {
      updates.triggers = normalizeWorkflowTriggers(payload.triggers);
    }

    try {
      const updated = await updateWorkflowDefinition(parseParams.data.slug, updates);
      if (!updated) {
        reply.status(404);
        await authResult.auth.log('failed', {
          reason: 'workflow_not_found',
          workflowSlug: parseParams.data.slug
        });
        return { error: 'workflow not found' };
      }
      reply.status(200);
      await authResult.auth.log('succeeded', { workflowSlug: updated.slug, workflowId: updated.id });
      return { data: serializeWorkflowDefinition(updated) };
    } catch (err) {
      request.log.error({ err, slug: parseParams.data.slug }, 'Failed to update workflow definition');
      reply.status(500);
      const message = err instanceof Error ? err.message : 'Failed to update workflow definition';
      await authResult.auth.log('failed', {
        reason: 'exception',
        message,
        workflowSlug: parseParams.data.slug
      });
      return { error: 'Failed to update workflow definition' };
    }
  });

  app.get('/workflows/:slug', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 10, 50));
    const offset = Math.max(0, parseQuery.data.offset ?? 0);
    const runs = await listWorkflowRunsForDefinition(workflow.id, { limit, offset });

    reply.status(200);
    return {
      data: {
        workflow: serializeWorkflowDefinition(workflow),
        runs: runs.map((run) => serializeWorkflowRun(run))
      },
      meta: {
        limit,
        offset
      }
    };
  });

  app.get('/workflows/:slug/runs', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      return { error: 'workflow not found' };
    }

    const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 20, 50));
    const offset = Math.max(0, parseQuery.data.offset ?? 0);
    const runs = await listWorkflowRunsForDefinition(workflow.id, { limit, offset });

    reply.status(200);
    return {
      data: {
        runs: runs.map((run) => serializeWorkflowRun(run))
      },
      meta: {
        workflow: {
          id: workflow.id,
          slug: workflow.slug,
          name: workflow.name
        },
        limit,
        offset
      }
    };
  });

  app.post('/workflows/:slug/run', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'workflows.run',
      resource: `workflow:${candidateSlug}`,
      requiredScopes: WORKFLOW_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = workflowRunRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        workflowSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    const workflow = await getWorkflowDefinitionBySlug(parseParams.data.slug);
    if (!workflow) {
      reply.status(404);
      await authResult.auth.log('failed', { reason: 'workflow_not_found', workflowSlug: parseParams.data.slug });
      return { error: 'workflow not found' };
    }

    const parameters = parseBody.data.parameters ?? workflow.defaultParameters ?? {};
    const triggeredBy = parseBody.data.triggeredBy ?? null;
    const trigger = parseBody.data.trigger ?? undefined;

    const run = await createWorkflowRun(workflow.id, {
      parameters,
      triggeredBy,
      trigger
    });

    try {
      await enqueueWorkflowRun(run.id);
    } catch (err) {
      request.log.error({ err, workflow: workflow.slug }, 'Failed to enqueue workflow run');
      const message = (err as Error).message ?? 'Failed to enqueue workflow run';
      await updateWorkflowRun(run.id, {
        status: 'failed',
        errorMessage: message,
        completedAt: new Date().toISOString(),
        durationMs: 0
      });
      reply.status(502);
      await authResult.auth.log('failed', {
        reason: 'enqueue_failed',
        workflowSlug: workflow.slug,
        runId: run.id,
        message
      });
      return { error: message };
    }

    const latestRun = (await getWorkflowRunById(run.id)) ?? run;
    reply.status(202);
    await authResult.auth.log('succeeded', {
      workflowSlug: workflow.slug,
      runId: latestRun.id,
      status: latestRun.status
    });
    return { data: serializeWorkflowRun(latestRun) };
  });

  app.get('/workflow-runs/:runId', async (request, reply) => {
    const parseParams = workflowRunIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const run = await getWorkflowRunById(parseParams.data.runId);
    if (!run) {
      reply.status(404);
      return { error: 'workflow run not found' };
    }

    reply.status(200);
    return { data: serializeWorkflowRun(run) };
  });

  app.get('/workflow-runs/:runId/steps', async (request, reply) => {
    const parseParams = workflowRunIdParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const run = await getWorkflowRunById(parseParams.data.runId);
    if (!run) {
      reply.status(404);
      return { error: 'workflow run not found' };
    }

    const steps = await listWorkflowRunSteps(run.id);

    reply.status(200);
    return {
      data: {
        run: serializeWorkflowRun(run),
        steps: steps.map((step) => serializeWorkflowRunStep(step))
      }
    };
  });
}
