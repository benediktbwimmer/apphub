import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  recordExampleBundleCompletion,
  upsertExampleBundleStatus
} from '../db/exampleBundles';
import type { ExampleBundleState, ExampleBundleStatusUpsertInput } from '../db';
import {
  saveExampleBundleArtifact,
  type ExampleBundleArtifactUpload
} from '../exampleBundles/bundleStorage';
import type { ExampleBundlerProgressStage } from '@apphub/example-bundler';

const DATA_ROOT = path.resolve(__dirname, '..', '..', 'data', 'example-bundles');
const STATUS_DIR = path.join(DATA_ROOT, 'status');
const LEGACY_STATUS_FILE = path.join(DATA_ROOT, 'status.json');

interface LegacyExampleBundleStatus {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId?: string | null;
  version?: string | null;
  checksum?: string | null;
  filename?: string | null;
  cached?: boolean | null;
  error?: string | null;
  message?: string | null;
  updatedAt: string;
  createdAt: string;
}

async function readLegacyStatusFiles(): Promise<LegacyExampleBundleStatus[]> {
  const statuses: LegacyExampleBundleStatus[] = [];

  const fileEntries = await safeReadDir(STATUS_DIR);
  for (const entry of fileEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const filePath = path.join(STATUS_DIR, entry.name);
    const parsed = await parseLegacyStatusFile(filePath);
    if (parsed) {
      statuses.push(parsed);
    }
  }

  const legacyMap = await parseLegacyStatusMap(LEGACY_STATUS_FILE);
  if (legacyMap) {
    for (const value of Object.values(legacyMap)) {
      if (value && typeof value.slug === 'string') {
        statuses.push(value);
      }
    }
  }

  return statuses;
}

async function parseLegacyStatusFile(filePath: string): Promise<LegacyExampleBundleStatus | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as LegacyExampleBundleStatus;
    if (isLegacyStatus(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn('[example-bundles:migrate] Failed to parse legacy status file', { filePath, err });
  }
  return null;
}

async function parseLegacyStatusMap(filePath: string): Promise<Record<string, LegacyExampleBundleStatus> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, LegacyExampleBundleStatus>;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[example-bundles:migrate] Failed to parse legacy status map', { filePath, err });
    }
  }
  return null;
}

function isLegacyStatus(value: unknown): value is LegacyExampleBundleStatus {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === 'string' &&
    typeof candidate.fingerprint === 'string' &&
    typeof candidate.stage === 'string' &&
    typeof candidate.state === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

async function migrateStatus(status: LegacyExampleBundleStatus): Promise<void> {
  const slug = status.slug.trim().toLowerCase();
  const fingerprint = status.fingerprint.trim();
  if (!slug || !fingerprint) {
    console.warn('[example-bundles:migrate] Skipping status with invalid identifiers', status);
    return;
  }

  const baseInput: ExampleBundleStatusUpsertInput = {
    slug,
    fingerprint,
    stage: status.stage,
    state: status.state,
    jobId: status.jobId ?? null,
    version: status.version ?? null,
    checksum: status.checksum ?? null,
    filename: status.filename ?? null,
    cached: status.cached ?? null,
    error: status.error ?? null,
    message: status.message ?? null,
    artifactId: null,
    completedAt: status.state === 'completed' ? status.updatedAt : null,
    createdAt: status.createdAt,
    updatedAt: status.updatedAt
  };

  if (status.state !== 'completed') {
    await upsertExampleBundleStatus(baseInput);
    console.log('[example-bundles:migrate] Migrated in-progress status', { slug, fingerprint });
    return;
  }

  const artifact = await loadLegacyArtifact(slug, fingerprint, status.filename ?? null);
  if (!artifact) {
    await upsertExampleBundleStatus(baseInput);
    console.warn('[example-bundles:migrate] Completed status without artifact; recorded metadata only', {
      slug,
      fingerprint
    });
    return;
  }

  const artifactInput: ExampleBundleArtifactUpload = {
    slug,
    fingerprint,
    version: status.version ?? null,
    data: artifact.data,
    checksum: status.checksum ?? computeChecksum(artifact.data),
    filename: status.filename ?? path.basename(artifact.path),
    contentType: guessContentType(status.filename ?? null)
  };
  const artifactFilename = artifactInput.filename ?? null;

  const saveResult = await saveExampleBundleArtifact(artifactInput, { force: true });

  await recordExampleBundleCompletion(
    {
      ...baseInput,
      checksum: saveResult.checksum,
      filename: artifactFilename
    },
    {
      slug,
      fingerprint,
      version: status.version ?? null,
      checksum: saveResult.checksum,
      filename: artifactFilename,
      storageKind: saveResult.storageKind,
      storageKey: saveResult.storageKey,
      storageUrl: saveResult.storageUrl,
      contentType: saveResult.contentType,
      size: saveResult.size,
      jobId: status.jobId ?? null
    }
  );

  console.log('[example-bundles:migrate] Migrated completed bundle', {
    slug,
    fingerprint,
    artifactPath: artifact.path
  });
}

async function loadLegacyArtifact(
  slug: string,
  fingerprint: string,
  filename: string | null
): Promise<{ path: string; data: Buffer } | null> {
  if (!filename) {
    return null;
  }
  const candidates = buildLegacyArtifactCandidates(slug, fingerprint, filename);
  for (const candidate of candidates) {
    try {
      const data = await fs.readFile(candidate);
      return { path: candidate, data };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn('[example-bundles:migrate] Failed to read candidate artifact', { candidate, err });
      }
    }
  }
  return null;
}

function buildLegacyArtifactCandidates(slug: string, fingerprint: string, filename: string): string[] {
  const safeFilename = filename.trim();
  return [
    path.join(DATA_ROOT, 'artifacts', slug, fingerprint, safeFilename),
    path.join(DATA_ROOT, 'artifacts', slug, safeFilename),
    path.join(DATA_ROOT, slug, fingerprint, safeFilename),
    path.join(DATA_ROOT, slug, safeFilename),
    path.join(DATA_ROOT, safeFilename)
  ];
}

async function safeReadDir(target: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(target, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

function computeChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function guessContentType(filename: string | null): string | null {
  if (!filename) {
    return null;
  }
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.tgz' || ext === '.tar.gz') {
    return 'application/gzip';
  }
  return null;
}

async function main(): Promise<void> {
  const statuses = await readLegacyStatusFiles();
  if (statuses.length === 0) {
    console.log('[example-bundles:migrate] No legacy statuses found; nothing to migrate');
    return;
  }

  console.log('[example-bundles:migrate] Migrating example bundle statuses', {
    count: statuses.length
  });

  for (const status of statuses) {
    try {
      await migrateStatus(status);
    } catch (err) {
      console.error('[example-bundles:migrate] Failed to migrate status', {
        slug: status.slug,
        fingerprint: status.fingerprint,
        err
      });
    }
  }

  console.log('[example-bundles:migrate] Migration completed');
}

void main().catch((err) => {
  console.error('[example-bundles:migrate] Fatal error', err);
  process.exitCode = 1;
});
