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
  upsertJobDefinition,
  type JobDefinitionRecord,
  type JobRunRecord
} from '../db/index';
import { enqueueBuildJob, enqueueRepositoryIngestion } from '../queue';
import { executeJobRun } from '../jobs/runtime';
import { getRuntimeReadiness } from '../jobs/runtimeReadiness';
import { introspectEntryPointSchemas } from '../jobs/schemaIntrospector';
import {
  previewPythonSnippet,
  createPythonSnippetJob,
  PythonSnippetBuilderError
} from '../jobs/pythonSnippetBuilder';
import { PythonSnippetAnalysisError } from '../jobs/pythonSnippetAnalyzer';
import {
  serializeJobDefinition,
  serializeJobBundleVersion,
  serializeJobRun,
  type JsonValue
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_BUNDLE_WRITE_SCOPES, JOB_RUN_SCOPES, JOB_WRITE_SCOPES } from './shared/scopes';
import {
  aiJobWithBundleOutputSchema,
  jobDefinitionCreateSchema,
  jsonValueSchema
} from '../workflows/zodSchemas';
import {
  loadBundleEditorSnapshot,
  parseBundleEntryPoint,
  findNextVersion,
  type BundleEditorSnapshot
} from '../jobs/bundleEditor';
import {
  extractMetadata,
  cloneSuggestion
} from '../jobs/bundleRecovery';
import {
  publishGeneratedBundle,
  type AiGeneratedBundleSuggestion,
  type AiGeneratedBundleFile
} from '../ai/bundlePublisher';
import { buildCodexContextFiles } from '../ai/contextFiles';
import { runCodexGeneration } from '../ai/codexRunner';
import { runOpenAiGeneration } from '../ai/openAiRunner';
import { runOpenRouterGeneration } from '../ai/openRouterRunner';
import {
  DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS,
  DEFAULT_AI_BUILDER_SYSTEM_PROMPT
} from '../ai/prompts';

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

const bundleEditorFileSchema = z
  .object({
    path: z.string().min(1).max(512),
    contents: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    executable: z.boolean().optional()
  })
  .strict();

const bundleRegenerateSchema = z
  .object({
    entryPoint: z.string().min(1).max(256),
    manifestPath: z.string().min(1).max(512),
    manifest: jsonValueSchema.optional(),
    files: z.array(bundleEditorFileSchema).min(1),
    capabilityFlags: z.array(z.string().min(1)).optional(),
    metadata: jsonValueSchema.optional(),
    description: z.string().max(512).nullable().optional(),
    displayName: z.string().max(256).nullable().optional(),
    version: z.string().max(100).optional()
  })
  .strict();

const schemaPreviewRequestSchema = z
  .object({
    entryPoint: z.string().min(1),
    runtime: z.enum(['node', 'python']).optional()
  })
  .strict();

const pythonSnippetPreviewSchema = z
  .object({
    snippet: z.string().min(1).max(20_000)
  })
  .strict();

const dependencySchema = z
  .string()
  .min(1)
  .max(120);

const pythonSnippetCreateSchema = z
  .object({
    slug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Slug must contain only alphanumeric characters, dashes, or underscores'),
    name: z.string().min(1),
    type: z.enum(['batch', 'service-triggered', 'manual']),
    snippet: z.string().min(1).max(20_000),
    dependencies: z.array(dependencySchema).max(32).optional(),
    timeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
    versionStrategy: z.enum(['auto', 'manual']).default('auto'),
    bundleSlug: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9-_]*$/i, 'Bundle slug must contain only alphanumeric characters, dashes, or underscores')
      .optional(),
    bundleVersion: z.string().min(1).max(100).optional(),
    jobVersion: z.number().int().min(1).optional()
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.versionStrategy === 'manual' && !payload.bundleVersion) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bundleVersion'],
        message: 'Bundle version is required when versionStrategy is manual'
      });
    }
  });

type JobDefinitionCreateInput = z.infer<typeof jobDefinitionCreateSchema>;
type JobRunRequestPayload = z.infer<typeof jobRunRequestSchema>;
type BundleRegeneratePayload = z.infer<typeof bundleRegenerateSchema>;

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
    runtime: payload.runtime ?? 'node',
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

function normalizeCapabilityFlagInput(flags: string[] | undefined): string[] {
  if (!flags) {
    return [];
  }
  const seen = new Set<string>();
  for (const flag of flags) {
    if (typeof flag !== 'string') {
      continue;
    }
    const trimmed = flag.trim();
    if (!trimmed) {
      continue;
    }
    seen.add(trimmed);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

const OPENAI_MAX_TOKENS_DEFAULT = 4_096;

const aiBundleEditProviderSchema = z.enum(['codex', 'openai', 'openrouter']);

const aiBundleEditProviderOptionsSchema = z
  .object({
    openAiApiKey: z.string().min(8).max(200).optional(),
    openAiBaseUrl: z.string().url().max(400).optional(),
    openAiMaxOutputTokens: z
      .number({ coerce: true })
      .int()
      .min(256)
      .max(32_000)
      .optional(),
    openRouterApiKey: z.string().min(8).max(200).optional(),
    openRouterReferer: z.string().url().max(600).optional(),
    openRouterTitle: z.string().min(1).max(200).optional()
  })
  .partial()
  .strict();

const aiBundleEditRequestSchema = z
  .object({
    prompt: z.string().min(1).max(2_000),
    provider: aiBundleEditProviderSchema.optional(),
    providerOptions: aiBundleEditProviderOptionsSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const provider = value.provider ?? 'openai';
    if (provider === 'openai') {
      const apiKey = value.providerOptions?.openAiApiKey?.trim();
      if (!apiKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerOptions', 'openAiApiKey'],
          message: 'OpenAI API key is required when provider is "openai".'
        });
      }
    } else if (provider === 'openrouter') {
      const apiKey = value.providerOptions?.openRouterApiKey?.trim();
      if (!apiKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['providerOptions', 'openRouterApiKey'],
          message: 'OpenRouter API key is required when provider is "openrouter".'
        });
      }
    }
  });

function extractManifestCapabilities(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [];
  }
  const record = manifest as Record<string, unknown>;
  const capabilities = record.capabilities;
  if (Array.isArray(capabilities)) {
    return normalizeCapabilityFlagInput(capabilities.filter((entry): entry is string => typeof entry === 'string'));
  }
  if (typeof capabilities === 'string') {
    return normalizeCapabilityFlagInput(capabilities.split(','));
  }
  return [];
}

function buildAiEditMetadataSummary(job: JobDefinitionRecord, snapshot: BundleEditorSnapshot): string {
  const lines: string[] = [];
  lines.push('## Job');
  lines.push(`- slug: ${job.slug}`);
  lines.push(`- name: ${job.name}`);
  lines.push(`- type: ${job.type}`);
  lines.push(`- runtime: ${job.runtime}`);
  lines.push(`- currentEntryPoint: ${job.entryPoint}`);
  lines.push('');
  lines.push('## Bundle');
  lines.push(`- slug: ${snapshot.binding.slug}`);
  lines.push(`- version: ${snapshot.binding.version}`);
  lines.push(`- entryPointFile: ${snapshot.suggestion.entryPoint}`);
  lines.push(`- manifestPath: ${snapshot.manifestPath}`);
  const suggestionFlags = normalizeCapabilityFlagInput(snapshot.suggestion.capabilityFlags ?? []);
  lines.push(`- capabilityFlags: ${suggestionFlags.length > 0 ? suggestionFlags.join(', ') : '(none)'}`);
  const manifestCapabilities = extractManifestCapabilities(snapshot.suggestion.manifest);
  lines.push(
    `- manifestCapabilities: ${manifestCapabilities.length > 0 ? manifestCapabilities.join(', ') : '(none)'}`
  );
  if (snapshot.suggestion.description) {
    lines.push(`- description: ${snapshot.suggestion.description}`);
  }
  if (snapshot.suggestion.displayName) {
    lines.push(`- displayName: ${snapshot.suggestion.displayName}`);
  }
  lines.push('');
  const fileNames = snapshot.suggestion.files.map((file) => file.path).sort();
  lines.push('## Files');
  lines.push(`${fileNames.length > 0 ? fileNames.join(', ') : '(none)'}`);
  lines.push('');
  lines.push('Ensure the updated bundle keeps the same slug and exposes the entry point while applying the requested changes.');
  return lines.join('\n');
}

type AiBundleEditEvaluation = {
  job: z.infer<typeof aiJobWithBundleOutputSchema>['job'] | null;
  bundle: AiGeneratedBundleSuggestion | null;
  errors: string[];
};

function evaluateAiBundleEditOutput(raw: string): AiBundleEditEvaluation {
  const errors: string[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`Failed to parse JSON output: ${message}`);
    return { job: null, bundle: null, errors };
  }

  const validation = aiJobWithBundleOutputSchema.safeParse(parsed);
  if (!validation.success) {
    for (const issue of validation.error.errors) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      errors.push(`${path}: ${issue.message}`);
    }
    return { job: null, bundle: null, errors };
  }

  const bundle = validation.data.bundle;
  const entryPoint = bundle.entryPoint;
  const files = Array.isArray(bundle.files) ? bundle.files : [];
  if (!files.some((file) => file.path === entryPoint)) {
    errors.push(`Bundle is missing entry point file: ${entryPoint}`);
  }

  const capabilityFlags = normalizeCapabilityFlagInput(bundle.capabilityFlags ?? []);
  if (!Array.isArray(bundle.capabilityFlags)) {
    errors.push('bundle.capabilityFlags must be an array of capability identifiers.');
  }
  const manifestCapabilities = extractManifestCapabilities(bundle.manifest);
  const missingManifestCapabilities = manifestCapabilities.filter((cap) => !capabilityFlags.includes(cap));
  if (missingManifestCapabilities.length > 0) {
    errors.push(
      `bundle.capabilityFlags must include manifest capabilities: missing ${missingManifestCapabilities.join(', ')}`
    );
  }

  const normalizedBundle: AiGeneratedBundleSuggestion = {
    slug: bundle.slug,
    version: bundle.version,
    entryPoint,
    manifest: bundle.manifest,
    manifestPath:
      typeof bundle.manifestPath === 'string' && bundle.manifestPath.trim().length > 0
        ? bundle.manifestPath.trim()
        : 'manifest.json',
    capabilityFlags,
    metadata: bundle.metadata ?? null,
    description: bundle.description ?? null,
    displayName: bundle.displayName ?? null,
    files: files.map((file) => ({
      path: file.path,
      contents: file.contents,
      encoding: file.encoding === 'base64' ? 'base64' : 'utf8',
      executable: file.executable ? true : undefined
    }))
  };

  return {
    job: validation.data.job,
    bundle: normalizedBundle,
    errors
  };
}

function toEditorFiles(snapshot: BundleEditorSnapshot): AiGeneratedBundleSuggestion['files'] {
  return snapshot.suggestion.files
    .map((file) => {
      const encoding: AiGeneratedBundleFile['encoding'] =
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
    const jobs = await listJobDefinitions();
    reply.status(200);
    return { data: jobs.map((job) => serializeJobDefinition(job)) };
  });

  app.get('/jobs/runtimes', async (_request, reply) => {
    const readiness = await getRuntimeReadiness();
    reply.status(200);
    return { data: readiness };
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
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const preview = await introspectEntryPointSchemas(parseBody.data.entryPoint);
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
      request.log.error(
        { err, entryPoint: parseBody.data.entryPoint },
        'Failed to inspect job entry point for schema preview'
      );
      reply.status(500);
      await authResult.auth.log('failed', {
        reason: 'exception',
        entryPoint: parseBody.data.entryPoint
      });
      return { error: 'Failed to inspect entry point' };
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
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    try {
      const preview = await previewPythonSnippet(parseBody.data.snippet);
      reply.status(200);
      await authResult.auth.log('succeeded', {
        action: 'jobs.python-snippet.preview',
        handler: preview.handlerName,
        inputModel: preview.inputModel.name,
        outputModel: preview.outputModel.name
      });
      return { data: preview };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze snippet';
      const isBadRequest = err instanceof PythonSnippetAnalysisError || err instanceof PythonSnippetBuilderError;
      request.log.warn({ err }, 'Python snippet preview failed');
      reply.status(isBadRequest ? 400 : 500);
      await authResult.auth.log('failed', {
        reason: isBadRequest ? 'invalid_snippet' : 'exception',
        message
      });
      return { error: message };
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
        details: parseBody.error.flatten()
      });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;

    try {
      const result = await createPythonSnippetJob(
        {
          slug: payload.slug,
          name: payload.name,
          type: payload.type,
          snippet: payload.snippet,
          dependencies: payload.dependencies ?? [],
          timeoutMs: payload.timeoutMs ?? null,
          versionStrategy: payload.versionStrategy,
          bundleSlug: payload.bundleSlug ?? null,
          bundleVersion: payload.bundleVersion ?? null,
          jobVersion: payload.jobVersion ?? null
        },
        {
          subject: authResult.auth.identity.subject,
          kind: authResult.auth.identity.kind,
          tokenHash: authResult.auth.identity.tokenHash
        }
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
      const message = err instanceof Error ? err.message : 'Failed to create Python job';
      const isBadRequest = err instanceof PythonSnippetAnalysisError || err instanceof PythonSnippetBuilderError;
      request.log.error({ err }, 'Failed to create Python snippet job');
      reply.status(isBadRequest ? 400 : 500);
      await authResult.auth.log('failed', {
        reason: isBadRequest ? 'invalid_snippet' : 'exception',
        message
      });
      return { error: message };
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

  app.get('/jobs/:slug/bundle-editor', async (request, reply) => {
    const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      return { error: 'job not found' };
    }

    try {
      const snapshot = await loadBundleEditorSnapshot(job);
      if (!snapshot) {
        reply.status(404);
        return { error: 'bundle editor not available for job' };
      }
      reply.status(200);
      return { data: toEditorResponse(job, snapshot) };
    } catch (err) {
      request.log.error({ err, slug: job.slug }, 'Failed to load bundle editor');
      reply.status(500);
      return { error: 'Failed to load bundle editor' };
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
        details: parseParams.error.flatten(),
        jobSlug: candidateSlug
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = aiBundleEditRequestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        jobSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    let job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'job_not_found',
        jobSlug: parseParams.data.slug
      });
      return { error: 'job not found' };
    }

    const binding = parseBundleEntryPoint(job.entryPoint);
    if (!binding) {
      reply.status(409);
      await authResult.auth.log('failed', {
        reason: 'job_bundle_binding_missing',
        jobSlug: job.slug
      });
      return { error: 'job is not bound to a bundle entry point' };
    }

    let snapshot: BundleEditorSnapshot | null = null;
    try {
      snapshot = await loadBundleEditorSnapshot(job);
    } catch (err) {
      request.log.error({ err, slug: job.slug }, 'Failed to load bundle snapshot for AI edit');
    }
    if (!snapshot) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'bundle_editor_unavailable',
        jobSlug: job.slug
      });
      return { error: 'bundle editor not available for job' };
    }

    const operatorRequest = parseBody.data.prompt.trim();
    const provider = parseBody.data.provider ?? 'openai';
    const providerOptions = parseBody.data.providerOptions ?? {};

    const bundleContext = {
      slug: snapshot.binding.slug,
      version: snapshot.binding.version,
      entryPoint: snapshot.suggestion.entryPoint,
      manifest: snapshot.suggestion.manifest,
      manifestPath: snapshot.manifestPath,
      capabilityFlags: normalizeCapabilityFlagInput(snapshot.suggestion.capabilityFlags ?? []),
      metadata: snapshot.suggestion.metadata ?? null,
      description: snapshot.suggestion.description ?? null,
      displayName: snapshot.suggestion.displayName ?? null,
      files: snapshot.suggestion.files.map((file) => ({ ...file })),
      jobSlugs: [job.slug]
    };

    const metadataSummary = buildAiEditMetadataSummary(job, snapshot);
    const additionalNotes = `Modify bundle ${binding.slug}@${binding.version} for job ${job.slug}. Preserve the bundle slug and keep the entry point exposed as ${snapshot.suggestion.entryPoint}.`;

    const contextFiles = buildCodexContextFiles({
      mode: 'job-with-bundle',
      jobs: [serializeJobDefinition(job)],
      services: [],
      workflows: [],
      bundles: [bundleContext]
    });

    let rawOutput = '';
    let summary: string | null = null;

    try {
      if (provider === 'openai') {
        const openAiApiKey = providerOptions.openAiApiKey?.trim() ?? '';
        const openAiBaseUrl = providerOptions.openAiBaseUrl?.trim() || undefined;
        const maxTokens =
          typeof providerOptions.openAiMaxOutputTokens === 'number' && Number.isFinite(providerOptions.openAiMaxOutputTokens)
            ? Math.min(Math.max(Math.trunc(providerOptions.openAiMaxOutputTokens), 256), 32_000)
            : OPENAI_MAX_TOKENS_DEFAULT;

        const result = await runOpenAiGeneration({
          mode: 'job-with-bundle',
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          apiKey: openAiApiKey,
          baseUrl: openAiBaseUrl,
          maxOutputTokens: maxTokens,
          systemPrompt: DEFAULT_AI_BUILDER_SYSTEM_PROMPT,
          responseInstructions: DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS
        });
        rawOutput = result.output;
        summary = result.summary ?? null;
      } else if (provider === 'openrouter') {
        const openRouterApiKey = providerOptions.openRouterApiKey?.trim() ?? '';
        const openRouterReferer = providerOptions.openRouterReferer?.trim() || undefined;
        const openRouterTitle = providerOptions.openRouterTitle?.trim() || undefined;

        const result = await runOpenRouterGeneration({
          mode: 'job-with-bundle',
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          apiKey: openRouterApiKey,
          referer: openRouterReferer,
          title: openRouterTitle,
          systemPrompt: DEFAULT_AI_BUILDER_SYSTEM_PROMPT,
          responseInstructions: DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS
        });
        rawOutput = result.output;
        summary = result.summary ?? null;
      } else {
        const result = await runCodexGeneration({
          mode: 'job-with-bundle',
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          systemPrompt: DEFAULT_AI_BUILDER_SYSTEM_PROMPT,
          responseInstructions: DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS
        });
        rawOutput = result.output;
        summary = result.summary ?? null;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to run AI generation';
      reply.status(502);
      await authResult.auth.log('failed', {
        reason: 'ai_generation_failed',
        jobSlug: job.slug,
        provider,
        message
      });
      request.log.error({ err, slug: job.slug, provider }, 'AI bundle edit generation failed');
      return { error: message };
    }

    const evaluation = evaluateAiBundleEditOutput(rawOutput);
    if (!evaluation.bundle || evaluation.errors.length > 0) {
      reply.status(422);
      await authResult.auth.log('failed', {
        reason: 'ai_bundle_validation_failed',
        jobSlug: job.slug,
        errors: evaluation.errors
      });
      return { error: evaluation.errors.join('\n') || 'AI response did not include a valid bundle' };
    }

    const resolvedVersion = await findNextVersion(binding.slug, binding.version);
    const suggestion: AiGeneratedBundleSuggestion = {
      ...evaluation.bundle,
      slug: binding.slug,
      version: resolvedVersion
    };

    try {
      const publishResult = await publishGeneratedBundle(suggestion, {
        subject: authResult.auth.identity.subject,
        kind: authResult.auth.identity.kind,
        tokenHash: authResult.auth.identity.tokenHash
      });

      const metadataState = extractMetadata(job);
      const storedSuggestion: AiGeneratedBundleSuggestion = {
        ...suggestion,
        slug: publishResult.version.slug,
        version: publishResult.version.version
      };

      const nowIso = new Date().toISOString();
      const truncatedOutput = rawOutput.length > 20_000 ? `${rawOutput.slice(0, 20_000)}…` : rawOutput;

      metadataState.aiBuilder.bundle = cloneSuggestion(storedSuggestion);
      metadataState.aiBuilder.prompt = operatorRequest;
      metadataState.aiBuilder.additionalNotes = additionalNotes;
      metadataState.aiBuilder.metadataSummary = metadataSummary;
      metadataState.aiBuilder.rawOutput = truncatedOutput;
      metadataState.aiBuilder.summary = summary ?? null;
      metadataState.aiBuilder.stdout = '';
      metadataState.aiBuilder.stderr = '';
      metadataState.aiBuilder.lastRegeneratedAt = nowIso;
      metadataState.aiBuilder.history = [
        ...(metadataState.aiBuilder.history ?? []),
        {
          slug: publishResult.version.slug,
          version: publishResult.version.version,
          checksum: publishResult.version.checksum,
          regeneratedAt: nowIso
        }
      ];
      metadataState.aiBuilder.source = 'ai-edit';
      metadataState.root.aiBuilder = metadataState.aiBuilder;

      const exportSuffix = binding.exportName ? `#${binding.exportName}` : '';
      const nextEntryPoint = `bundle:${publishResult.version.slug}@${publishResult.version.version}${exportSuffix}`;
      const updatedJob = await upsertJobDefinition({
        slug: job.slug,
        name: job.name,
        type: job.type,
        version: job.version,
        runtime: job.runtime,
        entryPoint: nextEntryPoint,
        timeoutMs: job.timeoutMs ?? undefined,
        retryPolicy: job.retryPolicy ?? undefined,
        parametersSchema: job.parametersSchema ?? undefined,
        defaultParameters: job.defaultParameters ?? undefined,
        outputSchema: job.outputSchema ?? undefined,
        metadata: metadataState.root as JsonValue
      });
      job = updatedJob;

      const refreshed = await loadBundleEditorSnapshot(updatedJob);
      if (!refreshed) {
        throw new Error('Failed to refresh bundle editor snapshot');
      }

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'jobs.bundle-ai-edit',
        jobSlug: job.slug,
        bundleSlug: publishResult.version.slug,
        bundleVersion: publishResult.version.version
      });
      return { data: toEditorResponse(updatedJob, refreshed) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish AI-generated bundle';
      const isDuplicate = err instanceof Error && /already exists/i.test(err.message);
      const isInvalid = err instanceof Error && /invalid bundle file path/i.test(err.message);
      const statusCode = isInvalid ? 400 : isDuplicate ? 409 : 500;
      reply.status(statusCode);
      await authResult.auth.log('failed', {
        reason: isInvalid ? 'invalid_bundle_payload' : isDuplicate ? 'duplicate_bundle_version' : 'exception',
        jobSlug: job.slug,
        message
      });
      request.log.error({ err, slug: job.slug }, 'Failed to publish AI-edited bundle');
      return { error: statusCode === 500 ? 'Failed to publish AI-generated bundle' : message };
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
        details: parseParams.error.flatten(),
        jobSlug: candidateSlug
      });
      return { error: parseParams.error.flatten() };
    }

    const parseBody = bundleRegenerateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', {
        reason: 'invalid_payload',
        details: parseBody.error.flatten(),
        jobSlug: parseParams.data.slug
      });
      return { error: parseBody.error.flatten() };
    }

    let job = await getJobDefinitionBySlug(parseParams.data.slug);
    if (!job) {
      reply.status(404);
      await authResult.auth.log('failed', {
        reason: 'job_not_found',
        jobSlug: parseParams.data.slug
      });
      return { error: 'job not found' };
    }

    const binding = parseBundleEntryPoint(job.entryPoint);
    if (!binding) {
      reply.status(409);
      await authResult.auth.log('failed', {
        reason: 'job_bundle_binding_missing',
        jobSlug: job.slug
      });
      return { error: 'job is not bound to a bundle entry point' };
    }

    const payload: BundleRegeneratePayload = parseBody.data;
    const versionInput = typeof payload.version === 'string' ? payload.version.trim() : '';
    const resolvedVersion = versionInput || (await findNextVersion(binding.slug, binding.version));
    const files = payload.files.map((file) => {
      const encoding: AiGeneratedBundleFile['encoding'] =
        file.encoding === 'base64' ? 'base64' : 'utf8';
      return {
        path: file.path.trim(),
        contents: file.contents,
        encoding,
        executable: file.executable ? true : undefined
      };
    });

    const suggestion: AiGeneratedBundleSuggestion = {
      slug: binding.slug,
      version: resolvedVersion,
      entryPoint: payload.entryPoint.trim(),
      manifest: payload.manifest ?? {},
      manifestPath: payload.manifestPath.trim(),
      capabilityFlags: normalizeCapabilityFlagInput(payload.capabilityFlags),
      metadata: payload.metadata ?? null,
      description: payload.description ?? null,
      displayName: payload.displayName ?? null,
      files
    };

    try {
      const publishResult = await publishGeneratedBundle(suggestion, {
        subject: authResult.auth.identity.subject,
        kind: authResult.auth.identity.kind,
        tokenHash: authResult.auth.identity.tokenHash
      });

      const metadataState = extractMetadata(job);
      const storedSuggestion: AiGeneratedBundleSuggestion = {
        ...suggestion,
        slug: publishResult.version.slug,
        version: publishResult.version.version
      };
      metadataState.aiBuilder.bundle = cloneSuggestion(storedSuggestion);
      metadataState.aiBuilder.lastRegeneratedAt = new Date().toISOString();
      metadataState.aiBuilder.history = [
        ...(metadataState.aiBuilder.history ?? []),
        {
          slug: publishResult.version.slug,
          version: publishResult.version.version,
          checksum: publishResult.version.checksum,
          regeneratedAt: metadataState.aiBuilder.lastRegeneratedAt
        }
      ];
      metadataState.aiBuilder.source = metadataState.aiBuilder.source ?? 'regenerated';
      metadataState.root.aiBuilder = metadataState.aiBuilder;

      const exportSuffix = binding.exportName ? `#${binding.exportName}` : '';
      const nextEntryPoint = `bundle:${publishResult.version.slug}@${publishResult.version.version}${exportSuffix}`;
      const updatedJob = await upsertJobDefinition({
        slug: job.slug,
        name: job.name,
        type: job.type,
        version: job.version,
        runtime: job.runtime,
        entryPoint: nextEntryPoint,
        timeoutMs: job.timeoutMs ?? undefined,
        retryPolicy: job.retryPolicy ?? undefined,
        parametersSchema: job.parametersSchema ?? undefined,
        defaultParameters: job.defaultParameters ?? undefined,
        outputSchema: job.outputSchema ?? undefined,
        metadata: metadataState.root as JsonValue
      });
      job = updatedJob;

      const snapshot = await loadBundleEditorSnapshot(updatedJob);
      if (!snapshot) {
        throw new Error('Failed to refresh bundle editor snapshot');
      }

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'jobs.bundle-regenerate',
        jobSlug: job.slug,
        bundleSlug: publishResult.version.slug,
        bundleVersion: publishResult.version.version
      });
      return { data: toEditorResponse(updatedJob, snapshot) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate job bundle';
      const isDuplicate = err instanceof Error && /already exists/i.test(err.message);
      const isInvalid = err instanceof Error && /invalid bundle file path/i.test(err.message);
      const statusCode = isInvalid ? 400 : isDuplicate ? 409 : 500;
      reply.status(statusCode);
      await authResult.auth.log('failed', {
        reason: isInvalid ? 'invalid_bundle_payload' : isDuplicate ? 'duplicate_bundle_version' : 'exception',
        jobSlug: job.slug,
        message
      });
      request.log.error({ err, slug: job.slug }, 'Failed to regenerate job bundle');
      return { error: statusCode === 500 ? 'Failed to regenerate bundle' : message };
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
