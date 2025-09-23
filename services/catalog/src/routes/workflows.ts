import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createWorkflowDefinition,
  createWorkflowRun,
  getWorkflowDefinitionBySlug,
  getWorkflowRunById,
  getWorkflowRunMetricsBySlug,
  getWorkflowRunStatsBySlug,
  listWorkflowDefinitions,
  listWorkflowRunSteps,
  listWorkflowRunsForDefinition,
  updateWorkflowDefinition,
  updateWorkflowRun,
  getJobDefinitionsBySlugs
} from '../db/index';
import type {
  JobDefinitionRecord,
  WorkflowFanOutTemplateDefinition,
  WorkflowJobStepBundle,
  WorkflowJobStepDefinition,
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
import { parseBundleEntryPoint } from '../jobs/bundleBinding';
import {
  enqueueWorkflowRun
} from '../queue';
import {
  serializeWorkflowDefinition,
  serializeWorkflowRunMetrics,
  serializeWorkflowRun,
  serializeWorkflowRunStats,
  serializeWorkflowRunStep
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { WORKFLOW_RUN_SCOPES, WORKFLOW_WRITE_SCOPES } from './shared/scopes';
import type { JsonValue } from './shared/serializers';

type WorkflowJobStepInput = Extract<WorkflowStepInput, { jobSlug: string }>;
type WorkflowJobTemplateInput = Extract<WorkflowFanOutTemplateInput, { jobSlug: string }>;
type JobDefinitionLookup = Map<string, JobDefinitionRecord>;

function normalizeWorkflowDependsOn(dependsOn?: string[]) {
  if (!dependsOn) {
    return undefined;
  }
  const unique = Array.from(new Set(dependsOn.map((id) => id.trim()).filter(Boolean)));
  return unique.length > 0 ? unique : undefined;
}

function collectWorkflowJobSlugs(steps: WorkflowStepInput[]): string[] {
  const slugs = new Set<string>();
  for (const step of steps) {
    if (step.type === 'service') {
      continue;
    }
    if (step.type === 'fanout') {
      const template = step.template;
      if (template.type !== 'service' && typeof template.jobSlug === 'string') {
        const slug = template.jobSlug.trim().toLowerCase();
        if (slug) {
          slugs.add(slug);
        }
      }
      continue;
    }
    if (typeof step.jobSlug === 'string') {
      const slug = step.jobSlug.trim().toLowerCase();
      if (slug) {
        slugs.add(slug);
      }
    }
  }
  return Array.from(slugs);
}

function lookupJobDefinition(
  jobDefinitions: JobDefinitionLookup,
  slug: string | undefined
): JobDefinitionRecord | undefined {
  if (!slug) {
    return undefined;
  }
  return jobDefinitions.get(slug.trim().toLowerCase());
}

function normalizeJobBundle(
  rawBundle: WorkflowJobStepInput['bundle'] | null | undefined,
  jobDefinition: JobDefinitionRecord | undefined
): WorkflowJobStepBundle | null | undefined {
  if (rawBundle === null) {
    return null;
  }
  const parsed = jobDefinition ? parseBundleEntryPoint(jobDefinition.entryPoint) : null;

  if (rawBundle && rawBundle.strategy === 'latest') {
    const slugFromInput = typeof rawBundle.slug === 'string' ? rawBundle.slug.trim().toLowerCase() : '';
    const slug = slugFromInput || parsed?.slug || '';
    if (!slug) {
      return parsed
        ? {
            strategy: 'latest',
            slug: parsed.slug,
            version: null,
            exportName: parsed.exportName ?? null
          }
        : undefined;
    }
    const exportName = rawBundle.exportName ?? parsed?.exportName ?? null;
    return {
      strategy: 'latest',
      slug,
      version: null,
      exportName
    } satisfies WorkflowJobStepBundle;
  }

  if (rawBundle && typeof rawBundle.version === 'string' && rawBundle.version.trim().length > 0) {
    const slugFromInput = typeof rawBundle.slug === 'string' ? rawBundle.slug.trim().toLowerCase() : '';
    const slug = slugFromInput || parsed?.slug || '';
    if (!slug) {
      return parsed
        ? {
            strategy: 'pinned',
            slug: parsed.slug,
            version: rawBundle.version.trim(),
            exportName: rawBundle.exportName ?? parsed.exportName ?? null
          }
        : undefined;
    }
    const exportName = rawBundle.exportName ?? parsed?.exportName ?? null;
    return {
      strategy: 'pinned',
      slug,
      version: rawBundle.version.trim(),
      exportName
    } satisfies WorkflowJobStepBundle;
  }

  if (parsed) {
    return {
      strategy: 'pinned',
      slug: parsed.slug,
      version: parsed.version,
      exportName: parsed.exportName ?? null
    } satisfies WorkflowJobStepBundle;
  }

  return undefined;
}

function normalizeWorkflowJobStep(
  step: WorkflowJobStepInput,
  jobDefinitions: JobDefinitionLookup
): WorkflowJobStepDefinition {
  const base = {
    id: step.id,
    name: step.name,
    description: step.description ?? null,
    dependsOn: normalizeWorkflowDependsOn(step.dependsOn)
  };

  const jobDefinition = lookupJobDefinition(jobDefinitions, step.jobSlug);
  const bundle = normalizeJobBundle(step.bundle ?? undefined, jobDefinition);

  const normalized: WorkflowJobStepDefinition = {
    ...base,
    type: 'job',
    jobSlug: step.jobSlug,
    parameters: step.parameters ?? undefined,
    timeoutMs: step.timeoutMs ?? null,
    retryPolicy: step.retryPolicy ?? null,
    storeResultAs: step.storeResultAs ?? undefined
  } satisfies WorkflowJobStepDefinition;

  if (bundle !== undefined) {
    normalized.bundle = bundle;
  }

  return normalized;
}

function normalizeWorkflowFanOutTemplate(
  template: WorkflowFanOutTemplateInput,
  jobDefinitions: JobDefinitionLookup
) {
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

  const jobTemplate = template as WorkflowJobTemplateInput;
  const jobDefinition = lookupJobDefinition(jobDefinitions, jobTemplate.jobSlug);
  const bundle = normalizeJobBundle(jobTemplate.bundle ?? undefined, jobDefinition);

  const normalized: WorkflowFanOutTemplateDefinition = {
    ...base,
    type: 'job',
    jobSlug: jobTemplate.jobSlug,
    parameters: jobTemplate.parameters ?? undefined,
    timeoutMs: jobTemplate.timeoutMs ?? null,
    retryPolicy: jobTemplate.retryPolicy ?? null,
    storeResultAs: jobTemplate.storeResultAs ?? undefined
  } satisfies WorkflowFanOutTemplateDefinition;

  if (bundle !== undefined) {
    normalized.bundle = bundle;
  }

  return normalized;
}

async function normalizeWorkflowSteps(
  steps: WorkflowStepInput[]
): Promise<WorkflowStepDefinition[]> {
  const jobSlugs = collectWorkflowJobSlugs(steps);
  const jobDefinitions = await getJobDefinitionsBySlugs(jobSlugs);

  return steps.map((step) => {
    if (step.type === 'fanout') {
      return {
        id: step.id,
        name: step.name,
        description: step.description ?? null,
        dependsOn: normalizeWorkflowDependsOn(step.dependsOn),
        type: 'fanout' as const,
        collection: step.collection,
        template: normalizeWorkflowFanOutTemplate(step.template, jobDefinitions),
        maxItems: step.maxItems ?? null,
        maxConcurrency: step.maxConcurrency ?? null,
        storeResultsAs: step.storeResultsAs ?? undefined
      } satisfies WorkflowStepDefinition;
    }

    if (step.type === 'service') {
      return {
        id: step.id,
        name: step.name,
        description: step.description ?? null,
        dependsOn: normalizeWorkflowDependsOn(step.dependsOn),
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
      } satisfies WorkflowStepDefinition;
    }

    return normalizeWorkflowJobStep(step as WorkflowJobStepInput, jobDefinitions);
  });
}

function normalizeWorkflowSchedule(schedule?: WorkflowTriggerInput['schedule']) {
  if (!schedule) {
    return undefined;
  }

  const normalized = {
    cron: schedule.cron.trim(),
    timezone: schedule.timezone ? schedule.timezone.trim() : null,
    startWindow: schedule.startWindow ?? null,
    endWindow: schedule.endWindow ?? null,
    catchUp: schedule.catchUp ?? false
  };

  return normalized;
}

function normalizeWorkflowTriggers(triggers?: WorkflowTriggerInput[]) {
  if (!triggers) {
    return undefined;
  }
  return triggers.map((trigger) => {
    const schedule = normalizeWorkflowSchedule(trigger.schedule);
    const type = trigger.type.trim();
    const payload: {
      type: string;
      options: JsonValue | null;
      schedule?: typeof schedule;
    } = {
      type,
      options: (trigger.options ?? null) as JsonValue | null
    };

    if (schedule) {
      payload.schedule = schedule;
    }

    return payload;
  });
}

const ANALYTICS_RANGE_OPTIONS = ['24h', '7d', '30d'] as const;
const ANALYTICS_BUCKET_OPTIONS = ['15m', 'hour', 'day'] as const;

type AnalyticsRangeOption = (typeof ANALYTICS_RANGE_OPTIONS)[number];
type AnalyticsBucketOption = (typeof ANALYTICS_BUCKET_OPTIONS)[number];
type AnalyticsRangeKey = AnalyticsRangeOption | 'custom';

const ANALYTICS_RANGE_HOURS: Record<AnalyticsRangeOption, number> = {
  '24h': 24,
  '7d': 24 * 7,
  '30d': 24 * 30
};

const workflowAnalyticsQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
    range: z.enum(ANALYTICS_RANGE_OPTIONS).optional(),
    bucket: z.enum(ANALYTICS_BUCKET_OPTIONS).optional()
  })
  .partial()
  .strict();

type WorkflowAnalyticsQuery = z.infer<typeof workflowAnalyticsQuerySchema>;

type NormalizedAnalyticsQuery = {
  rangeKey: AnalyticsRangeKey;
  bucketKey: AnalyticsBucketOption | null;
  options: { from: Date; to: Date; bucketInterval?: string };
};

const ANALYTICS_ERROR_MESSAGES: Record<string, string> = {
  invalid_from: 'Invalid "from" timestamp',
  invalid_to: 'Invalid "to" timestamp',
  invalid_range: 'The "from" timestamp must be before "to"',
  invalid_bucket: 'Invalid bucket option'
};

function parseIsoDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function mapBucketKeyToInterval(bucketKey: AnalyticsBucketOption | null | undefined):
  | { key: AnalyticsBucketOption; interval: string }
  | null {
  if (!bucketKey) {
    return null;
  }
  switch (bucketKey) {
    case '15m':
      return { key: '15m', interval: '15 minutes' };
    case 'hour':
      return { key: 'hour', interval: '1 hour' };
    case 'day':
      return { key: 'day', interval: '1 day' };
    default:
      return null;
  }
}

function mapIntervalToBucketKey(interval: string | null | undefined): AnalyticsBucketOption | null {
  if (!interval) {
    return null;
  }
  switch (interval) {
    case '15 minutes':
      return '15m';
    case '1 hour':
      return 'hour';
    case '1 day':
      return 'day';
    default:
      return null;
  }
}

function normalizeAnalyticsQuery(
  query: WorkflowAnalyticsQuery
): { ok: true; value: NormalizedAnalyticsQuery } | { ok: false; error: string } {
  const toDate = parseIsoDate(query.to);
  if (query.to && !toDate) {
    return { ok: false, error: 'invalid_to' };
  }
  const fromDate = parseIsoDate(query.from);
  if (query.from && !fromDate) {
    return { ok: false, error: 'invalid_from' };
  }

  let rangeKey: AnalyticsRangeKey = query.range ?? '7d';
  let to = toDate ?? new Date();
  let from = fromDate ?? null;

  if (fromDate || toDate) {
    rangeKey = query.range ?? 'custom';
  }

  const effectiveRange: AnalyticsRangeOption =
    rangeKey === 'custom' ? '7d' : (rangeKey as AnalyticsRangeOption);

  if (!from) {
    const hours = ANALYTICS_RANGE_HOURS[effectiveRange] ?? ANALYTICS_RANGE_HOURS['7d'];
    from = new Date(to.getTime() - hours * 60 * 60 * 1000);
  }

  if (from.getTime() >= to.getTime()) {
    return { ok: false, error: 'invalid_range' };
  }

  const bucketConfig = mapBucketKeyToInterval(query.bucket ?? null);
  if (query.bucket && !bucketConfig) {
    return { ok: false, error: 'invalid_bucket' };
  }

  return {
    ok: true,
    value: {
      rangeKey,
      bucketKey: bucketConfig?.key ?? null,
      options: bucketConfig
        ? { from, to, bucketInterval: bucketConfig.interval }
        : { from, to }
    }
  };
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
    const normalizedSteps = await normalizeWorkflowSteps(payload.steps);
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
      const normalizedSteps = await normalizeWorkflowSteps(payload.steps);
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

  app.get('/workflows/:slug/stats', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAnalyticsQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const normalized = normalizeAnalyticsQuery(parseQuery.data ?? {});
    if (!normalized.ok) {
      reply.status(400);
      return { error: ANALYTICS_ERROR_MESSAGES[normalized.error] ?? 'Invalid analytics query' };
    }

    try {
      const stats = await getWorkflowRunStatsBySlug(
        parseParams.data.slug,
        normalized.value.options
      );
      const serialized = serializeWorkflowRunStats(stats);
      reply.status(200);
      return {
        data: {
          ...serialized,
          range: { ...serialized.range, key: normalized.value.rangeKey }
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        reply.status(404);
        return { error: 'workflow not found' };
      }
      request.log.error({ err, workflow: parseParams.data.slug }, 'Failed to load workflow stats');
      reply.status(500);
      return { error: 'Failed to load workflow stats' };
    }
  });

  app.get('/workflows/:slug/run-metrics', async (request, reply) => {
    const parseParams = workflowSlugParamSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = workflowAnalyticsQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const normalized = normalizeAnalyticsQuery(parseQuery.data ?? {});
    if (!normalized.ok) {
      reply.status(400);
      return { error: ANALYTICS_ERROR_MESSAGES[normalized.error] ?? 'Invalid analytics query' };
    }

    try {
      const metrics = await getWorkflowRunMetricsBySlug(
        parseParams.data.slug,
        normalized.value.options
      );
      const serialized = serializeWorkflowRunMetrics(metrics);
      const bucketKey =
        normalized.value.bucketKey ?? mapIntervalToBucketKey(serialized.bucketInterval);

      reply.status(200);
      return {
        data: {
          ...serialized,
          range: { ...serialized.range, key: normalized.value.rangeKey },
          bucket: {
            interval: serialized.bucketInterval,
            key: bucketKey
          }
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('not found')) {
        reply.status(404);
        return { error: 'workflow not found' };
      }
      request.log.error(
        { err, workflow: parseParams.data.slug },
        'Failed to load workflow metrics'
      );
      reply.status(500);
      return { error: 'Failed to load workflow metrics' };
    }
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
