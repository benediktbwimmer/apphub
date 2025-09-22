import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listJobDefinitions,
  listServices,
  listWorkflowDefinitions,
  createJobDefinition,
  type JobDefinitionRecord,
  type ServiceRecord,
  type WorkflowDefinitionRecord
} from '../db/index';
import {
  fetchCodexGenerationJobStatus,
  runCodexGeneration,
  startCodexGenerationJob,
  type CodexGenerationMode
} from '../ai/codexRunner';
import { buildCodexContextFiles } from '../ai/contextFiles';
import { publishGeneratedBundle, type AiGeneratedBundleSuggestion } from '../ai/bundlePublisher';
import {
  serializeJobBundle,
  serializeJobBundleVersion,
  serializeJobDefinition,
  serializeService,
  serializeWorkflowDefinition,
  type JsonValue
} from './shared/serializers';
import { requireOperatorScopes } from './shared/operatorAuth';
import { JOB_BUNDLE_WRITE_SCOPES, JOB_WRITE_SCOPES } from './shared/scopes';
import {
  aiBundleSuggestionSchema,
  aiJobWithBundleOutputSchema,
  jobDefinitionCreateSchema,
  workflowDefinitionCreateSchema
} from '../workflows/zodSchemas';

const aiBuilderSuggestSchema = z
  .object({
    mode: z.enum(['workflow', 'job', 'job-with-bundle']),
    prompt: z.string().min(1).max(2_000),
    additionalNotes: z.string().max(2_000).optional()
  })
  .strict();

const aiBuilderJobGenerationSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.string().min(1).optional(),
    additionalNotes: z.string().max(2_000).optional(),
    metadataSummary: z.string().optional(),
    rawOutput: z.string().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
    summary: z.string().optional()
  })
  .strict();

const aiBuilderJobCreateSchema = z
  .object({
    job: jobDefinitionCreateSchema,
    bundle: aiBundleSuggestionSchema,
    generation: aiBuilderJobGenerationSchema.optional()
  })
  .strict();

type WorkflowCreatePayload = z.infer<typeof workflowDefinitionCreateSchema>;
type JobCreatePayload = z.infer<typeof jobDefinitionCreateSchema>;

type AiSuggestionPayload = {
  mode: CodexGenerationMode;
  raw: string;
  suggestion: WorkflowCreatePayload | JobCreatePayload | null;
  validation: {
    valid: boolean;
    errors: string[];
  };
  stdout: string;
  stderr: string;
  metadataSummary: string;
  bundle?: AiGeneratedBundleSuggestion | null;
  bundleValidation?: {
    valid: boolean;
    errors: string[];
  };
  summary?: string | null;
};

type CodexEvaluationResult = {
  suggestion: WorkflowCreatePayload | JobCreatePayload | null;
  validationErrors: string[];
  bundleSuggestion: AiGeneratedBundleSuggestion | null;
  bundleValidationErrors: string[];
};

type AiGenerationSessionStatus = 'running' | 'succeeded' | 'failed';

type AiGenerationSession = {
  id: string;
  proxyJobId: string | null;
  mode: CodexGenerationMode;
  metadataSummary: string;
  operatorRequest: string;
  additionalNotes?: string;
  status: AiGenerationSessionStatus;
  stdout: string;
  stderr: string;
  summary: string | null;
  rawOutput: string | null;
  result: AiSuggestionPayload | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
};

const AI_GENERATION_SESSION_TTL_MS = 60 * 60 * 1_000; // 1 hour
const aiGenerationSessions = new Map<string, AiGenerationSession>();

function summarizeJobs(jobs: JobDefinitionRecord[], limit = 12): string {
  if (jobs.length === 0) {
    return '- none registered';
  }
  return jobs
    .slice(0, limit)
    .map((job) => {
      const timeout = job.timeoutMs ? `${job.timeoutMs}ms` : 'default';
      return `- ${job.slug} (type: ${job.type}, v${job.version}, entry: ${job.entryPoint}, timeout: ${timeout})`;
    })
    .join('\n');
}

function summarizeServices(services: ServiceRecord[], limit = 12): string {
  if (services.length === 0) {
    return '- none registered';
  }
  return services
    .slice(0, limit)
    .map((service) => {
      const status = service.status ?? 'unknown';
      return `- ${service.slug} (${service.displayName}) — ${status}`;
    })
    .join('\n');
}

function summarizeWorkflows(workflows: WorkflowDefinitionRecord[], limit = 8): string {
  if (workflows.length === 0) {
    return '- none registered';
  }
  return workflows
    .slice(0, limit)
    .map((workflow) => {
      const stepCount = workflow.steps?.length ?? 0;
      return `- ${workflow.slug} (v${workflow.version}, steps: ${stepCount}, name: ${workflow.name})`;
    })
    .join('\n');
}

function buildAiMetadataSummary(data: {
  jobs: Awaited<ReturnType<typeof listJobDefinitions>>;
  services: Awaited<ReturnType<typeof listServices>>;
  workflows: Awaited<ReturnType<typeof listWorkflowDefinitions>>;
}): string {
  const lines: string[] = [];
  lines.push('## Jobs');
  lines.push(summarizeJobs(data.jobs));
  if (data.jobs.length > 12) {
    lines.push(`- … ${data.jobs.length - 12} more jobs omitted`);
  }
  lines.push('');
  lines.push('## Services');
  lines.push(summarizeServices(data.services));
  if (data.services.length > 12) {
    lines.push(`- … ${data.services.length - 12} more services omitted`);
  }
  lines.push('');
  lines.push('## Workflows');
  lines.push(summarizeWorkflows(data.workflows));
  if (data.workflows.length > 8) {
    lines.push(`- … ${data.workflows.length - 8} more workflows omitted`);
  }
  return lines.join('\n');
}

function truncate(value: string, limit = 4_000): string {
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}…`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function evaluateCodexOutput(mode: CodexGenerationMode, raw: string): CodexEvaluationResult {
  const validationErrors: string[] = [];
  const bundleValidationErrors: string[] = [];
  let suggestion: WorkflowCreatePayload | JobCreatePayload | null = null;
  let bundleSuggestion: AiGeneratedBundleSuggestion | null = null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    validationErrors.push(`Failed to parse JSON output: ${message}`);
    return { suggestion, validationErrors, bundleSuggestion, bundleValidationErrors };
  }

  if (mode === 'job-with-bundle') {
    const validation = aiJobWithBundleOutputSchema.safeParse(parsed);
    if (validation.success) {
      suggestion = validation.data.job;
      bundleSuggestion = validation.data.bundle;
      if (!validation.data.bundle.files.some((file) => file.path === validation.data.bundle.entryPoint)) {
        bundleValidationErrors.push(`Bundle is missing entry point file: ${validation.data.bundle.entryPoint}`);
      }
    } else {
      for (const issue of validation.error.errors) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        validationErrors.push(`${path}: ${issue.message}`);
      }
    }
  } else {
    const schema = mode === 'workflow' ? workflowDefinitionCreateSchema : jobDefinitionCreateSchema;
    const validation = schema.safeParse(parsed);
    if (validation.success) {
      suggestion = validation.data as WorkflowCreatePayload | JobCreatePayload;
    } else {
      for (const issue of validation.error.errors) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        validationErrors.push(`${path}: ${issue.message}`);
      }
    }
  }

  return { suggestion, validationErrors, bundleSuggestion, bundleValidationErrors };
}

function pruneAiGenerationSessions(now: number = Date.now()): void {
  if (AI_GENERATION_SESSION_TTL_MS <= 0) {
    return;
  }
  for (const [id, session] of aiGenerationSessions) {
    if (session.completedAt && now - session.completedAt > AI_GENERATION_SESSION_TTL_MS) {
      aiGenerationSessions.delete(id);
    }
  }
}

function createAiGenerationSession(init: {
  proxyJobId: string | null;
  mode: CodexGenerationMode;
  metadataSummary: string;
  operatorRequest: string;
  additionalNotes?: string;
  status?: AiGenerationSessionStatus;
  stdout?: string;
  stderr?: string;
  summary?: string | null;
  rawOutput?: string | null;
  result?: AiSuggestionPayload | null;
  error?: string | null;
  completedAt?: number;
}): AiGenerationSession {
  const now = Date.now();
  const session: AiGenerationSession = {
    id: randomUUID(),
    proxyJobId: init.proxyJobId,
    mode: init.mode,
    metadataSummary: init.metadataSummary,
    operatorRequest: init.operatorRequest,
    additionalNotes: init.additionalNotes,
    status: init.status ?? 'running',
    stdout: init.stdout ?? '',
    stderr: init.stderr ?? '',
    summary: init.summary ?? null,
    rawOutput: init.rawOutput ?? null,
    result: init.result ?? null,
    error: init.error ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: init.completedAt
  };
  aiGenerationSessions.set(session.id, session);
  return session;
}

function getAiGenerationSession(id: string): AiGenerationSession | undefined {
  return aiGenerationSessions.get(id);
}

type AiGenerationResponsePayload = {
  generationId: string;
  status: AiGenerationSessionStatus;
  mode: CodexGenerationMode;
  metadataSummary: string;
  stdout: string;
  stderr: string;
  summary: string | null;
  result: AiSuggestionPayload | null;
  error: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
};

function buildAiGenerationResponse(session: AiGenerationSession): AiGenerationResponsePayload {
  return {
    generationId: session.id,
    status: session.status,
    mode: session.mode,
    metadataSummary: session.metadataSummary,
    stdout: session.stdout,
    stderr: session.stderr,
    summary: session.summary,
    result: session.result,
    error: session.error,
    startedAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : undefined
  };
}

function mergeMapMetadata(base: Record<string, JsonValue>, patch: Record<string, JsonValue | undefined>) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    base[key] = value ?? null;
  }
}

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  app.post('/ai/builder/generations', async (request, reply) => {
    pruneAiGenerationSessions();

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'ai.builder.generation.start',
      resource: 'ai-builder',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const identity = authResult.auth.identity;
    const hasWorkflowScope = identity.scopes.has('workflows:write');
    const hasJobScope = identity.scopes.has('jobs:write');
    if (!hasWorkflowScope && !hasJobScope) {
      reply.status(403);
      await authResult.auth.log('failed', { reason: 'insufficient_scope' });
      return { error: 'forbidden' };
    }

    const parseBody = aiBuilderSuggestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const mode = payload.mode as CodexGenerationMode;
    const operatorRequest = payload.prompt.trim();
    const additionalNotes = payload.additionalNotes?.trim() || undefined;

    try {
      const [jobs, services, workflows] = await Promise.all([
        listJobDefinitions(),
        listServices(),
        listWorkflowDefinitions()
      ]);

      const jobCatalog = jobs.map(serializeJobDefinition);
      const serviceCatalog = services.map(serializeService);
      const workflowCatalog = workflows.map(serializeWorkflowDefinition);
      const metadataSummary = buildAiMetadataSummary({ jobs, services, workflows });
      const contextFiles = buildCodexContextFiles({
        mode,
        jobs: jobCatalog,
        services: serviceCatalog,
        workflows: workflowCatalog
      });

      if (process.env.APPHUB_CODEX_MOCK_DIR) {
        const codexResult = await runCodexGeneration({
          mode,
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles
        });

        const evaluation = evaluateCodexOutput(mode, codexResult.output);
        const evaluationValid =
          evaluation.suggestion !== null &&
          evaluation.validationErrors.length === 0 &&
          (mode !== 'job-with-bundle'
            ? true
            : evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0);

        const session = createAiGenerationSession({
          proxyJobId: null,
          mode,
          metadataSummary,
          operatorRequest,
          additionalNotes,
          status: evaluationValid ? 'succeeded' : 'failed',
          stdout: truncate(codexResult.stdout),
          stderr: truncate(codexResult.stderr),
          summary: codexResult.summary ?? null,
          rawOutput: truncate(codexResult.output),
          result: {
            mode,
            raw: codexResult.output,
            suggestion: evaluation.suggestion,
            validation: {
              valid: evaluationValid,
              errors: evaluation.validationErrors
            },
            stdout: truncate(codexResult.stdout),
            stderr: truncate(codexResult.stderr),
            metadataSummary,
            bundle: evaluation.bundleSuggestion,
            bundleValidation: {
              valid: evaluation.bundleValidationErrors.length === 0,
              errors: evaluation.bundleValidationErrors
            },
            summary: codexResult.summary ?? null
          },
          error: evaluation.validationErrors.join('\n') || null,
          completedAt: Date.now()
        });

        reply.status(201);
        await authResult.auth.log('succeeded', {
          mode,
          sessionId: session.id,
          metadataSummaryLength: metadataSummary.length
        });
        return { data: buildAiGenerationResponse(session) };
      }

      const proxyJob = await startCodexGenerationJob({
        mode,
        operatorRequest,
        metadataSummary,
        additionalNotes,
        contextFiles
      });

      const session = createAiGenerationSession({
        proxyJobId: proxyJob.jobId,
        mode,
        metadataSummary,
        operatorRequest,
        additionalNotes,
        status: 'running',
        stdout: '',
        stderr: '',
        summary: null,
        rawOutput: null,
        result: null,
        error: null
      });

      reply.status(202);
      await authResult.auth.log('succeeded', {
        mode,
        sessionId: session.id,
        proxyJobId: proxyJob.jobId
      });
      return { data: buildAiGenerationResponse(session) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start AI generation';
      request.log.error({ err }, 'Failed to start Codex generation');
      reply.status(502);
      await authResult.auth.log('failed', { reason: 'codex_start_failure', message });
      return { error: message };
    }
  });

  app.get('/ai/builder/generations/:generationId', async (request, reply) => {
    pruneAiGenerationSessions();

    const authResult = await requireOperatorScopes(request, reply, {
      action: 'ai.builder.generation.read',
      resource: 'ai-builder',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const paramsSchema = z.object({ generationId: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const session = getAiGenerationSession(parseParams.data.generationId);
    if (!session) {
      reply.status(404);
      return { error: 'generation not found' };
    }

    if (session.proxyJobId && session.status === 'running') {
      try {
        const status = await fetchCodexGenerationJobStatus(session.proxyJobId);
        session.stdout = truncate(status.stdout ?? '');
        session.stderr = truncate(status.stderr ?? '');
        session.summary = status.summary ?? session.summary;
        session.updatedAt = Date.now();

        if (status.status === 'succeeded') {
          if (!status.output) {
            session.status = 'failed';
            session.error = 'Codex job completed without output';
            session.completedAt = Date.now();
            session.updatedAt = session.completedAt;
            await authResult.auth.log('failed', {
              reason: 'codex_failure',
              message: session.error,
              proxyJobId: session.proxyJobId
            });
          } else {
            const evaluation = evaluateCodexOutput(session.mode, status.output);
            const evaluationValid =
              evaluation.suggestion !== null &&
              evaluation.validationErrors.length === 0 &&
              (session.mode !== 'job-with-bundle'
                ? true
                : evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0);

            session.status = 'succeeded';
            session.rawOutput = status.output;
            session.result = {
              mode: session.mode,
              raw: status.output,
              suggestion: evaluation.suggestion,
              validation: {
                valid: evaluationValid,
                errors: evaluation.validationErrors
              },
              stdout: truncate(status.stdout ?? ''),
              stderr: truncate(status.stderr ?? ''),
              metadataSummary: session.metadataSummary,
              bundle: evaluation.bundleSuggestion,
              bundleValidation: {
                valid: evaluation.bundleValidationErrors.length === 0,
                errors: evaluation.bundleValidationErrors
              },
              summary: status.summary ?? null
            };
            session.error = null;
            session.completedAt = Date.now();
            session.updatedAt = session.completedAt;

            await authResult.auth.log('succeeded', {
              mode: session.mode,
              event: 'generation-completed',
              valid: evaluationValid,
              issueCount: evaluation.validationErrors.length,
              proxyJobId: session.proxyJobId
            });
          }
        } else if (status.status === 'failed') {
          session.status = 'failed';
          session.error = status.error ?? 'Codex job failed';
          session.completedAt = Date.now();
          session.updatedAt = session.completedAt;
          await authResult.auth.log('failed', {
            reason: 'codex_failure',
            message: session.error,
            proxyJobId: session.proxyJobId
          });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        session.status = 'failed';
        session.error = message;
        session.completedAt = Date.now();
        session.updatedAt = session.completedAt;
        await authResult.auth.log('failed', {
          reason: 'codex_status_error',
          message,
          proxyJobId: session.proxyJobId ?? undefined
        });
        request.log.error({ err, generationId: session.id }, 'Failed to refresh Codex generation status');
      }
    }

    const currentSession = getAiGenerationSession(session.id);
    if (!currentSession) {
      reply.status(404);
      return { error: 'generation not found' };
    }

    reply.status(200);
    return { data: buildAiGenerationResponse(currentSession) };
  });

  app.post('/ai/builder/suggest', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'ai.builder.suggest',
      resource: 'ai-builder',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const identity = authResult.auth.identity;
    const hasWorkflowScope = identity.scopes.has('workflows:write');
    const hasJobScope = identity.scopes.has('jobs:write');
    if (!hasWorkflowScope && !hasJobScope) {
      reply.status(403);
      await authResult.auth.log('failed', { reason: 'insufficient_scope' });
      return { error: 'forbidden' };
    }

    const parseBody = aiBuilderSuggestSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const mode = payload.mode as CodexGenerationMode;

    try {
      const [jobs, services, workflows] = await Promise.all([
        listJobDefinitions(),
        listServices(),
        listWorkflowDefinitions()
      ]);

      const jobCatalog = jobs.map(serializeJobDefinition);
      const serviceCatalog = services.map(serializeService);
      const workflowCatalog = workflows.map(serializeWorkflowDefinition);
      const metadataSummary = buildAiMetadataSummary({ jobs, services, workflows });
      const contextFiles = buildCodexContextFiles({
        mode,
        jobs: jobCatalog,
        services: serviceCatalog,
        workflows: workflowCatalog
      });

      const codexResult = await runCodexGeneration({
        mode,
        operatorRequest: payload.prompt,
        metadataSummary,
        additionalNotes: payload.additionalNotes ?? undefined,
        contextFiles
      });

      const evaluation = evaluateCodexOutput(mode, codexResult.output);

      const valid =
        evaluation.suggestion !== null &&
        evaluation.validationErrors.length === 0 &&
        (mode !== 'job-with-bundle'
          ? true
          : evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0);

      await authResult.auth.log('succeeded', {
        mode,
        valid,
        issueCount: evaluation.validationErrors.length
      });

      reply.status(200);
      return {
        data: {
          mode,
          raw: codexResult.output,
          suggestion: evaluation.suggestion ?? null,
          validation: {
            valid,
            errors: evaluation.validationErrors
          },
          bundle: evaluation.bundleSuggestion,
          bundleValidation: {
            valid: evaluation.bundleValidationErrors.length === 0,
            errors: evaluation.bundleValidationErrors
          },
          stdout: truncate(codexResult.stdout),
          stderr: truncate(codexResult.stderr),
          metadataSummary,
          summary: codexResult.summary ?? null
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate AI suggestion';
      reply.status(502);
      await authResult.auth.log('failed', { reason: 'codex_failure', message });
      return { error: message };
    }
  });

  app.post('/ai/builder/jobs', async (request, reply) => {
    const requiredScopes = Array.from(new Set([...JOB_WRITE_SCOPES, ...JOB_BUNDLE_WRITE_SCOPES]));
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'ai.builder.job-create',
      resource: 'ai-builder',
      requiredScopes
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseBody = aiBuilderJobCreateSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      await authResult.auth.log('failed', { reason: 'invalid_payload', details: parseBody.error.flatten() });
      return { error: parseBody.error.flatten() };
    }

    const { job: jobInput, bundle, generation } = parseBody.data;

    const generationSession = generation?.id ? getAiGenerationSession(generation.id) : undefined;
    const prompt = generationSession?.operatorRequest ?? generation?.prompt ?? undefined;
    const additionalNotes = generationSession?.additionalNotes ?? generation?.additionalNotes ?? undefined;
    const metadataSummary = generationSession?.metadataSummary ?? generation?.metadataSummary ?? undefined;
    const rawOutput = generationSession?.rawOutput ?? generation?.rawOutput ?? undefined;
    const stdout = generationSession?.stdout ?? generation?.stdout ?? undefined;
    const stderr = generationSession?.stderr ?? generation?.stderr ?? undefined;
    const summary = generationSession?.summary ?? generation?.summary ?? undefined;

    const bundleEntryPoint = `bundle:${bundle.slug}@${bundle.version}`;

    const baseMetadata = isPlainObject(jobInput.metadata)
      ? (JSON.parse(JSON.stringify(jobInput.metadata)) as Record<string, JsonValue>)
      : {};
    const serializedBundle = JSON.parse(JSON.stringify(bundle)) as JsonValue;
    const aiBuilderMetadata: Record<string, JsonValue> = {
      source: 'ai-builder',
      storedAt: new Date().toISOString(),
      bundle: serializedBundle,
      generationId: generation?.id ?? null
    };
    mergeMapMetadata(aiBuilderMetadata, {
      prompt: prompt ?? undefined,
      additionalNotes: additionalNotes ?? undefined,
      metadataSummary: metadataSummary ?? undefined,
      rawOutput: rawOutput ?? undefined,
      stdout: stdout ?? undefined,
      stderr: stderr ?? undefined,
      summary: summary ?? undefined
    });

    const combinedMetadata = {
      ...baseMetadata,
      aiBuilder: aiBuilderMetadata as JsonValue
    } as Record<string, JsonValue>;

    const normalizedJobInput = {
      ...jobInput,
      entryPoint: bundleEntryPoint,
      metadata: combinedMetadata as JsonValue
    } satisfies z.infer<typeof jobDefinitionCreateSchema>;

    try {
      const bundleResult = await publishGeneratedBundle(bundle, {
        subject: authResult.auth.identity.subject,
        kind: authResult.auth.identity.kind,
        tokenHash: authResult.auth.identity.tokenHash
      });

      const definition = await createJobDefinition({
        slug: normalizedJobInput.slug,
        name: normalizedJobInput.name,
        type: normalizedJobInput.type,
        entryPoint: normalizedJobInput.entryPoint,
        version: normalizedJobInput.version,
        timeoutMs: normalizedJobInput.timeoutMs ?? null,
        retryPolicy: normalizedJobInput.retryPolicy ?? null,
        parametersSchema: normalizedJobInput.parametersSchema ?? {},
        defaultParameters: normalizedJobInput.defaultParameters ?? {},
        metadata: normalizedJobInput.metadata ?? null
      });

      reply.status(201);
      await authResult.auth.log('succeeded', {
        action: 'ai.builder.job-created',
        jobSlug: definition.slug,
        bundleSlug: bundleResult.bundle.slug,
        bundleVersion: bundleResult.version.version
      });
      return {
        data: {
          job: serializeJobDefinition(definition),
          bundle: serializeJobBundle(bundleResult.bundle),
          version: serializeJobBundleVersion(bundleResult.version, {
            includeManifest: true,
            download: bundleResult.download
          })
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create AI-generated job';
      request.log.error({ err, jobSlug: jobInput.slug, bundleSlug: bundle.slug }, 'Failed to create AI-generated job');
      const isConflict = err instanceof Error && /already exists/i.test(err.message);
      const statusCode = isConflict ? 409 : 500;
      reply.status(statusCode);
      await authResult.auth.log('failed', {
        reason: isConflict ? 'duplicate' : 'exception',
        message,
        jobSlug: jobInput.slug,
        bundleSlug: bundle.slug
      });
      return { error: statusCode === 500 ? 'Failed to create job' : message };
    }
  });
}
