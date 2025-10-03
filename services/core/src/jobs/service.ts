import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import type {
  JobDefinitionRecord,
  JobRunRecord,
  JsonValue
} from '../db/types';
import {
  createJobDefinition,
  createJobRun,
  getBuildById,
  getJobDefinitionBySlug,
  getJobRunById,
  listJobDefinitions,
  listJobRuns,
  listJobRunsForDefinition,
  completeJobRun,
  upsertJobDefinition
} from '../db/index';
import { getModuleTargetRuntimeConfig } from '../db/modules';
import { enqueueBuildJob, enqueueRepositoryIngestion } from '../queue';
import { executeJobRun } from './runtime';
import { mergeJsonObjects } from './jsonMerge';
import { getRuntimeReadiness } from './runtimeReadiness';
import { introspectEntryPointSchemas } from './schemaIntrospector';
import { isDockerRuntimeEnabled } from '../config/dockerRuntime';
import {
  previewPythonSnippet,
  createPythonSnippetJob,
  PythonSnippetBuilderError
} from './pythonSnippetBuilder';
import { PythonSnippetAnalysisError } from './pythonSnippetAnalyzer';
import {
  loadBundleEditorSnapshot,
  parseBundleEntryPoint,
  findNextVersion,
  type BundleEditorSnapshot
} from './bundleEditor';
import { extractMetadata, cloneSuggestion } from './bundleRecovery';
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
import { safeParseDockerJobMetadata } from './dockerMetadata';
import {
  aiJobWithBundleOutputSchema,
  jobDefinitionCreateSchema,
  jobDefinitionUpdateSchema,
  jsonValueSchema
} from '../workflows/zodSchemas';
import type { OperatorIdentity } from '../auth/tokens';

const OPENAI_MAX_TOKENS_DEFAULT = 4_096;
const AI_BUNDLE_EDIT_PROMPT_MAX_LENGTH = 10_000;

const aiBundleEditProviderSchema = z.enum(['codex', 'openai', 'openrouter']);

export const jobRunRequestSchema = z
  .object({
    parameters: jsonValueSchema.optional(),
    timeoutMs: z.number().int().min(1_000).max(86_400_000).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    context: jsonValueSchema.optional()
  })
  .strict();

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

export const aiBundleEditRequestSchema = z
  .object({
    prompt: z.string().min(1).max(AI_BUNDLE_EDIT_PROMPT_MAX_LENGTH),
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

const bundleEditorFileSchema = z
  .object({
    path: z.string().min(1).max(512),
    contents: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    executable: z.boolean().optional()
  })
  .strict();

export const bundleRegenerateSchema = z
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

export const pythonSnippetPreviewSchema = z
  .object({
    snippet: z.string().min(1).max(20_000)
  })
  .strict();

const dependencySchema = z
  .string()
  .min(1)
  .max(120);

export const pythonSnippetCreateSchema = z
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

export type JobDefinitionCreateInput = z.infer<typeof jobDefinitionCreateSchema>;
export type JobDefinitionUpdateInput = z.infer<typeof jobDefinitionUpdateSchema>;

export class JobServiceError<T = unknown> extends Error {
  constructor(
    public readonly code: JobServiceErrorCode,
    public readonly statusCode: number,
    public readonly payload: T,
    message?: string,
    public readonly cause?: unknown
  ) {
    super(message ?? (typeof payload === 'string' ? payload : code));
    this.name = 'JobServiceError';
  }
}

export type JobServiceErrorCode =
  | 'docker_runtime_disabled'
  | 'invalid_docker_metadata'
  | 'duplicate_job'
  | 'job_not_found'
  | 'bundle_editor_unavailable'
  | 'job_bundle_binding_missing'
  | 'invalid_snippet'
  | 'execution_error'
  | 'ai_generation_failed'
  | 'ai_bundle_validation_failed'
  | 'invalid_bundle_payload'
  | 'duplicate_bundle_version'
  | 'missing_parameter'
  | 'unexpected_error';

export type JobServiceContext = {
  logger: FastifyBaseLogger;
};

export type JobRunRequestPayload = {
  parameters?: JsonValue;
  timeoutMs?: number;
  maxAttempts?: number;
  context?: JsonValue;
};

export type JobRunFilters = {
  statuses?: string[];
  jobSlugs?: string[];
  runtimes?: string[];
  search?: string;
};

export type JobRunListResult = Awaited<ReturnType<typeof listJobRuns>>;

export type JobServiceAiEditInput = z.infer<typeof aiBundleEditRequestSchema> & {
  slug: string;
};

export type JobServiceRegenerateInput = z.infer<typeof bundleRegenerateSchema> & {
  slug: string;
};

export type JobServicePythonSnippetPreviewInput = z.infer<typeof pythonSnippetPreviewSchema>;

export type JobServicePythonSnippetCreateInput = z.infer<typeof pythonSnippetCreateSchema>;

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
  return { parameters, timeoutMs, maxAttempts, context: payload.context ?? null };
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

function flattenErrorToJson(flattened: z.typeToFlattenedError<unknown>): JsonValue {
  const fieldErrors: Record<string, string[]> = {};
  const rawFieldErrors = flattened.fieldErrors as Record<string, string[] | undefined>;
  for (const [key, value] of Object.entries(rawFieldErrors)) {
    if (value && value.length > 0) {
      fieldErrors[key] = value;
    }
  }
  return {
    formErrors: flattened.formErrors,
    fieldErrors
  };
}

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

function toJobSummary(job: JobDefinitionRecord) {
  return {
    slug: job.slug,
    name: job.name,
    type: job.type,
    version: job.version ?? null,
    entryPoint: job.entryPoint,
    timeoutMs: job.timeoutMs ?? null,
    retryPolicy: job.retryPolicy ?? null,
    parametersSchema: job.parametersSchema ?? {},
    defaultParameters: job.defaultParameters ?? {},
    outputSchema: job.outputSchema ?? {},
    metadata: job.metadata ?? null,
    registryRef: null
  };
}

export class JobService {
  constructor(private readonly deps: JobServiceDependencies) {}

  async listJobDefinitions(): Promise<JobDefinitionRecord[]> {
    return this.deps.listJobDefinitions();
  }

  async getRuntimeReadiness() {
    return this.deps.getRuntimeReadiness();
  }

  async listJobRuns(params: {
    limit: number;
    offset: number;
    filters: JobRunFilters;
  }): Promise<JobRunListResult> {
    return this.deps.listJobRuns(params);
  }

  async createJobDefinition(
    payload: JobDefinitionCreateInput,
    context: JobServiceContext
  ): Promise<JobDefinitionRecord> {
    const runtime = payload.runtime ?? 'node';

    if (runtime === 'docker' && !this.deps.isDockerRuntimeEnabled()) {
      throw new JobServiceError('docker_runtime_disabled', 400, 'Docker job runtime is disabled in this environment.');
    }

    let normalizedMetadata: JsonValue | null = (payload.metadata ?? null) as JsonValue | null;
    if (runtime === 'docker') {
      const metadataResult = this.deps.safeParseDockerJobMetadata(normalizedMetadata ?? {});
      if (!metadataResult.success) {
        throw new JobServiceError(
          'invalid_docker_metadata',
          400,
          flattenErrorToJson(metadataResult.error.flatten())
        );
      }
      normalizedMetadata = metadataResult.data as JsonValue;
    }

    const createPayload = normalizeJobDefinitionPayload({
      ...payload,
      metadata: (normalizedMetadata ?? undefined) as JsonValue | undefined
    });

    try {
      return await this.deps.createJobDefinition(createPayload);
    } catch (err) {
      if (err instanceof Error && /already exists/i.test(err.message)) {
        throw new JobServiceError('duplicate_job', 409, err.message, err.message, err);
      }
      context.logger.error({ err }, 'Failed to create job definition');
      throw new JobServiceError('unexpected_error', 500, 'Failed to create job definition', 'Failed to create job definition', err);
    }
  }

  async updateJobDefinition(
    slug: string,
    payload: JobDefinitionUpdateInput,
    context: JobServiceContext
  ): Promise<JobDefinitionRecord> {
    const existing = await this.deps.getJobDefinitionBySlug(slug);
    if (!existing) {
      throw new JobServiceError('job_not_found', 404, 'job not found');
    }

    const targetRuntime = payload.runtime ?? existing.runtime;

    if (targetRuntime === 'docker' && !this.deps.isDockerRuntimeEnabled()) {
      throw new JobServiceError('docker_runtime_disabled', 400, 'Docker job runtime is disabled in this environment.');
    }

    const incomingMetadata =
      payload.metadata !== undefined
        ? (payload.metadata as JsonValue | null)
        : ((existing.metadata ?? null) as JsonValue | null);

    let normalizedMetadata: JsonValue | null = incomingMetadata;
    if (targetRuntime === 'docker') {
      const metadataResult = this.deps.safeParseDockerJobMetadata(normalizedMetadata ?? {});
      if (!metadataResult.success) {
        throw new JobServiceError(
          'invalid_docker_metadata',
          400,
          flattenErrorToJson(metadataResult.error.flatten())
        );
      }
      normalizedMetadata = metadataResult.data as JsonValue;
    }

    const merged = {
      slug: existing.slug,
      name: payload.name ?? existing.name,
      type: payload.type ?? existing.type,
      version: payload.version ?? existing.version,
      runtime: targetRuntime,
      entryPoint: payload.entryPoint ?? existing.entryPoint,
      timeoutMs: payload.timeoutMs ?? existing.timeoutMs ?? undefined,
      retryPolicy: payload.retryPolicy ?? existing.retryPolicy ?? undefined,
      parametersSchema: (payload.parametersSchema ?? existing.parametersSchema ?? undefined) as JsonValue | undefined,
      defaultParameters: (payload.defaultParameters ?? existing.defaultParameters ?? undefined) as JsonValue | undefined,
      outputSchema: (payload.outputSchema ?? existing.outputSchema ?? undefined) as JsonValue | undefined,
      metadata: (normalizedMetadata ?? undefined) as JsonValue | undefined
    };

    try {
      return await this.deps.upsertJobDefinition(merged);
    } catch (err) {
      context.logger.error({ err, slug: existing.slug }, 'Failed to update job definition');
      throw new JobServiceError('unexpected_error', 500, 'Failed to update job definition', 'Failed to update job definition', err);
    }
  }

  async previewJobSchemas(entryPoint: string, context: JobServiceContext) {
    try {
      return await this.deps.introspectEntryPointSchemas(entryPoint);
    } catch (err) {
      context.logger.error({ err, entryPoint }, 'Failed to inspect job entry point for schema preview');
      throw new JobServiceError('unexpected_error', 500, 'Failed to inspect entry point', 'Failed to inspect entry point', err);
    }
  }

  async previewPythonSnippet(
    payload: JobServicePythonSnippetPreviewInput,
    context: JobServiceContext
  ) {
    try {
      return await this.deps.previewPythonSnippet(payload.snippet);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze snippet';
      const isBadRequest =
        err instanceof PythonSnippetAnalysisError || err instanceof PythonSnippetBuilderError;
      if (isBadRequest) {
        throw new JobServiceError('invalid_snippet', 400, message, message, err);
      }
      context.logger.warn({ err }, 'Python snippet preview failed');
      throw new JobServiceError('unexpected_error', 500, message, message, err);
    }
  }

  async createPythonSnippetJob(
    payload: JobServicePythonSnippetCreateInput,
    operator: Pick<OperatorIdentity, 'subject' | 'kind' | 'tokenHash'>,
    context: JobServiceContext
  ) {
    try {
      return await this.deps.createPythonSnippetJob(
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
          subject: operator.subject,
          kind: operator.kind,
          tokenHash: operator.tokenHash
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create Python job';
      const isBadRequest =
        err instanceof PythonSnippetAnalysisError || err instanceof PythonSnippetBuilderError;
      if (isBadRequest) {
        throw new JobServiceError('invalid_snippet', 400, message, message, err);
      }
      context.logger.error({ err }, 'Failed to create Python snippet job');
      throw new JobServiceError('unexpected_error', 500, message, message, err);
    }
  }

  async getJobWithRuns(slug: string, pagination: { limit: number; offset: number }) {
    const job = await this.deps.getJobDefinitionBySlug(slug);
    if (!job) {
      throw new JobServiceError('job_not_found', 404, 'job not found');
    }

    const runs = await this.deps.listJobRunsForDefinition(job.id, pagination);
    return { job, runs };
  }

  async loadBundleEditor(slug: string, context: JobServiceContext) {
    const job = await this.deps.getJobDefinitionBySlug(slug);
    if (!job) {
      throw new JobServiceError('job_not_found', 404, 'job not found');
    }

    try {
      const snapshot = await this.deps.loadBundleEditorSnapshot(job);
      if (!snapshot) {
        throw new JobServiceError('bundle_editor_unavailable', 404, 'bundle editor not available for job');
      }
      return { job, snapshot };
    } catch (err) {
      if (err instanceof JobServiceError) {
        throw err;
      }
      context.logger.error({ err, slug: job.slug }, 'Failed to load bundle editor');
      throw new JobServiceError('unexpected_error', 500, 'Failed to load bundle editor', 'Failed to load bundle editor', err);
    }
  }

  async aiEditBundle(
    input: JobServiceAiEditInput,
    operator: Pick<OperatorIdentity, 'subject' | 'kind' | 'tokenHash'>,
    context: JobServiceContext
  ) {
    const job = await this.deps.getJobDefinitionBySlug(input.slug);
    if (!job) {
      throw new JobServiceError('job_not_found', 404, 'job not found');
    }

    const binding = parseBundleEntryPoint(job.entryPoint);
    if (!binding) {
      throw new JobServiceError('job_bundle_binding_missing', 409, 'job is not bound to a bundle entry point');
    }

    let snapshot: BundleEditorSnapshot | null = null;
    try {
      snapshot = await this.deps.loadBundleEditorSnapshot(job);
    } catch (err) {
      context.logger.error({ err, slug: job.slug }, 'Failed to load bundle snapshot for AI edit');
    }
    if (!snapshot) {
      throw new JobServiceError('bundle_editor_unavailable', 404, 'bundle editor not available for job');
    }

    const operatorRequest = input.prompt.trim();
    const provider = input.provider ?? 'openai';
    const providerOptions = input.providerOptions ?? {};

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

    const contextFiles = this.deps.buildCodexContextFiles({
      mode: 'job-with-bundle',
      jobs: [toJobSummary(job)],
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

        const result = await this.deps.runOpenAiGeneration({
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
        const result = await this.deps.runOpenRouterGeneration({
          mode: 'job-with-bundle',
          operatorRequest,
          metadataSummary,
          additionalNotes,
          contextFiles,
          apiKey: providerOptions.openRouterApiKey?.trim() ?? '',
          referer: providerOptions.openRouterReferer?.trim(),
          title: providerOptions.openRouterTitle?.trim(),
          systemPrompt: DEFAULT_AI_BUILDER_SYSTEM_PROMPT,
          responseInstructions: DEFAULT_AI_BUILDER_RESPONSE_INSTRUCTIONS
        });
        rawOutput = result.output;
        summary = result.summary ?? null;
      } else {
        const result = await this.deps.runCodexGeneration({
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
      context.logger.error({ err, slug: job.slug, provider }, 'AI bundle edit generation failed');
      throw new JobServiceError('ai_generation_failed', 502, message, message, err);
    }

    const evaluation = evaluateAiBundleEditOutput(rawOutput);
    if (!evaluation.bundle || evaluation.errors.length > 0) {
      throw new JobServiceError(
        'ai_bundle_validation_failed',
        422,
        evaluation.errors.join('\n') || 'AI response did not include a valid bundle'
      );
    }

    const resolvedVersion = await this.deps.findNextVersion(binding.slug, binding.version);
    const suggestion: AiGeneratedBundleSuggestion = {
      ...evaluation.bundle,
      slug: binding.slug,
      version: resolvedVersion
    };

    try {
      const publishResult = await this.deps.publishGeneratedBundle(suggestion, {
        subject: operator.subject,
        kind: operator.kind,
        tokenHash: operator.tokenHash
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
      const updatedJob = await this.deps.upsertJobDefinition({
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

      const refreshed = await this.deps.loadBundleEditorSnapshot(updatedJob);
      if (!refreshed) {
        throw new Error('Failed to refresh bundle editor snapshot');
      }

      return { job: updatedJob, snapshot: refreshed, publishResult, rawOutput, summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish AI-generated bundle';
      const isDuplicate = err instanceof Error && /already exists/i.test(err.message);
      const isInvalid = err instanceof Error && /invalid bundle file path/i.test(err.message);
      const code: JobServiceErrorCode = isInvalid
        ? 'invalid_bundle_payload'
        : isDuplicate
        ? 'duplicate_bundle_version'
        : 'unexpected_error';
      const statusCode = isInvalid ? 400 : isDuplicate ? 409 : 500;
      context.logger.error({ err, slug: job.slug }, 'Failed to publish AI-edited bundle');
      throw new JobServiceError(
        code,
        statusCode,
        statusCode === 500 ? 'Failed to publish AI-generated bundle' : message,
        message,
        err
      );
    }
  }

  async regenerateBundle(
    input: JobServiceRegenerateInput,
    operator: Pick<OperatorIdentity, 'subject' | 'kind' | 'tokenHash'>,
    context: JobServiceContext
  ) {
    const job = await this.deps.getJobDefinitionBySlug(input.slug);
    if (!job) {
      throw new JobServiceError('job_not_found', 404, 'job not found');
    }

    const binding = parseBundleEntryPoint(job.entryPoint);
    if (!binding) {
      throw new JobServiceError('job_bundle_binding_missing', 409, 'job is not bound to a bundle entry point');
    }

    const versionInput = typeof input.version === 'string' ? input.version.trim() : '';
    const resolvedVersion = versionInput || (await this.deps.findNextVersion(binding.slug, binding.version));
    const files = input.files.map((file) => {
      const encoding: AiGeneratedBundleFile['encoding'] = file.encoding === 'base64' ? 'base64' : 'utf8';
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
      entryPoint: input.entryPoint.trim(),
      manifest: input.manifest ?? {},
      manifestPath: input.manifestPath.trim(),
      capabilityFlags: normalizeCapabilityFlagInput(input.capabilityFlags),
      metadata: input.metadata ?? null,
      description: input.description ?? null,
      displayName: input.displayName ?? null,
      files
    };

    try {
      const publishResult = await this.deps.publishGeneratedBundle(suggestion, {
        subject: operator.subject,
        kind: operator.kind,
        tokenHash: operator.tokenHash
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
      const updatedJob = await this.deps.upsertJobDefinition({
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

      const snapshot = await this.deps.loadBundleEditorSnapshot(updatedJob);
      if (!snapshot) {
        throw new Error('Failed to refresh bundle editor snapshot');
      }

      return { job: updatedJob, snapshot, publishResult };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to regenerate job bundle';
      const isDuplicate = err instanceof Error && /already exists/i.test(err.message);
      const isInvalid = err instanceof Error && /invalid bundle file path/i.test(err.message);
      const code: JobServiceErrorCode = isInvalid
        ? 'invalid_bundle_payload'
        : isDuplicate
        ? 'duplicate_bundle_version'
        : 'unexpected_error';
      const statusCode = isInvalid ? 400 : isDuplicate ? 409 : 500;
      context.logger.error({ err, slug: job.slug }, 'Failed to regenerate job bundle');
      throw new JobServiceError(
        code,
        statusCode,
        statusCode === 500 ? 'Failed to regenerate bundle' : message,
        message,
        err
      );
    }
  }

  async runJob(
    slug: string,
    payload: JobRunRequestPayload,
    context: JobServiceContext
  ): Promise<JobRunRecord> {
    const job = await this.deps.getJobDefinitionBySlug(slug);
    if (!job) {
      throw new JobServiceError('job_not_found', 404, 'job not found');
    }

    let runInput = normalizeJobRunPayload(job, payload);
    if (job.runtime === 'module' && job.moduleBinding) {
      const runtimeConfig = await getModuleTargetRuntimeConfig({ binding: job.moduleBinding });
      if (runtimeConfig) {
        const moduleRuntimeContext = {
          settings: runtimeConfig.settings ?? null,
          secrets: runtimeConfig.secrets ?? null
        } satisfies Record<string, JsonValue>;
        const moduleRuntimeEnvelope = {
          moduleRuntime: moduleRuntimeContext
        } satisfies Record<string, JsonValue>;
        runInput = {
          ...runInput,
          context: mergeJsonObjects(runInput.context, moduleRuntimeEnvelope)
        };
      }
    }
    const run = await this.deps.createJobRun(job.id, runInput);
    let latestRun: JobRunRecord | null = run;

    const markFailure = async (statusCode: number, message: string, code: JobServiceErrorCode) => {
      await this.deps.completeJobRun(run.id, 'failed', { errorMessage: message });
      throw new JobServiceError(code, statusCode, message);
    };

    try {
      if (job.slug === 'repository-ingest') {
        const repositoryId = getStringParameter(run.parameters, 'repositoryId');
        if (!repositoryId) {
          await markFailure(400, 'repositoryId parameter is required', 'missing_parameter');
        }
        latestRun = await this.deps.enqueueRepositoryIngestion(repositoryId!, {
          jobRunId: run.id,
          parameters: run.parameters
        });
      } else if (job.slug === 'repository-build') {
        const buildId = getStringParameter(run.parameters, 'buildId');
        if (!buildId) {
          await markFailure(400, 'buildId parameter is required', 'missing_parameter');
        }
        let repositoryId = getStringParameter(run.parameters, 'repositoryId');
        if (!repositoryId) {
          const build = await this.deps.getBuildById(buildId!);
          repositoryId = build?.repositoryId ?? null;
        }
        if (!repositoryId) {
          await markFailure(400, 'repositoryId parameter is required', 'missing_parameter');
        }
        latestRun = await this.deps.enqueueBuildJob(buildId!, repositoryId!, { jobRunId: run.id });
      } else {
        latestRun = await this.deps.executeJobRun(run.id);
      }
    } catch (err) {
      if (err instanceof JobServiceError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : 'job execution failed';
      context.logger.error({ err, slug: job.slug }, 'Failed to execute job run');
      const errorContext: Record<string, JsonValue> = {
        error: errorMessage,
        errorName: err instanceof Error ? err.name ?? 'Error' : 'unknown'
      } satisfies Record<string, JsonValue>;
      if (err instanceof Error && err.stack) {
        errorContext.stack = err.stack;
      }
      await this.deps.completeJobRun(run.id, 'failed', {
        errorMessage,
        context: errorContext
      });
      throw new JobServiceError('execution_error', 502, errorMessage, errorMessage, err);
    }

    const responseRun = latestRun ?? (await this.deps.getJobRunById(run.id)) ?? run;
    return responseRun;
  }
}

export type JobServiceDependencies = {
  listJobDefinitions: typeof listJobDefinitions;
  getRuntimeReadiness: typeof getRuntimeReadiness;
  listJobRuns: typeof listJobRuns;
  createJobDefinition: typeof createJobDefinition;
  upsertJobDefinition: typeof upsertJobDefinition;
  getJobDefinitionBySlug: typeof getJobDefinitionBySlug;
  safeParseDockerJobMetadata: typeof safeParseDockerJobMetadata;
  isDockerRuntimeEnabled: typeof isDockerRuntimeEnabled;
  introspectEntryPointSchemas: typeof introspectEntryPointSchemas;
  previewPythonSnippet: typeof previewPythonSnippet;
  createPythonSnippetJob: typeof createPythonSnippetJob;
  loadBundleEditorSnapshot: typeof loadBundleEditorSnapshot;
  findNextVersion: typeof findNextVersion;
  publishGeneratedBundle: typeof publishGeneratedBundle;
  buildCodexContextFiles: typeof buildCodexContextFiles;
  runCodexGeneration: typeof runCodexGeneration;
  runOpenAiGeneration: typeof runOpenAiGeneration;
  runOpenRouterGeneration: typeof runOpenRouterGeneration;
  createJobRun: typeof createJobRun;
  executeJobRun: typeof executeJobRun;
  completeJobRun: typeof completeJobRun;
  getJobRunById: typeof getJobRunById;
  listJobRunsForDefinition: typeof listJobRunsForDefinition;
  enqueueRepositoryIngestion: typeof enqueueRepositoryIngestion;
  enqueueBuildJob: typeof enqueueBuildJob;
  getBuildById: typeof getBuildById;
};

const defaultDependencies: JobServiceDependencies = {
  listJobDefinitions,
  getRuntimeReadiness,
  listJobRuns,
  createJobDefinition,
  upsertJobDefinition,
  getJobDefinitionBySlug,
  safeParseDockerJobMetadata,
  isDockerRuntimeEnabled,
  introspectEntryPointSchemas,
  previewPythonSnippet,
  createPythonSnippetJob,
  loadBundleEditorSnapshot,
  findNextVersion,
  publishGeneratedBundle,
  buildCodexContextFiles,
  runCodexGeneration,
  runOpenAiGeneration,
  runOpenRouterGeneration,
  createJobRun,
  executeJobRun,
  completeJobRun,
  getJobRunById,
  listJobRunsForDefinition,
  enqueueRepositoryIngestion,
  enqueueBuildJob,
  getBuildById
};

export function createJobService(overrides: Partial<JobServiceDependencies> = {}) {
  return new JobService({
    ...defaultDependencies,
    ...overrides
  });
}
