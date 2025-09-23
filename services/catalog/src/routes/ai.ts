import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
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
  type CodexGenerationMode,
  type CodexContextFile
} from '../ai/codexRunner';
import { buildCodexContextFiles } from '../ai/contextFiles';
import { collectBundleContexts, type AiBundleContext } from '../ai/bundleContext';
import { runOpenAiGeneration, buildOpenAiPromptMessages } from '../ai/openAiRunner';
import { runOpenRouterGeneration } from '../ai/openRouterRunner';
import { publishGeneratedBundle, type AiGeneratedBundleSuggestion } from '../ai/bundlePublisher';
import { estimateTokenBreakdown, estimateTokenCount } from '../ai/tokenCounter';
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
  aiWorkflowWithJobsOutputSchema,
  jobDefinitionCreateSchema,
  workflowDefinitionCreateSchema,
  type AiWorkflowDependency,
  type AiWorkflowWithJobsOutput
} from '../workflows/zodSchemas';

type AiBuilderProvider = 'codex' | 'openai' | 'openrouter';

const aiBuilderProviderSchema = z.enum(['codex', 'openai', 'openrouter']);

const aiBuilderProviderOptionsSchema = z
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

const aiBuilderPromptOverridesSchema = z
  .object({
    systemPrompt: z.string().trim().min(1).max(6_000).optional(),
    responseInstructions: z.string().trim().min(1).max(2_000).optional()
  })
  .partial()
  .strict();

const aiBuilderSuggestSchema = z
  .object({
    mode: z.enum(['workflow', 'job', 'job-with-bundle', 'workflow-with-jobs']),
    prompt: z.string().min(1).max(2_000),
    additionalNotes: z.string().max(2_000).optional(),
    provider: aiBuilderProviderSchema.optional(),
    providerOptions: aiBuilderProviderOptionsSchema.optional(),
    promptOverrides: aiBuilderPromptOverridesSchema.optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const provider: AiBuilderProvider = value.provider ?? 'codex';
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

const aiBuilderContextQuerySchema = z
  .object({
    provider: aiBuilderProviderSchema.optional(),
    mode: z.enum(['workflow', 'job', 'job-with-bundle', 'workflow-with-jobs']).optional(),
    prompt: z.string().max(2_000).optional(),
    additionalNotes: z.string().max(2_000).optional(),
    systemPrompt: z.string().max(6_000).optional(),
    responseInstructions: z.string().max(2_000).optional()
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
    summary: z.string().optional(),
    provider: aiBuilderProviderSchema.optional()
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

type AiBuilderJobSuggestionPayload = {
  job: JobCreatePayload;
  bundle: AiGeneratedBundleSuggestion;
  bundleValidation: {
    valid: boolean;
    errors: string[];
  };
};

type AiWorkflowPlanPayload = AiWorkflowWithJobsOutput & {
  dependencies: AiWorkflowDependency[];
};

type AiContextMessagePreview = {
  role: 'system' | 'user';
  content: string;
  tokens: number | null;
};

type AiContextFilePreview = {
  path: string;
  contents: string;
  bytes: number;
  tokens: number | null;
};

type AiContextPreview = {
  provider: AiBuilderProvider;
  tokenCount: number | null;
  messages: AiContextMessagePreview[];
  contextFiles: AiContextFilePreview[];
};

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
  jobSuggestions?: AiBuilderJobSuggestionPayload[];
  plan?: AiWorkflowPlanPayload | null;
  notes?: string | null;
  summary?: string | null;
  contextPreview: AiContextPreview;
};

type CodexEvaluationResult = {
  suggestion: WorkflowCreatePayload | JobCreatePayload | null;
  validationErrors: string[];
  bundleSuggestion: AiGeneratedBundleSuggestion | null;
  bundleValidationErrors: string[];
  workflowPlan: AiWorkflowWithJobsOutput | null;
};

type AiGenerationSessionStatus = 'running' | 'succeeded' | 'failed';

type AiGenerationSession = {
  id: string;
  proxyJobId: string | null;
  provider: AiBuilderProvider;
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
  contextPreview: AiContextPreview;
};

const AI_GENERATION_SESSION_TTL_MS = 60 * 60 * 1_000; // 1 hour
const OPENAI_DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
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

function summarizeBundles(bundles: ReadonlyArray<AiBundleContext>, limit = 10): string {
  if (bundles.length === 0) {
    return '- none referenced by jobs';
  }
  return bundles
    .slice(0, limit)
    .map((bundle) => {
      const capabilities = bundle.capabilityFlags.length > 0 ? bundle.capabilityFlags.join(', ') : 'none';
      const jobList = bundle.jobSlugs.length > 0 ? bundle.jobSlugs.join(', ') : 'unused';
      return `- ${bundle.slug}@${bundle.version} (entry: ${bundle.entryPoint}; capabilities: ${capabilities}; jobs: ${jobList})`;
    })
    .join('\n');
}

function buildContextPreview(options: {
  provider: AiBuilderProvider;
  mode: CodexGenerationMode;
  operatorRequest: string;
  additionalNotes?: string;
  metadataSummary: string;
  contextFiles: ReadonlyArray<CodexContextFile>;
  systemPrompt?: string;
  responseInstructions?: string;
}): AiContextPreview {
  const contextList = Array.from(options.contextFiles);
  const messages = buildOpenAiPromptMessages({
    mode: options.mode,
    operatorRequest: options.operatorRequest,
    metadataSummary: options.metadataSummary,
    additionalNotes: options.additionalNotes,
    contextFiles: contextList,
    systemPrompt: options.systemPrompt,
    responseInstructions: options.responseInstructions
  });

  const tokenEstimates = estimateTokenBreakdown(messages.map((message) => ({ content: message.content })));
  const messagePreviews: AiContextMessagePreview[] = messages.map((message, index) => ({
    role: message.role,
    content: message.content,
    tokens: tokenEstimates.perMessage[index] ?? null
  }));

  let contextTokenTotal = tokenEstimates.total ?? 0;
  let hasMessageTokenFailure = tokenEstimates.total === null;

  const filePreviews: AiContextFilePreview[] = contextList.map((file) => {
    const tokens = estimateTokenCount(file.contents) ?? null;
    if (tokens !== null && !hasMessageTokenFailure) {
      contextTokenTotal += tokens;
    } else if (tokens === null) {
      hasMessageTokenFailure = true;
    }
    return {
      path: file.path,
      contents: file.contents,
      bytes: Buffer.byteLength(file.contents, 'utf8'),
      tokens
    };
  });

  return {
    provider: options.provider,
    tokenCount: hasMessageTokenFailure ? null : contextTokenTotal,
    messages: messagePreviews,
    contextFiles: filePreviews
  } satisfies AiContextPreview;
}

function buildAiMetadataSummary(data: {
  jobs: Awaited<ReturnType<typeof listJobDefinitions>>;
  services: Awaited<ReturnType<typeof listServices>>;
  workflows: Awaited<ReturnType<typeof listWorkflowDefinitions>>;
  bundles?: ReadonlyArray<AiBundleContext>;
}): string {
  const lines: string[] = [];
  lines.push('## Jobs');
  lines.push(summarizeJobs(data.jobs));
  if (data.jobs.length > 12) {
    lines.push(`- … ${data.jobs.length - 12} more jobs omitted`);
  }
  const bundles = data.bundles ?? [];
  lines.push('');
  lines.push('## Bundles');
  lines.push(summarizeBundles(bundles));
  if (bundles.length > 10) {
    lines.push(`- … ${bundles.length - 10} more bundles omitted`);
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

function normalizeCapabilityList(candidate: unknown): string[] {
  const set = new Set<string>();
  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (trimmed.length === 0) {
        continue;
      }
      set.add(trimmed);
    }
    return Array.from(set);
  }
  if (typeof candidate === 'string') {
    return normalizeCapabilityList(candidate.split(','));
  }
  return [];
}

function extractManifestCapabilities(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return [];
  }
  const record = manifest as Record<string, unknown>;
  return normalizeCapabilityList(record.capabilities);
}

function evaluateCodexOutput(mode: CodexGenerationMode, raw: string): CodexEvaluationResult {
  const validationErrors: string[] = [];
  const bundleValidationErrors: string[] = [];
  let suggestion: WorkflowCreatePayload | JobCreatePayload | null = null;
  let bundleSuggestion: AiGeneratedBundleSuggestion | null = null;
  let workflowPlan: AiWorkflowWithJobsOutput | null = null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    validationErrors.push(`Failed to parse JSON output: ${message}`);
    return { suggestion, validationErrors, bundleSuggestion, bundleValidationErrors, workflowPlan };
  }

  if (mode === 'job-with-bundle') {
    const validation = aiJobWithBundleOutputSchema.safeParse(parsed);
    if (validation.success) {
      suggestion = validation.data.job;
      bundleSuggestion = validation.data.bundle;
      if (!validation.data.bundle.files.some((file) => file.path === validation.data.bundle.entryPoint)) {
        bundleValidationErrors.push(`Bundle is missing entry point file: ${validation.data.bundle.entryPoint}`);
      }
      const rawCapabilityFlags = validation.data.bundle.capabilityFlags;
      const capabilityFlags = normalizeCapabilityList(rawCapabilityFlags ?? []);
      if (bundleSuggestion) {
        bundleSuggestion.capabilityFlags = capabilityFlags;
      }
      if (!Array.isArray(rawCapabilityFlags)) {
        bundleValidationErrors.push('bundle.capabilityFlags must be provided as an array (include manifest capabilities even if none are required).');
      }
      const manifestCapabilities = extractManifestCapabilities(validation.data.bundle.manifest);
      const missingManifestCapabilities = manifestCapabilities.filter((cap) => !capabilityFlags.includes(cap));
      if (missingManifestCapabilities.length > 0) {
        bundleValidationErrors.push(
          `bundle.capabilityFlags must include manifest capabilities: missing ${missingManifestCapabilities.join(', ')}`
        );
      }
    } else {
      for (const issue of validation.error.errors) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        validationErrors.push(`${path}: ${issue.message}`);
      }
    }
  } else if (mode === 'workflow-with-jobs') {
    const validation = aiWorkflowWithJobsOutputSchema.safeParse(parsed);
    if (validation.success) {
      const payload: AiWorkflowWithJobsOutput = validation.data;
      suggestion = payload.workflow;
      workflowPlan = payload;
      for (const dependency of payload.dependencies ?? []) {
        if (dependency.kind !== 'job-with-bundle') {
          continue;
        }
        if (!dependency.bundleOutline) {
          validationErrors.push(
            `bundleOutline is required for job-with-bundle dependency "${dependency.jobSlug}" and must list capabilities.`
          );
          continue;
        }
        const outlineCapabilities = normalizeCapabilityList(dependency.bundleOutline.capabilities ?? []);
        if (outlineCapabilities.length === 0) {
          validationErrors.push(
            `bundleOutline.capabilities must include at least one capability for job-with-bundle dependency "${dependency.jobSlug}".`
          );
        }
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

  return { suggestion, validationErrors, bundleSuggestion, bundleValidationErrors, workflowPlan };
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
  provider: AiBuilderProvider;
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
  contextPreview: AiContextPreview;
}): AiGenerationSession {
  const now = Date.now();
  const session: AiGenerationSession = {
    id: randomUUID(),
    proxyJobId: init.proxyJobId,
    provider: init.provider,
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
    completedAt: init.completedAt,
    contextPreview: init.contextPreview
  };
  if (session.result && !session.result.contextPreview) {
    session.result.contextPreview = init.contextPreview;
  }
  aiGenerationSessions.set(session.id, session);
  return session;
}

function getAiGenerationSession(id: string): AiGenerationSession | undefined {
  return aiGenerationSessions.get(id);
}

type AiGenerationResponsePayload = {
  generationId: string;
  provider: AiBuilderProvider;
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
  contextPreview: AiContextPreview;
};

function buildAiGenerationResponse(session: AiGenerationSession): AiGenerationResponsePayload {
  return {
    generationId: session.id,
    provider: session.provider,
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
    completedAt: session.completedAt ? new Date(session.completedAt).toISOString() : undefined,
    contextPreview: session.contextPreview
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
  app.get('/ai/builder/context', async (request, reply) => {
    const authResult = await requireOperatorScopes(request, reply, {
      action: 'ai.builder.context.read',
      resource: 'ai-builder',
      requiredScopes: []
    });
    if (!authResult.ok) {
      return { error: authResult.error };
    }

    const parseQuery = aiBuilderContextQuerySchema.safeParse(request.query ?? {});
    if (!parseQuery.success) {
      reply.status(400);
      return { error: parseQuery.error.flatten() };
    }

    const query = parseQuery.data;
    const provider: AiBuilderProvider = query.provider ?? 'codex';
    const mode: CodexGenerationMode = query.mode ?? 'workflow';
    const operatorRequest = query.prompt?.trim() ?? '';
    const additionalNotes = query.additionalNotes?.trim() || undefined;
    const systemPrompt = query.systemPrompt?.trim() || undefined;
    const responseInstructions = query.responseInstructions?.trim() || undefined;

    try {
      const [jobs, services, workflows] = await Promise.all([
        listJobDefinitions(),
        listServices(),
        listWorkflowDefinitions()
      ]);

      const bundleContexts = await collectBundleContexts(jobs);
      const jobCatalog = jobs.map(serializeJobDefinition);
      const serviceCatalog = services.map(serializeService);
      const workflowCatalog = workflows.map(serializeWorkflowDefinition);
      const metadataSummary = buildAiMetadataSummary({ jobs, services, workflows, bundles: bundleContexts });
      const contextFiles = buildCodexContextFiles({
        mode,
        jobs: jobCatalog,
        services: serviceCatalog,
        workflows: workflowCatalog,
        bundles: bundleContexts
      });

      const contextPreview = buildContextPreview({
        provider,
        mode,
        operatorRequest,
        additionalNotes,
        metadataSummary,
        contextFiles,
        systemPrompt,
        responseInstructions
      });

      reply.status(200);
      return {
        data: {
          provider,
          mode,
          metadataSummary,
          contextPreview
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load AI context';
      request.log.error({ err, provider, mode }, 'Failed to build AI context preview');
      reply.status(502);
      return { error: message };
    }
  });

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

      const bundleContexts = await collectBundleContexts(jobs);
      const jobCatalog = jobs.map(serializeJobDefinition);
      const serviceCatalog = services.map(serializeService);
      const workflowCatalog = workflows.map(serializeWorkflowDefinition);
      const metadataSummary = buildAiMetadataSummary({ jobs, services, workflows, bundles: bundleContexts });
      const contextFiles = buildCodexContextFiles({
        mode,
        jobs: jobCatalog,
        services: serviceCatalog,
        workflows: workflowCatalog,
        bundles: bundleContexts
      });

      const provider: AiBuilderProvider = payload.provider ?? 'codex';
      const providerOptions = payload.providerOptions ?? {};
      const promptOverrides = payload.promptOverrides ?? undefined;
      const systemPrompt = promptOverrides?.systemPrompt;
      const responseInstructions = promptOverrides?.responseInstructions;

      const contextPreview = buildContextPreview({
        provider,
        mode,
        operatorRequest,
        additionalNotes,
        metadataSummary,
        contextFiles,
        systemPrompt,
        responseInstructions
      });

      if (provider === 'openai') {
        const openAiApiKey = providerOptions.openAiApiKey?.trim();
        const openAiBaseUrl = providerOptions.openAiBaseUrl?.trim() || undefined;
        const openAiMaxOutputTokens =
          typeof providerOptions.openAiMaxOutputTokens === 'number' && Number.isFinite(providerOptions.openAiMaxOutputTokens)
            ? Math.min(Math.max(providerOptions.openAiMaxOutputTokens, 256), 32_000)
            : OPENAI_DEFAULT_MAX_OUTPUT_TOKENS;

      if (!openAiApiKey) {
        reply.status(400);
        await authResult.auth.log('failed', {
          reason: 'invalid_payload',
          details: { provider: 'openai', issue: 'missing_api_key' }
          });
          return { error: 'OpenAI API key is required' };
        }

        const openAiResult = await runOpenAiGeneration({
          mode,
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          apiKey: openAiApiKey,
          baseUrl: openAiBaseUrl,
          maxOutputTokens: openAiMaxOutputTokens,
          systemPrompt,
          responseInstructions
        });

        const evaluation = evaluateCodexOutput(mode, openAiResult.output);
        const evaluationValid =
          evaluation.suggestion !== null &&
          evaluation.validationErrors.length === 0 &&
          (mode === 'job-with-bundle'
            ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
            : mode === 'workflow-with-jobs'
            ? evaluation.workflowPlan !== null
            : true);

        const session = createAiGenerationSession({
          proxyJobId: null,
          provider: 'openai',
          mode,
          metadataSummary,
          operatorRequest,
          additionalNotes,
          status: evaluationValid ? 'succeeded' : 'failed',
          stdout: '',
          stderr: '',
          summary: openAiResult.summary ?? null,
          rawOutput: truncate(openAiResult.output),
          result: {
            mode,
            raw: openAiResult.output,
            suggestion: evaluation.suggestion,
            validation: {
              valid: evaluationValid,
              errors: evaluation.validationErrors
            },
            stdout: '',
            stderr: '',
            metadataSummary,
            bundle: evaluation.bundleSuggestion,
            bundleValidation: {
              valid: evaluation.bundleValidationErrors.length === 0,
              errors: evaluation.bundleValidationErrors
            },
            jobSuggestions: undefined,
            plan: evaluation.workflowPlan,
            notes: evaluation.workflowPlan?.notes ?? null,
            summary: openAiResult.summary ?? null,
            contextPreview
          },
          error: evaluation.validationErrors.join('\n') || null,
          completedAt: Date.now(),
          contextPreview
        });

        reply.status(201);
        await authResult.auth.log('succeeded', {
          provider,
          mode,
          sessionId: session.id,
          metadataSummaryLength: metadataSummary.length
        });
        return { data: buildAiGenerationResponse(session) };
      }

      if (provider === 'openrouter') {
        const openRouterApiKey = providerOptions.openRouterApiKey?.trim();
        const openRouterReferer = providerOptions.openRouterReferer?.trim() || undefined;
        const openRouterTitle = providerOptions.openRouterTitle?.trim() || undefined;

        if (!openRouterApiKey) {
          reply.status(400);
          await authResult.auth.log('failed', {
            reason: 'invalid_payload',
            details: { provider: 'openrouter', issue: 'missing_api_key' }
          });
          return { error: 'OpenRouter API key is required' };
        }

        const openRouterResult = await runOpenRouterGeneration({
          mode,
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          apiKey: openRouterApiKey,
          referer: openRouterReferer,
          title: openRouterTitle,
          systemPrompt,
          responseInstructions
        });

        const evaluation = evaluateCodexOutput(mode, openRouterResult.output);
        const evaluationValid =
          evaluation.suggestion !== null &&
          evaluation.validationErrors.length === 0 &&
          (mode === 'job-with-bundle'
            ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
            : mode === 'workflow-with-jobs'
            ? evaluation.workflowPlan !== null
            : true);

        const session = createAiGenerationSession({
          proxyJobId: null,
          provider: 'openrouter',
          mode,
          metadataSummary,
          operatorRequest,
          additionalNotes,
          status: evaluationValid ? 'succeeded' : 'failed',
          stdout: '',
          stderr: '',
          summary: openRouterResult.summary ?? null,
          rawOutput: truncate(openRouterResult.output),
          result: {
            mode,
            raw: openRouterResult.output,
            suggestion: evaluation.suggestion,
            validation: {
              valid: evaluationValid,
              errors: evaluation.validationErrors
            },
            stdout: '',
            stderr: '',
            metadataSummary,
            bundle: evaluation.bundleSuggestion,
            bundleValidation: {
              valid: evaluation.bundleValidationErrors.length === 0,
              errors: evaluation.bundleValidationErrors
            },
            jobSuggestions: undefined,
            plan: evaluation.workflowPlan,
            notes: evaluation.workflowPlan?.notes ?? null,
            summary: openRouterResult.summary ?? null,
            contextPreview
          },
          error: evaluation.validationErrors.join('\n') || null,
          completedAt: Date.now(),
          contextPreview
        });

        reply.status(201);
        await authResult.auth.log('succeeded', {
          provider,
          mode,
          sessionId: session.id,
          metadataSummaryLength: metadataSummary.length
        });
        return { data: buildAiGenerationResponse(session) };
      }

      if (process.env.APPHUB_CODEX_MOCK_DIR) {
        const codexResult = await runCodexGeneration({
          mode,
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          systemPrompt,
          responseInstructions
        });

        const evaluation = evaluateCodexOutput(mode, codexResult.output);
        const evaluationValid =
          evaluation.suggestion !== null &&
          evaluation.validationErrors.length === 0 &&
          (mode === 'job-with-bundle'
            ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
            : mode === 'workflow-with-jobs'
            ? evaluation.workflowPlan !== null
            : true);

        const session = createAiGenerationSession({
          proxyJobId: null,
          provider: 'codex',
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
            jobSuggestions: undefined,
            plan: evaluation.workflowPlan,
            notes: evaluation.workflowPlan?.notes ?? null,
            summary: codexResult.summary ?? null,
            contextPreview
          },
          error: evaluation.validationErrors.join('\n') || null,
          completedAt: Date.now(),
          contextPreview
        });

        reply.status(201);
        await authResult.auth.log('succeeded', {
          provider,
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
        provider: 'codex',
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
        error: null,
        contextPreview
      });

      reply.status(202);
      await authResult.auth.log('succeeded', {
        provider,
        mode,
        sessionId: session.id,
        proxyJobId: proxyJob.jobId
      });
      return { data: buildAiGenerationResponse(session) };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start AI generation';
      const provider: AiBuilderProvider = payload.provider ?? 'codex';
      request.log.error({ err, provider }, 'Failed to start AI generation');
      reply.status(502);
      const reason =
        provider === 'openai'
          ? 'openai_start_failure'
          : provider === 'openrouter'
          ? 'openrouter_start_failure'
          : 'codex_start_failure';
      await authResult.auth.log('failed', {
        reason,
        message,
        provider
      });
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
              proxyJobId: session.proxyJobId,
              provider: session.provider
            });
          } else {
            const evaluation = evaluateCodexOutput(session.mode, status.output);
            const evaluationValid =
              evaluation.suggestion !== null &&
              evaluation.validationErrors.length === 0 &&
              (session.mode === 'job-with-bundle'
                ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
                : session.mode === 'workflow-with-jobs'
                ? evaluation.workflowPlan !== null
                : true);

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
              jobSuggestions: undefined,
              plan: evaluation.workflowPlan,
              notes: evaluation.workflowPlan?.notes ?? null,
              summary: status.summary ?? null,
              contextPreview: session.contextPreview
            };
            session.error = null;
            session.completedAt = Date.now();
            session.updatedAt = session.completedAt;

            await authResult.auth.log('succeeded', {
              mode: session.mode,
              event: 'generation-completed',
              valid: evaluationValid,
              issueCount: evaluation.validationErrors.length,
              proxyJobId: session.proxyJobId,
              provider: session.provider
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
            proxyJobId: session.proxyJobId,
            provider: session.provider
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
          proxyJobId: session.proxyJobId ?? undefined,
          provider: session.provider
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

      const bundleContexts = await collectBundleContexts(jobs);
      const jobCatalog = jobs.map(serializeJobDefinition);
      const serviceCatalog = services.map(serializeService);
      const workflowCatalog = workflows.map(serializeWorkflowDefinition);
      const metadataSummary = buildAiMetadataSummary({ jobs, services, workflows, bundles: bundleContexts });
      const contextFiles = buildCodexContextFiles({
        mode,
        jobs: jobCatalog,
        services: serviceCatalog,
        workflows: workflowCatalog,
        bundles: bundleContexts
      });

      const provider: AiBuilderProvider = payload.provider ?? 'codex';
      const providerOptions = payload.providerOptions ?? {};
      const promptOverrides = payload.promptOverrides ?? undefined;
      const systemPrompt = promptOverrides?.systemPrompt;
      const responseInstructions = promptOverrides?.responseInstructions;

      if (provider === 'openai') {
        const openAiApiKey = providerOptions.openAiApiKey?.trim();
        const openAiBaseUrl = providerOptions.openAiBaseUrl?.trim() || undefined;
        const openAiMaxOutputTokens =
          typeof providerOptions.openAiMaxOutputTokens === 'number' && Number.isFinite(providerOptions.openAiMaxOutputTokens)
            ? Math.min(Math.max(providerOptions.openAiMaxOutputTokens, 256), 32_000)
            : OPENAI_DEFAULT_MAX_OUTPUT_TOKENS;

        if (!openAiApiKey) {
          reply.status(400);
          await authResult.auth.log('failed', {
            reason: 'invalid_payload',
            details: { provider: 'openai', issue: 'missing_api_key' }
          });
          return { error: 'OpenAI API key is required' };
        }

        const openAiResult = await runOpenAiGeneration({
          mode,
          operatorRequest: payload.prompt,
          metadataSummary,
          additionalNotes: payload.additionalNotes ?? undefined,
          contextFiles,
          apiKey: openAiApiKey,
          baseUrl: openAiBaseUrl,
          maxOutputTokens: openAiMaxOutputTokens,
          systemPrompt,
          responseInstructions
        });

        const evaluation = evaluateCodexOutput(mode, openAiResult.output);
        const valid =
          evaluation.suggestion !== null &&
          evaluation.validationErrors.length === 0 &&
          (mode === 'job-with-bundle'
            ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
            : mode === 'workflow-with-jobs'
            ? evaluation.workflowPlan !== null
            : true);

        const contextPreview = buildContextPreview({
          provider,
          mode,
          operatorRequest: payload.prompt.trim(),
          additionalNotes: payload.additionalNotes ?? undefined,
          metadataSummary,
          contextFiles,
          systemPrompt,
          responseInstructions
        });

        await authResult.auth.log('succeeded', {
          mode,
          provider,
          valid,
          issueCount: evaluation.validationErrors.length
        });

        reply.status(200);
        return {
          data: {
            mode,
            raw: openAiResult.output,
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
            jobSuggestions: undefined,
            plan: evaluation.workflowPlan,
            notes: evaluation.workflowPlan?.notes ?? null,
            stdout: '',
            stderr: '',
            metadataSummary,
            summary: openAiResult.summary ?? null,
            contextPreview
          }
        };
      }

      if (provider === 'openrouter') {
        const openRouterApiKey = providerOptions.openRouterApiKey?.trim();
        const openRouterReferer = providerOptions.openRouterReferer?.trim() || undefined;
        const openRouterTitle = providerOptions.openRouterTitle?.trim() || undefined;

        if (!openRouterApiKey) {
          reply.status(400);
          await authResult.auth.log('failed', {
            reason: 'invalid_payload',
            details: { provider: 'openrouter', issue: 'missing_api_key' }
          });
          return { error: 'OpenRouter API key is required' };
        }

        const openRouterResult = await runOpenRouterGeneration({
          mode,
          operatorRequest: payload.prompt,
          metadataSummary,
          additionalNotes: payload.additionalNotes ?? undefined,
          contextFiles,
          apiKey: openRouterApiKey,
          referer: openRouterReferer,
          title: openRouterTitle,
          systemPrompt,
          responseInstructions
        });

        const evaluation = evaluateCodexOutput(mode, openRouterResult.output);
        const valid =
          evaluation.suggestion !== null &&
          evaluation.validationErrors.length === 0 &&
          (mode === 'job-with-bundle'
            ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
            : mode === 'workflow-with-jobs'
            ? evaluation.workflowPlan !== null
            : true);

        const contextPreview = buildContextPreview({
          provider,
          mode,
          operatorRequest: payload.prompt.trim(),
          additionalNotes: payload.additionalNotes ?? undefined,
          metadataSummary,
          contextFiles,
          systemPrompt,
          responseInstructions
        });

        await authResult.auth.log('succeeded', {
          mode,
          provider,
          valid,
          issueCount: evaluation.validationErrors.length
        });

        reply.status(200);
        return {
          data: {
            mode,
            raw: openRouterResult.output,
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
            jobSuggestions: undefined,
            plan: evaluation.workflowPlan,
            notes: evaluation.workflowPlan?.notes ?? null,
            stdout: '',
            stderr: '',
            metadataSummary,
            summary: openRouterResult.summary ?? null,
            contextPreview
          }
        };
      }

      const codexResult = await runCodexGeneration({
        mode,
        operatorRequest: payload.prompt,
        metadataSummary,
        additionalNotes: payload.additionalNotes ?? undefined,
        contextFiles,
        systemPrompt,
        responseInstructions
      });

      const evaluation = evaluateCodexOutput(mode, codexResult.output);

      const valid =
        evaluation.suggestion !== null &&
        evaluation.validationErrors.length === 0 &&
        (mode === 'job-with-bundle'
          ? evaluation.bundleSuggestion !== null && evaluation.bundleValidationErrors.length === 0
          : mode === 'workflow-with-jobs'
          ? evaluation.workflowPlan !== null
          : true);

      const contextPreview = buildContextPreview({
        provider,
        mode,
        operatorRequest: payload.prompt.trim(),
        additionalNotes: payload.additionalNotes ?? undefined,
        metadataSummary,
        contextFiles,
        systemPrompt,
        responseInstructions
      });

      await authResult.auth.log('succeeded', {
        mode,
        provider: 'codex',
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
          jobSuggestions: undefined,
          plan: evaluation.workflowPlan,
          notes: evaluation.workflowPlan?.notes ?? null,
          stdout: truncate(codexResult.stdout),
          stderr: truncate(codexResult.stderr),
          metadataSummary,
          summary: codexResult.summary ?? null,
          contextPreview
        }
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate AI suggestion';
      reply.status(502);
      const provider: AiBuilderProvider = payload.provider ?? 'codex';
      const reason =
        provider === 'openai'
          ? 'openai_failure'
          : provider === 'openrouter'
          ? 'openrouter_failure'
          : 'codex_failure';
      await authResult.auth.log('failed', { reason, message, provider });
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
    const generationProvider =
      generationSession?.provider ??
      (typeof generation?.provider === 'string' &&
      (generation.provider === 'codex' || generation.provider === 'openai' || generation.provider === 'openrouter')
        ? (generation.provider as AiBuilderProvider)
        : undefined);

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
      summary: summary ?? undefined,
      provider: generationProvider ?? undefined
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
        runtime: normalizedJobInput.runtime,
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
