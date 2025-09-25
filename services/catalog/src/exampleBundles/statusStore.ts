import { randomUUID } from 'node:crypto';
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

const statusDir = path.resolve(__dirname, '..', '..', 'data', 'example-bundles', 'status');
const legacyStatusFile = path.resolve(__dirname, '..', '..', 'data', 'example-bundles', 'status.json');
let legacyStatusMigrated = false;
const statusQueues = new Map<string, Promise<void>>();

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
  await migrateLegacyStatuses();
  const normalizedSlug = slug.trim().toLowerCase();
  return runWithStatusQueue(normalizedSlug, async () => {
    const existing = await readStatus(normalizedSlug);
    const state: ExampleBundleState =
      stage === 'failed' ? 'failed' : stage === 'completed' ? 'completed' : stage === 'queued' ? 'queued' : 'running';

    if (
      existing &&
      (existing.state === 'completed' || existing.state === 'failed') &&
      state !== existing.state
    ) {
      return existing;
    }

    const now = new Date().toISOString();
    const createdAt = existing?.createdAt ?? now;

    const status: ExampleBundleStatus = {
      slug: normalizedSlug,
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
    } satisfies ExampleBundleStatus;

    await writeStatus(status);
    return status;
  });
}

export async function recordCompletion(
  result: PackagedExampleBundle,
  options: { jobId?: string }
): Promise<ExampleBundleStatus> {
  await migrateLegacyStatuses();
  const normalizedSlug = result.slug.trim().toLowerCase();
  return runWithStatusQueue(normalizedSlug, async () => {
    const existing = await readStatus(normalizedSlug);
    const now = new Date().toISOString();

    const status: ExampleBundleStatus = {
      slug: normalizedSlug,
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
    } satisfies ExampleBundleStatus;

    await writeStatus(status);
    return status;
  });
}

export async function listStatuses(): Promise<ExampleBundleStatus[]> {
  await migrateLegacyStatuses();
  const statuses = await readAllStatuses();
  return statuses.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getStatus(slug: string): Promise<ExampleBundleStatus | null> {
  await migrateLegacyStatuses();
  const normalizedSlug = slug.trim().toLowerCase();
  return readStatus(normalizedSlug);
}

export async function clearStatus(slug: string): Promise<void> {
  await migrateLegacyStatuses();
  const normalizedSlug = slug.trim().toLowerCase();
  await runWithStatusQueue(normalizedSlug, async () => {
    await deleteStatus(normalizedSlug);
  });
}

async function migrateLegacyStatuses(): Promise<void> {
  if (legacyStatusMigrated) {
    return;
  }
  legacyStatusMigrated = true;

  if (!(await fileExists(legacyStatusFile))) {
    return;
  }

  let legacyMap: Record<string, ExampleBundleStatus> | null = null;
  try {
    const raw = await fs.readFile(legacyStatusFile, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, ExampleBundleStatus>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      legacyMap = parsed;
    }
  } catch (err) {
    console.warn('[example-bundles] Failed to read legacy status map', err);
  }

  if (!legacyMap) {
    await fs.rm(legacyStatusFile, { force: true }).catch(() => {});
    return;
  }

  for (const entry of Object.values(legacyMap)) {
    if (!entry || typeof entry.slug !== 'string') {
      continue;
    }
    const normalizedSlug = entry.slug.trim().toLowerCase();
    if (!normalizedSlug) {
      continue;
    }
    const status: ExampleBundleStatus = {
      ...entry,
      slug: normalizedSlug
    };
    await writeStatus(status);
  }

  await fs.rm(legacyStatusFile, { force: true }).catch(() => {});
}

async function readStatus(slug: string): Promise<ExampleBundleStatus | null> {
  if (!slug) {
    return null;
  }
  const filePath = buildStatusPath(slug);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ExampleBundleStatus;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      ...parsed,
      slug: slug
    } satisfies ExampleBundleStatus;
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function readAllStatuses(): Promise<ExampleBundleStatus[]> {
  try {
    const entries = await fs.readdir(statusDir, { withFileTypes: true });
    const statuses: ExampleBundleStatus[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const slug = entry.name.slice(0, -5);
      const status = await readStatus(slug);
      if (status) {
        statuses.push(status);
      }
    }
    return statuses;
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function writeStatus(status: ExampleBundleStatus): Promise<void> {
  if (!status.slug) {
    return;
  }
  await ensureStatusDir();
  const filePath = buildStatusPath(status.slug);
  const payload = {
    ...status,
    slug: status.slug
  } satisfies ExampleBundleStatus;
  const contents = `${JSON.stringify(payload, null, 2)}\n`;
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, contents, 'utf8');
  try {
    await fs.rename(tempPath, filePath);
  } catch (err) {
    // Fall back to copy + unlink if rename fails (e.g. cross-device edge cases)
    await fs.copyFile(tempPath, filePath);
    await fs.rm(tempPath, { force: true }).catch(() => {});
  }
}

async function runWithStatusQueue<T>(slug: string, task: () => Promise<T>): Promise<T> {
  const previous = statusQueues.get(slug) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  statusQueues.set(slug, previous.then(() => next));
  await previous;
  try {
    return await task();
  } finally {
    release?.();
    if (statusQueues.get(slug) === next) {
      statusQueues.delete(slug);
    }
  }
}

async function deleteStatus(slug: string): Promise<void> {
  const filePath = buildStatusPath(slug);
  await fs.rm(filePath, { force: true }).catch(() => {});
}

async function ensureStatusDir(): Promise<void> {
  await fs.mkdir(statusDir, { recursive: true });
}

function buildStatusPath(slug: string): string {
  return path.join(statusDir, `${slug}.json`);
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return Boolean(value && typeof value === 'object' && 'code' in value);
}
