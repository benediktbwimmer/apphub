import path from 'node:path';
import {
  ExampleBundler,
  type ExampleBundlerProgressEvent,
  type PackagedExampleBundle
} from '@apphub/example-bundler';
import { emitApphubEvent } from '../events';
import {
  recordCompletion,
  recordProgress,
  listStatuses,
  getStatus,
  type ExampleBundleStatus
} from './statusStore';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
const cacheDir = path.resolve(__dirname, '..', '..', 'data', 'example-bundles');

let bundler: ExampleBundler | null = null;

function getBundler(): ExampleBundler {
  if (!bundler) {
    bundler = new ExampleBundler({ repoRoot, cacheDir });
  }
  return bundler;
}

type PackageOptions = {
  force?: boolean;
  skipBuild?: boolean;
  minify?: boolean;
  jobId?: string;
};

export async function packageExampleBundle(
  slug: string,
  options: PackageOptions = {}
): Promise<PackagedExampleBundle> {
  const instance = getBundler();
  const jobId = options.jobId;
  const onProgress = createProgressHandler(slug, jobId);
  try {
    const result = await instance.packageExampleBySlug(slug, {
      force: options.force,
      skipBuild: options.skipBuild,
      minify: options.minify,
      onProgress
    });
    const status = await recordCompletion(result, { jobId });
    emitProgressEvent(status);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fingerprint = await resolveFingerprint(slug);
    const status = await recordProgress(slug, fingerprint, 'failed', {
      jobId,
      error: message,
      message
    });
    emitProgressEvent(status);
    throw err;
  }
}

export async function loadCachedExampleBundle(slug: string): Promise<PackagedExampleBundle | null> {
  const instance = getBundler();
  return instance.loadCachedExampleBySlug(slug);
}

export async function listExampleBundleStatuses(): Promise<ExampleBundleStatus[]> {
  return listStatuses();
}

export async function getExampleBundleStatus(slug: string): Promise<ExampleBundleStatus | null> {
  return getStatus(slug);
}

function createProgressHandler(slug: string, jobId?: string) {
  return (event: ExampleBundlerProgressEvent) => {
    void handleProgress(slug, event, jobId);
  };
}

async function handleProgress(
  slug: string,
  event: ExampleBundlerProgressEvent,
  jobId?: string
): Promise<void> {
  const status = await recordProgress(slug, event.fingerprint, event.stage, {
    jobId,
    error: event.stage === 'failed' ? event.message ?? null : null,
    message: event.message ?? null
  });
  emitProgressEvent(status);
}

function emitProgressEvent(status: ExampleBundleStatus) {
  emitApphubEvent({ type: 'example.bundle.progress', data: status });
}

async function resolveFingerprint(slug: string): Promise<string> {
  const instance = getBundler();
  const cached = await instance.loadCachedExampleBySlug(slug);
  if (cached) {
    return cached.fingerprint;
  }
  const normalized = slug.trim().toLowerCase();
  if (!normalized) {
    return slug;
  }
  const metadata = await instance.listCachedBundles(slug);
  if (metadata.length > 0) {
    return metadata[0]?.fingerprint ?? normalized;
  }
  return normalized;
}
