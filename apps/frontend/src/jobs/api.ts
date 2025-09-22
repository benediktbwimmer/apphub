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

export async function fetchJobs(fetcher: AuthorizedFetch): Promise<JobDefinitionSummary[]> {
  const response = await fetcher(`${API_BASE_URL}/jobs`);
  await ensureOk(response, 'Failed to load job definitions');
  const payload = await parseJson<{ data?: JobDefinitionSummary[] }>(response);
  return Array.isArray(payload.data) ? payload.data : [];
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
  version?: string | null;
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
