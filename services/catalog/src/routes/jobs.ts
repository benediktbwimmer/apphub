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
import { schemaRef } from '../openapi/definitions';

const jobService = createJobService();

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
const jobDefinitionResponse = jsonResponse.bind(null, 'JobDefinitionResponse');
const jobDefinitionListResponse = jsonResponse.bind(null, 'JobDefinitionListResponse');
const jobRunListResponse = jsonResponse.bind(null, 'JobRunListResponse');
const jobDetailResponse = jsonResponse.bind(null, 'JobDetailResponse');
const runtimeReadinessResponse = jsonResponse.bind(null, 'RuntimeReadinessListResponse');
const jobSchemaPreviewResponse = jsonResponse.bind(null, 'JobSchemaPreviewResponse');
const pythonSnippetPreviewResponse = jsonResponse.bind(null, 'PythonSnippetPreview');
const pythonSnippetCreateResponse = jsonResponse.bind(null, 'PythonSnippetCreateResponse');
const jobRunResponse = jsonResponse.bind(null, 'JobRun');

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

const jobRunListQueryOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: 50 },
    offset: { type: 'integer', minimum: 0 },
    status: {
      type: 'string',
      description: 'Comma-separated job run statuses to filter (pending,running,succeeded,failed,canceled,expired).'
    },
    job: {
      type: 'string',
      description: 'Comma-separated list of job slugs to filter.'
    },
    runtime: {
      type: 'string',
      description: 'Comma-separated list of runtimes to filter (node,python,docker).'
    },
    search: { type: 'string', maxLength: 200 }
  }
} as const;

const schemaPreviewRequestOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entryPoint'],
  properties: {
    entryPoint: { type: 'string', minLength: 1, maxLength: 256 },
    runtime: { type: 'string', enum: ['node', 'python', 'docker'] }
  }
} as const;

const pythonSnippetPreviewRequestOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['snippet'],
  properties: {
    snippet: { type: 'string', minLength: 1, maxLength: 20_000 }
  }
} as const;

const pythonSnippetCreateRequestOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'name', 'type', 'snippet', 'versionStrategy'],
  properties: {
    slug: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Job slug (alphanumeric, dash, underscore).'
    },
    name: { type: 'string', minLength: 1 },
    type: { type: 'string', enum: ['batch', 'service-triggered', 'manual'] },
    snippet: { type: 'string', minLength: 1, maxLength: 20_000 },
    dependencies: {
      type: 'array',
      maxItems: 32,
      items: { type: 'string', minLength: 1, maxLength: 120 }
    },
    timeoutMs: { type: 'integer', minimum: 1_000, maximum: 86_400_000 },
    versionStrategy: { type: 'string', enum: ['auto', 'manual'] },
    bundleSlug: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Bundle slug to reuse (optional when versionStrategy is auto).'
    },
    bundleVersion: { type: 'string', minLength: 1, maxLength: 100 },
    jobVersion: { type: 'integer', minimum: 1 }
  }
} as const;

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
  app.get(
    '/jobs',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'List job definitions',
        response: {
          200: jobDefinitionListResponse('Job definitions currently available to run.')
        }
      }
    },
    async (_request, reply) => {
      const jobs = await jobService.listJobDefinitions();
      reply.status(200);
      return { data: jobs.map((job) => serializeJobDefinition(job)) };
    }
  );

  app.get(
    '/jobs/runtimes',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'List runtime readiness',
        description: 'Reports whether each job runtime (node, python, docker) is ready to execute jobs.',
        response: {
          200: runtimeReadinessResponse('Runtime readiness diagnostics.'),
          500: errorResponse('Failed to compute runtime readiness.')
        }
      }
    },
    async (_request, reply) => {
      const readiness = await jobService.getRuntimeReadiness();
      reply.status(200);
      return { data: readiness };
    }
  );

  app.get(
    '/job-runs',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'List job runs',
        security: [{ OperatorToken: [] }],
        querystring: jobRunListQueryOpenApiSchema,
        response: {
          200: jobRunListResponse('Job runs matching the requested filters.'),
          400: errorResponse('The job run filters were invalid.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to list job runs.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Create a job definition',
        description:
          'Creates a new job definition. Only callers with the jobs:write scope may invoke this endpoint.',
        security: [{ OperatorToken: [] }],
        body: schemaRef('JobDefinitionCreateRequest'),
        response: {
          201: jobDefinitionResponse('The job definition was created successfully.'),
          400: errorResponse('The request payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The operator token is missing required scopes.'),
          409: errorResponse('A job definition with the same slug already exists.'),
          500: errorResponse('The server failed to persist the job definition.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.patch(
    '/jobs/:slug',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Update a job definition',
        description: 'Updates an existing job definition. Requires jobs:write scope.',
        security: [{ OperatorToken: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: { type: 'string', description: 'Job definition slug.' }
          }
        },
        body: schemaRef('JobDefinitionUpdateRequest'),
        response: {
          200: jobDefinitionResponse('Job definition updated successfully.'),
          400: errorResponse('The update payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The operator token is missing required scopes.'),
          404: errorResponse('Job definition not found.'),
          409: errorResponse('The update conflicted with an existing job definition.'),
          500: errorResponse('The server failed to persist the job definition.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs/schema-preview',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Preview job entry point schemas',
        description: 'Introspects a bundle entry point to infer input and output schemas.',
        security: [{ OperatorToken: [] }],
        body: schemaPreviewRequestOpenApiSchema,
        response: {
          200: jobSchemaPreviewResponse('Inferred schemas for the supplied entry point.'),
          400: errorResponse('The schema preview payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to preview job schemas.'),
          500: errorResponse('Failed to inspect entry point schemas.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs/python-snippet/preview',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Preview Python snippet analysis',
        description: 'Analyzes a Python snippet to infer handler metadata before creating a job.',
        security: [{ OperatorToken: [] }],
        body: pythonSnippetPreviewRequestOpenApiSchema,
        response: {
          200: pythonSnippetPreviewResponse('Python snippet analysis results.'),
          400: errorResponse('The Python snippet payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to analyze Python snippets.'),
          500: errorResponse('Failed to analyze the Python snippet.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs/python-snippet',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Create a Python snippet job',
        description: 'Analyzes the provided snippet, generates a bundle, and creates or updates the job definition.',
        security: [{ OperatorToken: [] }],
        body: pythonSnippetCreateRequestOpenApiSchema,
        response: {
          201: pythonSnippetCreateResponse('Python snippet job created successfully.'),
          400: errorResponse('The Python snippet payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to create Python snippet jobs.'),
          500: errorResponse('Failed to create Python snippet job.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.get(
    '/jobs/:slug',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Get job definition with recent runs',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: { type: 'string', description: 'Job definition slug.' }
          }
        },
        querystring: jobRunListQueryOpenApiSchema,
        response: {
          200: jobDetailResponse('Job definition and recent runs.'),
          400: errorResponse('The job lookup parameters were invalid.'),
          404: errorResponse('Job definition not found.'),
          500: errorResponse('Failed to load job details.')
        }
      }
    },
    async (request, reply) => {
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
        const offset = Math.max(0, Math.min(parseQuery.data.offset ?? 0, Number.MAX_SAFE_INTEGER));
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
    }
  );

  app.get(
    '/jobs/:slug/bundle-editor',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Fetch bundle editor context for a job',
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: { type: 'string', description: 'Slug of the job definition to inspect.' }
          }
        },
        response: {
          200: jsonResponse('BundleEditorResponse', 'Current bundle editor state for the requested job.'),
          400: errorResponse('The provided slug failed validation.'),
          404: errorResponse('No job or bundle editor snapshot was found for the provided slug.'),
          500: errorResponse('An unexpected error occurred while loading the bundle editor snapshot.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs/:slug/bundle/ai-edit',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Generate bundle edits with AI',
        description:
          'Runs an AI provider against the current job bundle and publishes a new version when the response is valid.',
        security: [{ OperatorToken: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: {
              type: 'string',
              description: 'Slug of the job whose bundle should be regenerated.'
            }
          }
        },
        body: schemaRef('AiBundleEditRequest'),
        response: {
          201: jsonResponse('BundleEditorResponse', 'A new bundle version was generated and bound to the job.'),
          400: errorResponse('Request parameters or generated bundle payload were invalid.'),
          401: errorResponse('The request lacked an operator token.'),
          403: errorResponse('The supplied operator token was missing required scopes.'),
          404: errorResponse('No job or bundle editor snapshot was found for the provided slug.'),
          409: errorResponse('The job is not bound to a bundle entry point or the generated version already exists.'),
          422: errorResponse('The AI response did not contain a valid bundle suggestion.'),
          502: errorResponse('The selected AI provider failed to generate a response.'),
          500: errorResponse('The server failed to publish the generated bundle.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs/:slug/bundle/regenerate',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Regenerate bundle editor snapshot',
        description: 'Applies manual bundle edits and publishes a new version bound to the job.',
        security: [{ OperatorToken: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: { type: 'string', description: 'Job definition slug.' }
          }
        },
        body: schemaRef('BundleRegenerateRequest'),
        response: {
          201: jsonResponse('BundleEditorResponse', 'Bundle regenerated and bound to the job.'),
          400: errorResponse('The bundle regenerate payload failed validation.'),
          401: errorResponse('The request lacked an operator token.'),
          403: errorResponse('The supplied operator token was missing required scopes.'),
          404: errorResponse('Job or bundle editor snapshot not found.'),
          409: errorResponse('A conflicting bundle version already exists.'),
          422: errorResponse('The bundle edits were invalid.'),
          500: errorResponse('Failed to regenerate the bundle.')
        }
      }
    },
    async (request, reply) => {
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
    }
  );

  app.post(
    '/jobs/:slug/run',
    {
      schema: {
        tags: ['Jobs'],
        summary: 'Trigger a job run',
        description: 'Queues a run for the specified job definition.',
        security: [{ OperatorToken: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: { type: 'string', description: 'Job definition slug.' }
          }
        },
        body: schemaRef('JobRunRequest'),
        response: {
          202: jobRunResponse('Job run scheduled.'),
          400: errorResponse('The job run payload failed validation.'),
          401: errorResponse('The caller is unauthenticated.'),
          403: errorResponse('The caller is not authorized to run the job.'),
          404: errorResponse('Job definition not found.'),
          500: errorResponse('Failed to schedule the job run.')
        }
      }
    },
    async (request, reply) => {
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
        const run = await jobService.runJob(parseParams.data.slug, parseBody.data, {
          logger: request.log
        });
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
    }
  );
}
