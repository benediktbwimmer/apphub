import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as tar from 'tar';
import type { ReadEntry } from 'tar';
import { logger } from '../observability/logger';
import type { JobBundleVersionRecord, JsonValue } from '../db';
import { readBundleArtifactBuffer } from './bundleStorage';

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase() || 'bundle';
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function removeDirSafe(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to remove bundle workspace directory', {
      error: errorMessage,
      target
    });
  }
}

function ensureWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Bundle artifact attempted to write outside workspace root');
  }
}

type WorkspaceBundle = {
  root: string;
  directory: string;
};

async function createWorkspace(record: JobBundleVersionRecord): Promise<WorkspaceBundle> {
  const slugSegment = sanitizeSegment(record.slug);
  const prefix = `apphub-bundle-${slugSegment}-${record.checksum.slice(0, 8)}-`;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const directory = path.join(root, 'bundle');
  await ensureDir(directory);
  return { root, directory } satisfies WorkspaceBundle;
}

async function extractBundleArchive(options: {
  buffer: Buffer;
  targetDir: string;
}): Promise<void> {
  const tempTarPath = path.join(options.targetDir, '..', `artifact-${Date.now()}.tgz`);
  await fs.writeFile(tempTarPath, options.buffer);
  try {
    await tar.x({
      file: tempTarPath,
      cwd: options.targetDir,
      strict: true,
      preservePaths: false,
      onentry: (entry: ReadEntry) => {
        if (!entry.path || entry.path.includes('..')) {
          throw new Error('Unsafe path detected while extracting bundle artifact');
        }
      }
    });
  } finally {
    await fs.rm(tempTarPath, { force: true }).catch(() => {});
  }
}

function normalizeManifest(manifest: JsonValue): { entry: string; capabilities: string[] } {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Bundle manifest is missing or invalid');
  }
  const manifestRecord = manifest as Record<string, JsonValue>;
  const rawEntry = manifestRecord.entry;
  if (typeof rawEntry !== 'string' || !rawEntry.trim()) {
    throw new Error('Bundle manifest entry must be a non-empty string');
  }
  const entry = rawEntry.trim();
  const rawCapabilities = manifestRecord.capabilities;
  const capabilitySet = new Set<string>();
  if (Array.isArray(rawCapabilities)) {
    for (const item of rawCapabilities) {
      if (typeof item === 'string' && item.trim()) {
        capabilitySet.add(item.trim());
      }
    }
  }
  return { entry, capabilities: Array.from(capabilitySet).sort() };
}

function resolveEntryPath(root: string, entry: string): string {
  const normalized = path.normalize(entry).replace(/^\.\//, '');
  const absolute = path.resolve(root, normalized);
  ensureWithinRoot(root, absolute);
  return absolute;
}

export type AcquiredBundle = {
  slug: string;
  version: string;
  checksum: string;
  directory: string;
  entryFile: string;
  manifest: { entry: string; capabilities: string[] };
  release: () => Promise<void>;
};

export class BundleCache {
  async acquire(record: JobBundleVersionRecord): Promise<AcquiredBundle> {
    const workspace = await createWorkspace(record);
    try {
      const artifactBuffer = await readBundleArtifactBuffer(record);
      await extractBundleArchive({ buffer: artifactBuffer, targetDir: workspace.directory });

      const manifest = normalizeManifest(record.manifest);
      const entryFile = resolveEntryPath(workspace.directory, manifest.entry);
      if (!(await pathExists(entryFile))) {
        throw new Error(`Bundle entry file not found at ${manifest.entry}`);
      }

      logger.info('Materialized job bundle workspace', {
        slug: record.slug,
        version: record.version,
        directory: workspace.directory
      });

      const release = async () => {
        await removeDirSafe(workspace.root);
      };

      return {
        slug: record.slug,
        version: record.version,
        checksum: record.checksum,
        directory: workspace.directory,
        entryFile,
        manifest,
        release
      } satisfies AcquiredBundle;
    } catch (err) {
      await removeDirSafe(workspace.root);
      throw err;
    }
  }
}

export const bundleCache = new BundleCache();
