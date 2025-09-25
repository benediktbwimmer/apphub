import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  ExampleBundlerProgressStage,
  PackagedExampleBundle
} from '@apphub/example-bundler';

export type ExampleBundleState = 'queued' | 'running' | 'completed' | 'failed';

export type ExampleBundleStatus = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId?: string;
  version?: string;
  checksum?: string;
  filename?: string;
  cached?: boolean;
  error?: string | null;
  message?: string | null;
  updatedAt: string;
  createdAt: string;
};

const statusFile = path.resolve(__dirname, '..', '..', 'data', 'example-bundles', 'status.json');

export async function recordProgress(
  slug: string,
  fingerprint: string,
  stage: ExampleBundlerProgressStage,
  options: {
    jobId?: string;
    error?: string | null;
    message?: string | null;
  } = {}
): Promise<ExampleBundleStatus> {
  const state: ExampleBundleState =
    stage === 'failed' ? 'failed' : stage === 'completed' ? 'completed' : stage === 'queued' ? 'queued' : 'running';
  const current = await loadStatusMap();
  const existing = current[slug];
  const now = new Date().toISOString();
  const createdAt = existing?.createdAt ?? now;
  const status: ExampleBundleStatus = {
    slug,
    fingerprint,
    stage,
    state,
    jobId: options.jobId ?? existing?.jobId,
    version: existing?.version,
    checksum: existing?.checksum,
    filename: existing?.filename,
    cached: existing?.cached,
    error: stage === 'failed' ? options.error ?? 'example bundle packaging failed' : null,
    message: options.message ?? existing?.message ?? null,
    updatedAt: now,
    createdAt
  };
  current[slug] = status;
  await persistStatusMap(current);
  return status;
}

export async function recordCompletion(
  result: PackagedExampleBundle,
  options: { jobId?: string }
): Promise<ExampleBundleStatus> {
  const current = await loadStatusMap();
  const existing = current[result.slug];
  const now = new Date().toISOString();
  const status: ExampleBundleStatus = {
    slug: result.slug,
    fingerprint: result.fingerprint,
    stage: 'completed',
    state: 'completed',
    jobId: options.jobId ?? existing?.jobId,
    version: result.version,
    checksum: result.checksum,
    filename: result.filename,
    cached: result.cached,
    error: null,
    message: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
  current[result.slug] = status;
  await persistStatusMap(current);
  return status;
}

export async function listStatuses(): Promise<ExampleBundleStatus[]> {
  const map = await loadStatusMap();
  return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getStatus(slug: string): Promise<ExampleBundleStatus | null> {
  const map = await loadStatusMap();
  return map[slug] ?? null;
}

export async function clearStatus(slug: string): Promise<void> {
  const map = await loadStatusMap();
  if (map[slug]) {
    delete map[slug];
    await persistStatusMap(map);
  }
}

async function loadStatusMap(): Promise<Record<string, ExampleBundleStatus>> {
  if (!(await fileExists(statusFile))) {
    return {};
  }
  try {
    const raw = await fs.readFile(statusFile, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ExampleBundleStatus>;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function persistStatusMap(map: Record<string, ExampleBundleStatus>): Promise<void> {
  const dir = path.dirname(statusFile);
  await fs.mkdir(dir, { recursive: true });
  const json = `${JSON.stringify(map, null, 2)}\n`;
  await fs.writeFile(statusFile, json, 'utf8');
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
