import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  serializeJobDefinition,
  serializeJobBundleVersion,
  serializeJobRun,
  serializeJobRunWithDefinition
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_BUNDLE_WRITE_SCOPES, JOB_RUN_SCOPES, JOB_WRITE_SCOPES } from './shared/scopes';
import {
  jobDefinitionCreateSchema,
  jobDefinitionUpdateSchema
} from '../workflows/zodSchemas';
import {
  aiBundleEditRequestSchema,
  bundleRegenerateSchema,
  createJobService,
  jobRunRequestSchema,
  pythonSnippetCreateSchema,
  pythonSnippetPreviewSchema,
  type JobServiceErrorCode
} from '../jobs/service';
import { isJobServiceError, mapJobServiceError } from './shared/serviceErrorMapper';
import type { BundleEditorSnapshot } from '../jobs/bundleEditor';
import type { JobDefinitionRecord, JsonValue } from '../db/types';
import type { AiGeneratedBundleSuggestion } from '../ai/bundlePublisher';

const jobService = createJobService();

const jobRunListQuerySchema = z
  .object({
    limit: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(1).max(50))
      .optional(),
    offset: z
      .preprocess((val) => (val === undefined ? undefined : Number(val)), z.number().int().min(0))
      .optional(),
    status: z
      .preprocess((val) => {
        if (Array.isArray(val)) {
          return val
            .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        if (typeof val === 'string') {
          return val
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        return undefined;
      }, z.array(z.string()).optional()),
    job: z
      .preprocess((val) => {
        if (Array.isArray(val)) {
          return val
            .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        if (typeof val === 'string') {
          return val
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        return undefined;
      }, z.array(z.string()).optional()),
    runtime: z
      .preprocess((val) => {
        if (Array.isArray(val)) {
          return val
            .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        if (typeof val === 'string') {
          return val
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        return undefined;
      }, z.array(z.string()).optional()),
    search: z.string().max(200).optional()
  })
  .partial();

const schemaPreviewRequestSchema = z
  .object({
    entryPoint: z.string().min(1),
    runtime: z.enum(['node', 'python', 'docker']).optional()
  })
  .strict();

const LOG_REASON_MAP: Record<JobServiceErrorCode, string> = {
  docker_runtime_disabled: 'invalid_payload',
  invalid_docker_metadata: 'invalid_payload',
  duplicate_job: 'duplicate_job',
  job_not_found: 'job_not_found',
  bundle_editor_unavailable: 'bundle_editor_unavailable',
  job_bundle_binding_missing: 'job_bundle_binding_missing',
  invalid_snippet: 'invalid_snippet',
  execution_error: 'execution_error',
  ai_generation_failed: 'ai_generation_failed',
  ai_bundle_validation_failed: 'ai_bundle_validation_failed',
  invalid_bundle_payload: 'invalid_bundle_payload',
  duplicate_bundle_version: 'duplicate_bundle_version',
  missing_parameter: 'missing_parameter',
  unexpected_error: 'exception'
};

function toLogReason(code: JobServiceErrorCode): string {
  return LOG_REASON_MAP[code] ?? 'exception';
}

function attachErrorPayload(metadata: Record<string, JsonValue>, payload: unknown) {
  if (typeof payload === 'string') {
    metadata.message = payload;
  } else if (payload !== undefined) {
    metadata.details = payload as JsonValue;
  }
}

function toEditorFiles(snapshot: BundleEditorSnapshot): AiGeneratedBundleSuggestion['files'] {
  return snapshot.suggestion.files
    .map((file) => {
      const encoding: AiGeneratedBundleSuggestion['files'][number]['encoding'] =
        file.encoding === 'base64' ? 'base64' : 'utf8';
      return {
        path: file.path,
        contents: file.contents,
        encoding,
        executable: file.executable ? true : undefined
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function toEditorResponse(job: JobDefinitionRecord, snapshot: BundleEditorSnapshot) {
  const files = toEditorFiles(snapshot);
  return {
    job: serializeJobDefinition(job),
    binding: snapshot.binding,
    bundle: serializeJobBundleVersion(snapshot.version, { includeManifest: true }),
    editor: {
      entryPoint: snapshot.suggestion.entryPoint,
      manifestPath: snapshot.manifestPath,
      manifest: snapshot.suggestion.manifest,
      files
    },
    aiBuilder: snapshot.aiBuilderMetadata,
    history: snapshot.history,
    suggestionSource: snapshot.suggestionSource,
    availableVersions: snapshot.availableVersions.map((version) =>
      serializeJobBundleVersion(version)
    )
  } as const;
}

export async function registerJobRoutes(app: FastifyInstance): Promise<void> {
  app.get('/jobs', async (_request, reply) => {
    const jobs = await jobService.listJobDefinitions();
    reply.status(200);
    return { data: jobs.map((job) => serializeJobDefinition(job)) };
  });

  app.get('/jobs/runtimes', async (_request, reply) => {
    const readiness = await jobService.getRuntimeReadiness();
    reply.status(200);
    return { data: readiness };
  });

  app.get('/job-runs', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'job-runs.list',
      resource: 'jobs',
      requiredScopes: JOB_RUN_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseQuery = jobRunListQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        action: 'job-runs.list',
        reason: 'invalid_query',
        details: parseQuery.error.flatten() as unknown as JsonValue
      });
      return { error: parseQuery.error.flatten() };
    }

    const limit = Math.min(Math.max(parseQuery.data.limit ?? 25, 1), 50);
    const offset = Math.max(parseQuery.data.offset ?? 0, 0);
    const filters = {
      statuses: parseQuery.data.status,
      jobSlugs: parseQuery.data.job,
      runtimes: parseQuery.data.runtime,
      search: parseQuery.data.search
    };
    const { items, hasMore } = await jobService.listJobRuns({ limit, offset, filters });

    reply.status(200);
    await authResult.auth.log('succeeded', {
      action: 'job-runs.list',
      count: items.length,
      limit,
      offset,
      hasMore
    });
    return {
      data: items.map((entry) => serializeJobRunWithDefinition(entry)),
      meta: {
        limit,
        offset,
        hasMore,
        nextOffset: hasMore ? offset + limit : null
      }
    };
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
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const definition = await jobService.createJobDefinition(parseBody.data, { logger: request.log });
      reply.status(201);
      await authResult.auth.log('succeeded', { jobSlug: definition.slug, jobId: definition.id });
      return { data: serializeJobDefinition(definition) };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code)
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
  });

  app.patch('/jobs/:slug', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.update',
      resource: 'jobs',
      requiredScopes: JOB_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten() as unknown as JsonValue
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = jobDefinitionUpdateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        jobSlug: parseParams.data.slug,
        details: parseBody.error.flatten() as unknown as JsonValue
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const updated = await jobService.updateJobDefinition(parseParams.data.slug, parseBody.data, {
        logger: request.log
      });
      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'jobs.update',
        jobSlug: updated.slug
      });
      return { data: serializeJobDefinition(updated) };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code),
          jobSlug: parseParams.data.slug
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
  });

  app.post('/jobs/schema-preview', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.schema-preview',
      resource: 'jobs',
      requiredScopes: JOB_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = schemaPreviewRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const preview = await jobService.previewJobSchemas(parseBody.data.entryPoint, {
        logger: request.log
      });
      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'jobs.schema-preview',
        entryPoint: parseBody.data.entryPoint,
        runtime: parseBody.data.runtime ?? null,
        parametersSource: preview?.parametersSource ?? null,
        outputSource: preview?.outputSource ?? null
      });
      return {
        data:
          preview ?? {
            parametersSchema: null,
            outputSchema: null,
            parametersSource: null,
            outputSource: null
          }
      };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        await authResult.auth.log('failed', {
          reason: toLogReason(err.code),
          entryPoint: parseBody.data.entryPoint
        });
        return { error: payload };
      }
      throw err;
    }
  });

  app.post('/jobs/python-snippet/preview', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.python-snippet.preview',
      resource: 'jobs',
      requiredScopes: JOB_WRITE_SCOPES
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = pythonSnippetPreviewSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const preview = await jobService.previewPythonSnippet(parseBody.data, { logger: request.log });
      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'jobs.python-snippet.preview',
        handler: preview.handlerName,
        inputModel: preview.inputModel.name,
        outputModel: preview.outputModel.name
      });
      return { data: preview };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code)
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
  });

  app.post('/jobs/python-snippet', async (request, reply) => {
    const requiredScopes = Array.from(new Set([...JOB_WRITE_SCOPES, ...JOB_BUNDLE_WRITE_SCOPES]));
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.python-snippet.create',
      resource: 'jobs',
      requiredScopes
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = pythonSnippetCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const result = await jobService.createPythonSnippetJob(
        parseBody.data,
        {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        },
        { logger: request.log }
      );

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'jobs.python-snippet.create',
        jobSlug: result.job.slug,
        handler: result.analysis.handlerName,
        bundleSlug: result.bundle.slug,
        bundleVersion: result.bundle.version
      });
      return {
        data: {
          job: serializeJobDefinition(result.job),
          analysis: result.analysis,
          bundle: result.bundle
        }
      };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code)
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
  });

  app.get('/jobs/:slug', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    try {
      const parseQuery = jobRunListQuerySchema.safeParse(request.query ?? {});
      if (!parseQuery.success) {
        reply.status(400);
        return { error: parseQuery.error.flatten() };
      }
      const limit = Math.max(1, Math.min(parseQuery.data.limit ?? 10, 50));
      const offset = Math.max(0, parseQuery.data.offset ?? 0);
      const { job, runs } = await jobService.getJobWithRuns(parseParams.data.slug, { limit, offset });
      reply.status(200);
      return {
        data: {
          job: serializeJobDefinition(job),
          runs: runs.map((run) => serializeJobRun(run))
        },
        meta: { limit, offset }
      };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        return { error: payload };
      }
      throw err;
    }
  });

  app.get('/jobs/:slug/bundle-editor', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    try {
      const { job, snapshot } = await jobService.loadBundleEditor(parseParams.data.slug, {
        logger: request.log
      });
      reply.status(200);
      return { data: toEditorResponse(job, snapshot) };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        return { error: payload };
      }
      throw err;
    }
  });

  app.post('/jobs/:slug/bundle/ai-edit', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const requiredScopes = Array.from(new Set([...JOB_BUNDLE_WRITE_SCOPES, ...JOB_WRITE_SCOPES]));
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.bundle-ai-edit',
      resource: `job:${candidateSlug}`,
      requiredScopes
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten() as unknown as JsonValue,
        jobSlug: candidateSlug
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = aiBundleEditRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue,
        jobSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const result = await jobService.aiEditBundle(
        { ...parseBody.data, slug: parseParams.data.slug },
        {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        },
        { logger: request.log }
      );

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'jobs.bundle-ai-edit',
        jobSlug: result.job.slug,
        bundleSlug: result.publishResult.version.slug,
        bundleVersion: result.publishResult.version.version
      });
      return { data: toEditorResponse(result.job, result.snapshot) };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code),
          jobSlug: parseParams.data.slug
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
  });

  app.post('/jobs/:slug/bundle/regenerate', async (request, reply) => {
    const rawParams = request.params as Record<string, unknown> | undefined;
    const candidateSlug = typeof rawParams?.slug === 'string' ? rawParams.slug : 'unknown';

    const requiredScopes = Array.from(new Set([...JOB_BUNDLE_WRITE_SCOPES, ...JOB_WRITE_SCOPES]));
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'jobs.bundle-regenerate',
      resource: `job:${candidateSlug}`,
      requiredScopes
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten() as unknown as JsonValue,
        jobSlug: candidateSlug
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = bundleRegenerateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue,
        jobSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const result = await jobService.regenerateBundle(
        { ...parseBody.data, slug: parseParams.data.slug },
        {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        },
        { logger: request.log }
      );

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'jobs.bundle-regenerate',
        jobSlug: result.job.slug,
        bundleSlug: result.publishResult.version.slug,
        bundleVersion: result.publishResult.version.version
      });
      return { data: toEditorResponse(result.job, result.snapshot) };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code),
          jobSlug: parseParams.data.slug
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
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
      await authResult.auth.log('failed', {
        reason: 'invalid_params',
        details: parseParams.error.flatten() as unknown as JsonValue
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = jobRunRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten() as unknown as JsonValue,
        jobSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const run = await jobService.runJob(parseParams.data.slug, parseBody.data, { logger: request.log });
      reply.status(202);
      await authResult.auth.log('succeeded', {
        jobSlug: parseParams.data.slug,
        runId: run.id,
        status: run.status
      });
      return { data: serializeJobRun(run) };
    } catch (err) {
      if (isJobServiceError(err)) {
        const payload = mapJobServiceError(reply, err);
        const metadata: Record<string, JsonValue> = {
          reason: toLogReason(err.code),
          jobSlug: parseParams.data.slug
        };
        attachErrorPayload(metadata, payload);
        await authResult.auth.log('failed', metadata);
        return { error: payload };
      }
      throw err;
    }
  });
}
