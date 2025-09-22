import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createJobDefinition,
  createJobRun,
  getBuildById,
  getJobDefinitionBySlug,
  getJobRunById,
  listJobDefinitions,
  listJobRunsForDefinition,
  completeJobRun,
  type JobDefinitionRecord,
  type JobRunRecord
} from '../db/index';
import { enqueueBuildJob, enqueueRepositoryIngestion } from '../queue';
import { executeJobRun } from '../jobs/runtime';
import {
  serializeJobDefinition,
  serializeJobRun,
  type JsonValue
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_RUN_SCOPES, JOB_WRITE_SCOPES } from './shared/scopes';
import {
  jobDefinitionCreateSchema,
  jsonValueSchema
} from '../workflows/zodSchemas';

const jobRunRequestSchema = z
  .object({
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    context: jsonValueSchema.optional()
  })
  .strict();

const jobRunListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50))
      .optional(),
    offset: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0))
      .optional()
  })
  .partial();

type JobDefinitionCreateInput = z.infer<typeof jobDefinitionCreateSchema>;
type JobRunRequestPayload = z.infer<typeof jobRunRequestSchema>;

function getStringParameter(parameters: JsonValue, key: string): string | null {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
    return null;
  }
  const value = (parameters as Record<string, JsonValue>)[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeJobDefinitionPayload(payload: JobDefinitionCreateInput) {
  return {
    slug: payload.slug,
    name: payload.name,
    type: payload.type,
    entryPoint: payload.entryPoint,
    version: payload.version,
    timeoutMs: payload.timeoutMs ?? null,
    retryPolicy: payload.retryPolicy ?? null,
    parametersSchema: payload.parametersSchema ?? {},
    defaultParameters: payload.defaultParameters ?? {},
    metadata: payload.metadata ?? null
  } as const;
}

function normalizeJobRunPayload(job: JobDefinitionRecord, payload: JobRunRequestPayload) {
  const parameters = payload.parameters ?? job.defaultParameters ?? {};
  const timeoutMs = payload.timeoutMs ?? job.timeoutMs ?? null;
  const fallbackMaxAttempts = job.retryPolicy?.maxAttempts ?? null;
  const maxAttempts =
    payload.maxAttempts !== undefined ? payload.maxAttempts : fallbackMaxAttempts;
  return { parameters, timeoutMs, maxAttempts, context: payload.context ?? null } as const;
}

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jobs', async (_request, reply) => {
    const jobs = await listJobDefinitions();
    reply.status(200);
    return { data: jobs.map((job) => serializeJobDefinition(job)) };
  });

  app.post('/jobs', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.create',
      resource: 'jobs',
      requiredScopes: JOB_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = jobDefinitionCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = normalizeJobDefinitionPayload(parseBody.data);

    try {
      const definition = await createJobDefinition(payload);
      reply.status(201);
      await authResult.auth.log('succeeded', { jobSlug: definition.slug, jobId: definition.id });
      return { data: serializeJobDefinition(definition) };
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        reply.status(409);
        await authResult.auth.log('failed', { reason: 'duplicate_job', message: err.message });
        return { error: err.message };
      }
      const message = err instanceof Error ? err.message : 'Failed to create job definition';
      request.log.error({ err }, 'Failed to create job definition');
      reply.status(500);
      await authResult.auth.log('failed', { reason: 'exception', message });
      return { error: 'Failed to create job definition' };
    }
  });

  app.get('/jobs/:slug', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const parseQuery = jobRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      return { error: 'job not found' };
    }

    const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 10, 50));
    const offset = Math.max(0, parseQuery.data.offset ?? 0);
    const runs = await listJobRunsForDefinition(job.id, { limit, offset });

    reply.status(200);
    return {
      data: {
        job: serializeJobDefinition(job),
        runs: runs.map((run) => serializeJobRun(run))
      },
      meta: { limit, offset }
    };
  });

  app.post('/jobs/:slug/run', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.run',
      resource: `job:${candidateSlug}`,
      requiredScopes: JOB_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_params', details: parseParams.error.flatten() });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = jobRunRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        jobSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    const job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      await authResult.auth.log('failed', { reason: 'job_not_found', jobSlug: parseParams.data.slug });
      return { error: 'job not found' };
    }

    const runInput = normalizeJobRunPayload(job, parseBody.data);
    const run = await createJobRun(job.id, runInput);
    let latestRun: JobRunRecord | null = run;

    const markFailureAndRespond = async (statusCode: number, message: string, reason = 'validation_error') => {
      reply.status(statusCode);
      await authResult.auth.log('failed', {
        reason,
        jobSlug: job.slug,
        runId: run.id,
        message
      });
      return { error: message };
    };

    try {
      if (job.slug === 'repository-ingest') {
        const repositoryId = getStringParameter(run.parameters, 'repositoryId');
        if (!repositoryId) {
          await completeJobRun(run.id, 'failed', { errorMessage: 'repositoryId parameter is required' });
          return markFailureAndRespond(400, 'repositoryId parameter is required', 'missing_parameter');
        }
        latestRun = await enqueueRepositoryIngestion(repositoryId, {
          jobRunId: run.id,
          parameters: run.parameters
        });
      } else if (job.slug === 'repository-build') {
        const buildId = getStringParameter(run.parameters, 'buildId');
        if (!buildId) {
          await completeJobRun(run.id, 'failed', { errorMessage: 'buildId parameter is required' });
          return markFailureAndRespond(400, 'buildId parameter is required', 'missing_parameter');
        }
        let repositoryId = getStringParameter(run.parameters, 'repositoryId');
        if (!repositoryId) {
          const build = await getBuildById(buildId);
          repositoryId = build?.repositoryId ?? null;
        }
        if (!repositoryId) {
          await completeJobRun(run.id, 'failed', { errorMessage: 'repositoryId parameter is required' });
          return markFailureAndRespond(400, 'repositoryId parameter is required', 'missing_parameter');
        }
        latestRun = await enqueueBuildJob(buildId, repositoryId, { jobRunId: run.id });
      } else {
        latestRun = await executeJobRun(run.id);
      }
    } catch (err) {
      request.log.error({ err, slug: job.slug }, 'Failed to execute job run');
      const errorMessage = (err as Error).message ?? 'job execution failed';
      await completeJobRun(run.id, 'failed', { errorMessage });
      reply.status(502);
      await authResult.auth.log('failed', {
        reason: 'execution_error',
        jobSlug: job.slug,
        runId: run.id,
        message: errorMessage
      });
      return { error: errorMessage };
    }

    const responseRun = latestRun ?? (await getJobRunById(run.id)) ?? run;

    reply.status(202);
    await authResult.auth.log('succeeded', {
      jobSlug: job.slug,
      runId: responseRun.id,
      status: responseRun.status
    });
    return { data: serializeJobRun(responseRun) };
  });
}
