import { z } from 'zod';

import { coreRequest } from '../core/api';
import type { JobDefinitionSummary } from '../workflows/api';

export type JobRunSummary = {
  id: string;
  status: string;
  parameters: unknown;
  result: unknown;
  errorMessage: string | null;
  logsUrl: string | null;
  context: unknown;
  metrics: unknown;
  attempt: number;
  maxAttempts: number | null;
  timeoutMs: number | null;
  durationMs: number | null;
  retryCount: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  scheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobDetailResponse = {
  job: JobDefinitionSummary;
  runs: JobRunSummary[];
};

export type JobRuntimeStatus = {
  runtime: 'node' | 'python' | 'docker' | 'module';
  ready: boolean;
  reason: string | null;
  checkedAt: string;
  details: Record<string, unknown> | null;
};

export type BundleEditorFile = {
  path: string;
  contents: string;
  encoding: 'utf8' | 'base64';
  executable: boolean;
};

export type BundleVersionSummary = {
  version: string;
  checksum: string;
  capabilityFlags: string[];
  status: string;
  immutable: boolean;
  publishedAt: string;
  deprecatedAt: string | null;
  artifact: {
    storage: string;
    size: number | null;
    contentType: string | null;
  };
  metadata: unknown;
};

export type BundleEditorData = {
  job: JobDefinitionSummary;
  binding: {
    slug: string;
    version: string;
    exportName: string | null;
  };
  bundle: BundleVersionSummary;
  editor: {
    entryPoint: string;
    manifestPath: string;
    manifest: unknown;
    files: BundleEditorFile[];
  };
  aiBuilder: Record<string, unknown> | null;
  history: Array<{
    slug: string;
    version: string;
    checksum?: string;
    regeneratedAt?: string;
  }>;
  suggestionSource: 'metadata' | 'artifact';
  availableVersions: BundleVersionSummary[];
};

export type BundleVersionDetail = {
  bundle: {
    id: string;
    slug: string;
    displayName: string | null;
    description: string | null;
    latestVersion: string | null;
    createdAt: string;
    updatedAt: string;
  };
  version: BundleVersionSummary & {
    id: string;
    bundleId: string;
    slug: string;
    publishedBy: {
      subject: string;
      kind: string | null;
      tokenHash: string | null;
    } | null;
    createdAt: string;
    updatedAt: string;
    manifest?: unknown;
    download?: {
      url: string;
      expiresAt: string;
      storage: string;
      kind: 'local' | 'external';
    };
  };
};

export type SchemaPreview = {
  parametersSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  parametersSource: string | null;
  outputSource: string | null;
};

export type PythonSnippetPreview = {
  handlerName: string;
  handlerIsAsync: boolean;
  inputModel: {
    name: string;
    schema: Record<string, unknown>;
  };
  outputModel: {
    name: string;
    schema: Record<string, unknown>;
  };
};

export type PythonSnippetCreateResult = {
  job: JobDefinitionSummary;
  analysis: PythonSnippetPreview;
  bundle: {
    slug: string;
    version: string;
  };
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function dataEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema }).transform(({ data }) => data);
}

function dataArrayEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: z.array(schema).optional() }).transform(({ data }) => data ?? []);
}

const jobDefinitionSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    version: z.number(),
    type: z.string(),
    runtime: z.enum(['node', 'python', 'docker', 'module']),
    entryPoint: z.string(),
    registryRef: z.string().nullable().optional(),
    parametersSchema: z.unknown().optional(),
    defaultParameters: z.unknown().optional(),
    outputSchema: z.unknown().optional(),
    timeoutMs: z.number().nullable().optional(),
    retryPolicy: z.unknown().optional(),
    metadata: z.unknown().optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .transform((value) => ({
    id: value.id,
    slug: value.slug,
    name: value.name,
    version: value.version,
    type: value.type,
    runtime: value.runtime,
    entryPoint: value.entryPoint,
    registryRef: value.registryRef ?? null,
    parametersSchema: value.parametersSchema ?? null,
    defaultParameters: value.defaultParameters ?? null,
    outputSchema: value.outputSchema ?? null,
    timeoutMs: value.timeoutMs ?? null,
    retryPolicy: value.retryPolicy ?? null,
    metadata: value.metadata ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  } satisfies JobDefinitionSummary));

const jobRunSummarySchema = z
  .object({
    id: z.string(),
    status: z.string(),
    parameters: z.unknown().optional(),
    result: z.unknown().optional(),
    errorMessage: z.string().nullable().optional(),
    logsUrl: z.string().nullable().optional(),
    context: z.unknown().optional(),
    metrics: z.unknown().optional(),
    attempt: z.number(),
    maxAttempts: z.number().nullable().optional(),
    timeoutMs: z.number().nullable().optional(),
    durationMs: z.number().nullable().optional(),
    retryCount: z.number().optional(),
    failureReason: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    scheduledAt: z.string().nullable().optional(),
    createdAt: z.string(),
    updatedAt: z.string()
  })
  .transform((value) => ({
    id: value.id,
    status: value.status,
    parameters: value.parameters ?? null,
    result: value.result ?? null,
    errorMessage: value.errorMessage ?? null,
    logsUrl: value.logsUrl ?? null,
    context: value.context ?? null,
    metrics: value.metrics ?? null,
    attempt: value.attempt,
    maxAttempts: value.maxAttempts ?? null,
    timeoutMs: value.timeoutMs ?? null,
    durationMs: value.durationMs ?? null,
    retryCount: value.retryCount ?? 0,
    failureReason: value.failureReason ?? null,
    startedAt: value.startedAt ?? null,
    completedAt: value.completedAt ?? null,
    scheduledAt: value.scheduledAt ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  } satisfies JobRunSummary));

const jobDetailResponseSchema = z
  .object({
    job: jobDefinitionSummarySchema,
    runs: z.array(jobRunSummarySchema)
  })
  .transform((value) => ({
    job: value.job,
    runs: value.runs
  } satisfies JobDetailResponse));

const bundleEditorFileSchema = z
  .object({
    path: z.string(),
    contents: z.string(),
    encoding: z.enum(['utf8', 'base64']).optional(),
    executable: z.boolean().optional()
  })
  .transform((value) => ({
    path: value.path,
    contents: value.contents,
    encoding: value.encoding ?? 'utf8',
    executable: value.executable ?? false
  } satisfies BundleEditorFile));

const bundleVersionSummaryBase = z.object({
  version: z.string(),
  checksum: z.string(),
  capabilityFlags: z.array(z.string()).optional(),
  status: z.string(),
  immutable: z.boolean(),
  publishedAt: z.string(),
  deprecatedAt: z.string().nullable().optional(),
  artifact: z.object({
    storage: z.string(),
    size: z.number().nullable().optional(),
    contentType: z.string().nullable().optional()
  }),
  metadata: z.unknown().optional()
});

type BundleVersionSummaryBase = z.infer<typeof bundleVersionSummaryBase>;

function mapBundleVersionSummary(value: BundleVersionSummaryBase): BundleVersionSummary {
  return {
    version: value.version,
    checksum: value.checksum,
    capabilityFlags: value.capabilityFlags ?? [],
    status: value.status,
    immutable: value.immutable,
    publishedAt: value.publishedAt,
    deprecatedAt: value.deprecatedAt ?? null,
    artifact: {
      storage: value.artifact.storage,
      size: value.artifact.size ?? null,
      contentType: value.artifact.contentType ?? null
    },
    metadata: value.metadata ?? null
  } satisfies BundleVersionSummary;
}

const bundleVersionSummarySchema = bundleVersionSummaryBase.transform((value) => mapBundleVersionSummary(value));

const bundleEditorDataSchema = z
  .object({
    job: jobDefinitionSummarySchema,
    binding: z.object({
      slug: z.string(),
      version: z.string(),
      exportName: z.string().nullable().optional()
    }),
    bundle: bundleVersionSummarySchema,
    editor: z.object({
      entryPoint: z.string(),
      manifestPath: z.string(),
      manifest: z.unknown().optional(),
      files: z.array(bundleEditorFileSchema).optional()
    }),
    aiBuilder: z.record(z.unknown()).nullable().optional(),
    history: z
      .array(
        z.object({
          slug: z.string(),
          version: z.string(),
          checksum: z.string().optional(),
          regeneratedAt: z.string().optional()
        })
      )
      .optional(),
    suggestionSource: z.enum(['metadata', 'artifact']),
    availableVersions: z.array(bundleVersionSummarySchema).optional()
  })
  .transform((value) => ({
    job: value.job,
    binding: {
      slug: value.binding.slug,
      version: value.binding.version,
      exportName: value.binding.exportName ?? null
    },
    bundle: value.bundle,
    editor: {
      entryPoint: value.editor.entryPoint,
      manifestPath: value.editor.manifestPath,
      manifest: value.editor.manifest ?? null,
      files: value.editor.files ?? []
    },
    aiBuilder: value.aiBuilder ?? null,
    history: value.history ?? [],
    suggestionSource: value.suggestionSource,
    availableVersions: value.availableVersions ?? []
  } satisfies BundleEditorData));

const bundleVersionDetailVersionSchema = bundleVersionSummaryBase
  .extend({
    id: z.string(),
    bundleId: z.string(),
    slug: z.string(),
    publishedBy: z
      .object({
        subject: z.string(),
        kind: z.string().nullable().optional(),
        tokenHash: z.string().nullable().optional()
      })
      .nullable()
      .optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    manifest: z.unknown().optional(),
    download: z
      .object({
        url: z.string(),
        expiresAt: z.string(),
        storage: z.string(),
        kind: z.enum(['local', 'external'])
      })
      .optional()
  })
  .transform((value) => ({
    ...mapBundleVersionSummary(value),
    id: value.id,
    bundleId: value.bundleId,
    slug: value.slug,
    publishedBy: value.publishedBy
      ? {
          subject: value.publishedBy.subject,
          kind: value.publishedBy.kind ?? null,
          tokenHash: value.publishedBy.tokenHash ?? null
        }
      : null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    manifest: value.manifest,
    download: value.download
      ? {
          url: value.download.url,
          expiresAt: value.download.expiresAt,
          storage: value.download.storage,
          kind: value.download.kind
        }
      : undefined
  } satisfies BundleVersionDetail['version']));

const bundleVersionDetailSchema = z
  .object({
    bundle: z.object({
      id: z.string(),
      slug: z.string(),
      displayName: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      latestVersion: z.string().nullable().optional(),
      createdAt: z.string(),
      updatedAt: z.string()
    }),
    version: bundleVersionDetailVersionSchema
  })
  .transform((value) => ({
    bundle: {
      id: value.bundle.id,
      slug: value.bundle.slug,
      displayName: value.bundle.displayName ?? null,
      description: value.bundle.description ?? null,
      latestVersion: value.bundle.latestVersion ?? null,
      createdAt: value.bundle.createdAt,
      updatedAt: value.bundle.updatedAt
    },
    version: value.version
  } satisfies BundleVersionDetail));

const jobRuntimeStatusSchema = z
  .object({
    runtime: z.unknown(),
    ready: z.unknown(),
    reason: z.unknown(),
    checkedAt: z.unknown(),
    details: z.unknown()
  })
  .transform((value) => {
    const runtimeValue =
      typeof value.runtime === 'string' ? value.runtime.trim().toLowerCase() : '';
    const runtime: JobRuntimeStatus['runtime'] =
      runtimeValue === 'python'
        ? 'python'
        : runtimeValue === 'docker'
          ? 'docker'
          : runtimeValue === 'module'
            ? 'module'
            : 'node';
    const reason = typeof value.reason === 'string' ? value.reason : null;
    const checkedAt =
      typeof value.checkedAt === 'string' ? value.checkedAt : new Date().toISOString();
    const details = toRecord(value.details);
    return {
      runtime,
      ready: Boolean(value.ready),
      reason,
      checkedAt,
      details
    } satisfies JobRuntimeStatus;
  });

const jobDefinitionsSchema = dataArrayEnvelope(jobDefinitionSummarySchema);
const jobRuntimeStatusesSchema = dataArrayEnvelope(jobRuntimeStatusSchema);
const jobDetailEnvelope = dataEnvelope(jobDetailResponseSchema);
const bundleEditorDataEnvelope = dataEnvelope(bundleEditorDataSchema);
const bundleVersionDetailEnvelope = dataEnvelope(bundleVersionDetailSchema);

const schemaPreviewBase = z.object({
  parametersSchema: z.unknown().optional(),
  outputSchema: z.unknown().optional(),
  parametersSource: z.unknown().optional(),
  outputSource: z.unknown().optional()
});

const schemaPreviewSchema = schemaPreviewBase.transform((value) => ({
  parametersSchema: toRecord(value.parametersSchema),
  outputSchema: toRecord(value.outputSchema),
  parametersSource: typeof value.parametersSource === 'string' ? value.parametersSource : null,
  outputSource: typeof value.outputSource === 'string' ? value.outputSource : null
} satisfies SchemaPreview));

const schemaPreviewEnvelope = z
  .object({ data: schemaPreviewBase.optional() })
  .transform(({ data }) => schemaPreviewSchema.parse(data ?? {}));

const pythonSnippetPreviewSchema = z
  .object({
    handlerName: z.string(),
    handlerIsAsync: z.boolean(),
    inputModel: z.object({
      name: z.string(),
      schema: z.record(z.unknown())
    }),
    outputModel: z.object({
      name: z.string(),
      schema: z.record(z.unknown())
    })
  })
  .transform((value) => ({
    handlerName: value.handlerName,
    handlerIsAsync: value.handlerIsAsync,
    inputModel: {
      name: value.inputModel.name,
      schema: value.inputModel.schema
    },
    outputModel: {
      name: value.outputModel.name,
      schema: value.outputModel.schema
    }
  } satisfies PythonSnippetPreview));

const pythonSnippetPreviewEnvelope = dataEnvelope(pythonSnippetPreviewSchema);

const pythonSnippetCreateResultSchema = z
  .object({
    job: jobDefinitionSummarySchema,
    analysis: pythonSnippetPreviewSchema,
    bundle: z.object({
      slug: z.string(),
      version: z.string()
    })
  })
  .transform((value) => ({
    job: value.job,
    analysis: value.analysis,
    bundle: value.bundle
  } satisfies PythonSnippetCreateResult));

const pythonSnippetCreateEnvelope = dataEnvelope(pythonSnippetCreateResultSchema);

type Token = string | null | undefined;

function ensureToken(token: Token): string {
  if (typeof token === 'string' && token.trim().length > 0) {
    return token.trim();
  }
  throw new Error('Authentication required for core job requests.');
}

export async function fetchJobs(token: Token, options: { signal?: AbortSignal } = {}): Promise<JobDefinitionSummary[]> {
  const response = await coreRequest(ensureToken(token), {
    url: '/jobs',
    signal: options.signal
  });
  return jobDefinitionsSchema.parse(response);
}

export async function fetchJobRuntimeStatuses(
  token: Token,
  options: { signal?: AbortSignal } = {}
): Promise<JobRuntimeStatus[]> {
  const response = await coreRequest(ensureToken(token), {
    url: '/jobs/runtimes',
    signal: options.signal
  });
  return jobRuntimeStatusesSchema.parse(response);
}

export async function fetchJobDetail(
  token: Token,
  slug: string,
  options: { signal?: AbortSignal } = {}
): Promise<JobDetailResponse> {
  const response = await coreRequest(ensureToken(token), {
    url: `/jobs/${encodeURIComponent(slug)}`,
    signal: options.signal
  });
  return jobDetailEnvelope.parse(response);
}

export async function fetchJobBundleEditor(
  token: Token,
  slug: string,
  options: { signal?: AbortSignal } = {}
): Promise<BundleEditorData> {
  const response = await coreRequest(ensureToken(token), {
    url: `/jobs/${encodeURIComponent(slug)}/bundle-editor`,
    signal: options.signal
  });
  return bundleEditorDataEnvelope.parse(response);
}

export async function fetchBundleVersionDetail(
  token: Token,
  slug: string,
  version: string,
  options: { signal?: AbortSignal } = {}
): Promise<BundleVersionDetail> {
  const response = await coreRequest(ensureToken(token), {
    url: `/job-bundles/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`,
    signal: options.signal
  });
  return bundleVersionDetailEnvelope.parse(response);
}

export type BundleRegenerateInput = {
  entryPoint: string;
  manifestPath: string;
  manifest: unknown;
  files: Array<{
    path: string;
    contents: string;
    encoding?: 'utf8' | 'base64';
    executable?: boolean;
  }>;
  capabilityFlags?: string[];
  metadata?: unknown;
  description?: string | null;
  displayName?: string | null;
  version?: string;
};

export async function regenerateJobBundle(
  token: Token,
  slug: string,
  input: BundleRegenerateInput,
  options: { signal?: AbortSignal } = {}
): Promise<BundleEditorData> {
  const response = await coreRequest(ensureToken(token), {
    method: 'POST',
    url: `/jobs/${encodeURIComponent(slug)}/bundle/regenerate`,
    body: input,
    signal: options.signal
  });
  return bundleEditorDataEnvelope.parse(response);
}

export type BundleAiEditInput = {
  prompt: string;
  provider?: 'openai' | 'openrouter' | 'codex';
  providerOptions?: {
    openAiApiKey?: string;
    openAiBaseUrl?: string;
    openAiMaxOutputTokens?: number;
    openRouterApiKey?: string;
    openRouterReferer?: string;
    openRouterTitle?: string;
  };
};

export async function aiEditJobBundle(
  token: Token,
  slug: string,
  input: BundleAiEditInput,
  options: { signal?: AbortSignal } = {}
): Promise<BundleEditorData> {
  const response = await coreRequest(ensureToken(token), {
    method: 'POST',
    url: `/jobs/${encodeURIComponent(slug)}/bundle/ai-edit`,
    body: input,
    signal: options.signal
  });
  return bundleEditorDataEnvelope.parse(response);
}

export async function previewJobSchemas(
  token: Token,
  input: { entryPoint: string; runtime?: 'node' | 'python' },
  options: { signal?: AbortSignal } = {}
): Promise<SchemaPreview> {
  const response = await coreRequest(ensureToken(token), {
    method: 'POST',
    url: '/jobs/schema-preview',
    body: { entryPoint: input.entryPoint, runtime: input.runtime },
    signal: options.signal
  });
  return schemaPreviewEnvelope.parse(response);
}

export async function previewPythonSnippet(
  token: Token,
  input: { snippet: string },
  options: { signal?: AbortSignal } = {}
): Promise<PythonSnippetPreview> {
  const response = await coreRequest(ensureToken(token), {
    method: 'POST',
    url: '/jobs/python-snippet/preview',
    body: input,
    signal: options.signal
  });
  return pythonSnippetPreviewEnvelope.parse(response);
}

export async function createPythonSnippetJob(
  token: Token,
  input: {
    slug: string;
    name: string;
    type: 'batch' | 'service-triggered' | 'manual';
    snippet: string;
    dependencies?: string[];
    timeoutMs?: number | null;
    versionStrategy?: 'auto' | 'manual';
    bundleSlug?: string | null;
    bundleVersion?: string | null;
    jobVersion?: number | null;
  },
  options: { signal?: AbortSignal } = {}
): Promise<PythonSnippetCreateResult> {
  const response = await coreRequest(ensureToken(token), {
    method: 'POST',
    url: '/jobs/python-snippet',
    body: input,
    signal: options.signal
  });
  return pythonSnippetCreateEnvelope.parse(response);
}
