import { API_BASE_URL } from '../config';
import {
  ensureOk,
  parseJson,
  type AuthorizedFetch,
  type JobDefinitionSummary
} from '../workflows/api';

export type JobRunSummary = {
  id: string;
  status: string;
  parameters: unknown;
  result: unknown;
  errorMessage: string | null;
  logsUrl: string | null;
  attempt: number;
  maxAttempts: number | null;
  timeoutMs: number | null;
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
  runtime: 'node' | 'python';
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

export async function fetchJobs(fetcher: AuthorizedFetch): Promise<JobDefinitionSummary[]> {
  const response = await fetcher(`${API_BASE_URL}/jobs`);
  await ensureOk(response, 'Failed to load job definitions');
  const payload = await parseJson<{ data?: JobDefinitionSummary[] }>(response);
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchJobRuntimeStatuses(fetcher: AuthorizedFetch): Promise<JobRuntimeStatus[]> {
  const response = await fetcher(`${API_BASE_URL}/jobs/runtimes`);
  await ensureOk(response, 'Failed to load job runtime readiness');
  const payload = await parseJson<{ data?: unknown }>(response);
  const rawData = payload.data;
  const raw = Array.isArray(rawData) ? rawData : [];
  const statuses: JobRuntimeStatus[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const runtime = record.runtime === 'python' ? 'python' : 'node';
    const ready = Boolean(record.ready);
    const reason = typeof record.reason === 'string' ? record.reason : null;
    const checkedAt = typeof record.checkedAt === 'string' ? record.checkedAt : new Date().toISOString();
    const details = toRecord(record.details ?? null);
    statuses.push({ runtime, ready, reason, checkedAt, details });
  }
  return statuses;
}

export async function fetchJobDetail(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<JobDetailResponse> {
  const response = await fetcher(`${API_BASE_URL}/jobs/${encodeURIComponent(slug)}`);
  await ensureOk(response, 'Failed to load job details');
  const payload = await parseJson<{ data?: JobDetailResponse }>(response);
  if (!payload.data) {
    throw new Error('Job detail response missing data');
  }
  return payload.data;
}

export async function fetchJobBundleEditor(
  fetcher: AuthorizedFetch,
  slug: string
): Promise<BundleEditorData> {
  const response = await fetcher(`${API_BASE_URL}/jobs/${encodeURIComponent(slug)}/bundle-editor`);
  await ensureOk(response, 'Failed to load bundle editor');
  const payload = await parseJson<{ data?: BundleEditorData }>(response);
  if (!payload.data) {
    throw new Error('Bundle editor response missing data');
  }
  return payload.data;
}

export async function fetchBundleVersionDetail(
  fetcher: AuthorizedFetch,
  slug: string,
  version: string
): Promise<BundleVersionDetail> {
  const response = await fetcher(
    `${API_BASE_URL}/job-bundles/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`
  );
  await ensureOk(response, 'Failed to load bundle version');
  const payload = await parseJson<{ data?: BundleVersionDetail }>(response);
  if (!payload.data) {
    throw new Error('Bundle version response missing data');
  }
  return payload.data;
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
  fetcher: AuthorizedFetch,
  slug: string,
  input: BundleRegenerateInput
): Promise<BundleEditorData> {
  const response = await fetcher(`${API_BASE_URL}/jobs/${encodeURIComponent(slug)}/bundle/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to regenerate bundle');
  const payload = await parseJson<{ data?: BundleEditorData }>(response);
  if (!payload.data) {
    throw new Error('Bundle regeneration response missing data');
  }
  return payload.data;
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
  fetcher: AuthorizedFetch,
  slug: string,
  input: BundleAiEditInput
): Promise<BundleEditorData> {
  const response = await fetcher(`${API_BASE_URL}/jobs/${encodeURIComponent(slug)}/bundle/ai-edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to edit bundle with AI');
  const payload = await parseJson<{ data?: BundleEditorData }>(response);
  if (!payload.data) {
    throw new Error('AI bundle edit response missing data');
  }
  return payload.data;
}

export async function previewJobSchemas(
  fetcher: AuthorizedFetch,
  input: { entryPoint: string; runtime?: 'node' | 'python' }
): Promise<SchemaPreview> {
  const response = await fetcher(`${API_BASE_URL}/jobs/schema-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryPoint: input.entryPoint, runtime: input.runtime })
  });
  await ensureOk(response, 'Failed to inspect entry point schemas');
  const payload = await parseJson<{
    data?: {
      parametersSchema?: unknown;
      outputSchema?: unknown;
      parametersSource?: unknown;
      outputSource?: unknown;
    };
  }>(response);
  const data = payload.data ?? {};
  return {
    parametersSchema: toRecord(data.parametersSchema ?? null),
    outputSchema: toRecord(data.outputSchema ?? null),
    parametersSource: typeof data.parametersSource === 'string' ? data.parametersSource : null,
    outputSource: typeof data.outputSource === 'string' ? data.outputSource : null
  } satisfies SchemaPreview;
}

function normalizeSnippetPreview(raw: unknown): PythonSnippetPreview {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid snippet preview response');
  }
  const data = raw as Record<string, unknown>;
  const handlerName = typeof data.handlerName === 'string' ? data.handlerName : null;
  const handlerIsAsync = Boolean(data.handlerIsAsync);
  const inputModel = toRecord(data.inputModel ?? null);
  const outputModel = toRecord(data.outputModel ?? null);
  if (!handlerName || !inputModel || !outputModel) {
    throw new Error('Snippet preview response missing required data');
  }
  const inputSchema = toRecord(inputModel.schema ?? null);
  const outputSchema = toRecord(outputModel.schema ?? null);
  if (!inputSchema || !outputSchema) {
    throw new Error('Snippet preview response missing schemas');
  }
  const inputName = typeof inputModel.name === 'string' ? inputModel.name : null;
  const outputName = typeof outputModel.name === 'string' ? outputModel.name : null;
  if (!inputName || !outputName) {
    throw new Error('Snippet preview response missing model names');
  }
  return {
    handlerName,
    handlerIsAsync,
    inputModel: { name: inputName, schema: inputSchema },
    outputModel: { name: outputName, schema: outputSchema }
  } satisfies PythonSnippetPreview;
}

export async function previewPythonSnippet(
  fetcher: AuthorizedFetch,
  input: { snippet: string }
): Promise<PythonSnippetPreview> {
  const response = await fetcher(`${API_BASE_URL}/jobs/python-snippet/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to analyze Python snippet');
  const payload = await parseJson<{ data?: unknown }>(response);
  if (!payload.data) {
    throw new Error('Snippet preview response missing data');
  }
  return normalizeSnippetPreview(payload.data);
}

export async function createPythonSnippetJob(
  fetcher: AuthorizedFetch,
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
  }
): Promise<PythonSnippetCreateResult> {
  const response = await fetcher(`${API_BASE_URL}/jobs/python-snippet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });
  await ensureOk(response, 'Failed to create Python job');
  const payload = await parseJson<{
    data?: {
      job?: JobDefinitionSummary;
      analysis?: unknown;
      bundle?: { slug?: unknown; version?: unknown };
    };
  }>(response);
  const data = payload.data;
  if (!data || !data.job || !data.bundle) {
    throw new Error('Python job creation response missing data');
  }
  const analysis = normalizeSnippetPreview(data.analysis ?? {});
  const bundleSlug = typeof data.bundle.slug === 'string' ? data.bundle.slug : null;
  const bundleVersion = typeof data.bundle.version === 'string' ? data.bundle.version : null;
  if (!bundleSlug || !bundleVersion) {
    throw new Error('Bundle metadata missing from response');
  }
  const job: JobDefinitionSummary = {
    ...data.job,
    registryRef: data.job.registryRef ?? null,
    timeoutMs: data.job.timeoutMs ?? null
  } satisfies JobDefinitionSummary;
  return {
    job,
    analysis,
    bundle: { slug: bundleSlug, version: bundleVersion }
  } satisfies PythonSnippetCreateResult;
}
