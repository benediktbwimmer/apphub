import { promises as fs } from 'node:fs';
import path from 'node:path';

export type CodexGenerationMode = 'workflow' | 'job' | 'job-with-bundle' | 'workflow-with-jobs';

export type CodexContextFile = {
  path: string;
  contents: string;
};

export type CodexGenerationOptions = {
  mode: CodexGenerationMode;
  operatorRequest: string;
  metadataSummary: string;
  additionalNotes?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  contextFiles?: CodexContextFile[];
};

export type CodexGenerationResult = {
  workspace: string;
  outputPath: string;
  output: string;
  stdout: string;
  stderr: string;
  summary?: string | null;
};

const DEFAULT_TIMEOUT_MS = 600_000;
const POLL_INTERVAL_MS = 1_000;
const EXTRA_TIMEOUT_BUFFER_MS = 60_000;

type CodexProxyHeaders = Record<string, string>;

type CodexProxyJobStart = {
  jobId: string;
  status: 'pending' | 'running';
  createdAt: string;
};

type CodexProxyJobStatus = {
  jobId: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  stdout: string;
  stderr: string;
  output?: string;
  summary?: string | null;
  error?: string | null;
  exitCode?: number | null;
  workspace?: string | null;
  outputPath?: string | null;
  durationMs?: number | null;
};

function resolveProxyUrl(): string {
  const raw = process.env.APPHUB_CODEX_PROXY_URL?.trim();
  const base = raw && raw.length > 0 ? raw : 'http://host.docker.internal:3030';
  return base.replace(/\/$/, '');
}

function resolveProxyHeaders(): CodexProxyHeaders {
  const headers: CodexProxyHeaders = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-apphub-source': 'services/catalog'
  };
  const token = process.env.APPHUB_CODEX_PROXY_TOKEN?.trim();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function resolveTimeoutMs(options: CodexGenerationOptions): number {
  return options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: resolveProxyHeaders(),
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text();
    }
    const message = detail && typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
    throw new Error(`Codex proxy request failed (${response.status}): ${message}`);
  }

  return (await response.json()) as T;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'GET',
    headers: resolveProxyHeaders(),
    signal
  });

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = await response.text();
    }
    const message = detail && typeof detail === 'object' ? JSON.stringify(detail) : String(detail);
    throw new Error(`Codex proxy request failed (${response.status}): ${message}`);
  }

  return (await response.json()) as T;
}

export async function startCodexGenerationJob(
  options: CodexGenerationOptions
): Promise<CodexProxyJobStart> {
  const proxyUrl = `${resolveProxyUrl()}/v1/codex/jobs`;
  return postJson<CodexProxyJobStart>(proxyUrl, {
    mode: options.mode,
    operatorRequest: options.operatorRequest,
    metadataSummary: options.metadataSummary,
    additionalNotes: options.additionalNotes ?? null,
    timeoutMs: resolveTimeoutMs(options),
    contextFiles: options.contextFiles ?? undefined
  }, options.signal);
}

export async function fetchCodexGenerationJobStatus(
  jobId: string,
  signal?: AbortSignal
): Promise<CodexProxyJobStatus> {
  const proxyUrl = `${resolveProxyUrl()}/v1/codex/jobs/${jobId}`;
  return getJson<CodexProxyJobStatus>(proxyUrl, signal);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Operation aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
        reject(signal.reason ?? new Error('Operation aborted'));
      } else {
        reject(new Error('Operation aborted'));
      }
    };
    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export async function runCodexGeneration(options: CodexGenerationOptions): Promise<CodexGenerationResult> {
  const mockDir = process.env.APPHUB_CODEX_MOCK_DIR;
  if (mockDir) {
    const fileName =
      options.mode === 'workflow'
        ? 'workflow.json'
        : options.mode === 'job'
        ? 'job.json'
        : options.mode === 'job-with-bundle'
        ? 'job-with-bundle.json'
        : 'workflow-with-jobs.json';
    const mockPath = path.join(mockDir, fileName);
    const mockContent = await fs.readFile(mockPath, { encoding: 'utf8' });
    return {
      workspace: mockDir,
      outputPath: mockPath,
      output: mockContent,
      stdout: '',
      stderr: '',
      summary: null
    } satisfies CodexGenerationResult;
  }

  const start = await startCodexGenerationJob(options);
  const timeoutMs = resolveTimeoutMs(options) + EXTRA_TIMEOUT_BUFFER_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error('Codex generation aborted');
    }

    const status = await fetchCodexGenerationJobStatus(start.jobId, options.signal);
    if (status.status === 'succeeded') {
      if (!status.output) {
        throw new Error('Codex proxy job completed without output');
      }
      return {
        workspace: status.workspace ?? '',
        outputPath: status.outputPath ?? '',
        output: status.output,
        stdout: status.stdout ?? '',
        stderr: status.stderr ?? '',
        summary: status.summary ?? null
      } satisfies CodexGenerationResult;
    }

    if (status.status === 'failed') {
      const errorDetail = status.error ?? 'Codex job failed';
      const failure = new Error(`Codex generation failed: ${errorDetail}`);
      (failure as Error & { stdout?: string; stderr?: string }).stdout = status.stdout ?? '';
      (failure as Error & { stdout?: string; stderr?: string }).stderr = status.stderr ?? '';
      throw failure;
    }

    if (Date.now() > deadline) {
      throw new Error('Codex generation timed out');
    }

    await delay(POLL_INTERVAL_MS, options.signal);
  }
}

export type CodexProxyJobStatusResponse = CodexProxyJobStatus;
export type CodexProxyJobStartResponse = CodexProxyJobStart;
