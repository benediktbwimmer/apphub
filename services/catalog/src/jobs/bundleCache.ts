import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import * as tar from 'tar';
import type { ReadEntry } from 'tar';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '../observability/logger';
import type { JobBundleVersionRecord, JsonValue } from '../db';
import { ensureLocalBundleExists, getLocalBundleArtifactPath } from './bundleStorage';

const DEFAULT_CACHE_ROOT = path.resolve(__dirname, '..', '..', 'data', 'bundle-runtime-cache');
const DEFAULT_MAX_ENTRIES = Number(process.env.APPHUB_JOB_BUNDLE_CACHE_MAX_ENTRIES ?? 16);
const DEFAULT_TTL_MS = Number(process.env.APPHUB_JOB_BUNDLE_CACHE_TTL_MS ?? 15 * 60_000);

const s3Bucket = process.env.APPHUB_JOB_BUNDLE_S3_BUCKET?.trim() || null;
const s3Region = process.env.APPHUB_JOB_BUNDLE_S3_REGION?.trim() || process.env.AWS_REGION?.trim() || 'us-east-1';
const s3Endpoint = process.env.APPHUB_JOB_BUNDLE_S3_ENDPOINT?.trim() || undefined;
const s3ForcePathStyle = (process.env.APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true';

let sharedS3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Bucket) {
    throw new Error('APPHUB_JOB_BUNDLE_S3_BUCKET must be configured for s3 bundle storage');
  }
  if (!sharedS3Client) {
    sharedS3Client = new S3Client({
      region: s3Region,
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle || undefined
    });
  }
  return sharedS3Client;
}

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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function computeChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = createReadStream(filePath);
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve());
  });
  return hash.digest('hex');
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

async function removeDirSafe(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.warn('Failed to remove bundle cache directory', {
      error: errorMessage,
      target
    });
  }
}

async function downloadS3Artifact(record: JobBundleVersionRecord, targetPath: string): Promise<void> {
  if (!s3Bucket) {
    throw new Error('S3 bucket is not configured for bundle runtime downloads');
  }
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: s3Bucket, Key: record.artifactPath });
  const response = await client.send(command);
  const body = response.Body;
  if (!body || typeof (body as any).pipe !== 'function') {
    throw new Error('Received empty body while downloading bundle artifact from S3');
  }
  await ensureDir(path.dirname(targetPath));
  await new Promise<void>((resolve, reject) => {
    const writeStream = createWriteStream(targetPath);
    writeStream.on('error', reject);
    writeStream.on('finish', () => resolve());
    (body as NodeJS.ReadableStream)
      .on('error', reject)
      .pipe(writeStream, { end: true });
  });
}

function ensureWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Bundle artifact attempted to write outside cache root');
  }
}

type CacheEntry = {
  key: string;
  slug: string;
  version: string;
  checksum: string;
  directory: string;
  entryFile: string;
  manifest: { entry: string; capabilities: string[] };
  record: JobBundleVersionRecord;
  lastAccessed: number;
  refCount: number;
};

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
  private readonly cacheRoot: string;
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pendingLoads = new Map<string, Promise<CacheEntry>>();

  constructor(options?: { cacheRoot?: string; maxEntries?: number; ttlMs?: number }) {
    this.cacheRoot = options?.cacheRoot ?? DEFAULT_CACHE_ROOT;
    this.maxEntries = Math.max(1, Math.floor(options?.maxEntries ?? DEFAULT_MAX_ENTRIES));
    this.ttlMs = Math.max(60_000, Math.floor(options?.ttlMs ?? DEFAULT_TTL_MS));
  }

  async acquire(record: JobBundleVersionRecord): Promise<AcquiredBundle> {
    const key = this.buildKey(record);
    let entry = this.entries.get(key);
    if (entry && !this.isExpired(entry)) {
      entry.refCount += 1;
      entry.lastAccessed = Date.now();
      return this.wrapEntry(entry);
    }

    const pendingLoad = this.pendingLoads.get(key) ?? this.createLoadPromise(record, key);
    this.pendingLoads.set(key, pendingLoad);
    entry = await pendingLoad;
    this.pendingLoads.delete(key);
    this.entries.set(key, entry);
    entry.refCount += 1;
    entry.lastAccessed = Date.now();
    return this.wrapEntry(entry);
  }

  private wrapEntry(entry: CacheEntry): AcquiredBundle {
    let released = false;
    return {
      slug: entry.slug,
      version: entry.version,
      checksum: entry.checksum,
      directory: entry.directory,
      entryFile: entry.entryFile,
      manifest: entry.manifest,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        entry.refCount = Math.max(0, entry.refCount - 1);
        entry.lastAccessed = Date.now();
        await this.evictIfNeeded();
      }
    } satisfies AcquiredBundle;
  }

  private buildKey(record: JobBundleVersionRecord): string {
    return `${record.slug}@${record.version}#${record.checksum}`;
  }

  private isExpired(entry: CacheEntry): boolean {
    if (entry.refCount > 0) {
      return false;
    }
    return Date.now() - entry.lastAccessed > this.ttlMs;
  }

  private async createLoadPromise(record: JobBundleVersionRecord, key: string): Promise<CacheEntry> {
    return this.loadEntry(record, key).catch((err) => {
      this.pendingLoads.delete(key);
      throw err;
    });
  }

  private async loadEntry(record: JobBundleVersionRecord, key: string): Promise<CacheEntry> {
    const manifest = normalizeManifest(record.manifest);
    const slugSegment = sanitizeSegment(record.slug);
    const versionSegment = sanitizeSegment(record.version || 'v');
    const bundleRoot = path.join(this.cacheRoot, slugSegment, versionSegment, record.checksum);
    await ensureDir(bundleRoot);

    const artifactPath = await this.materializeArtifact(record);
    const checksum = await computeChecksum(artifactPath);
    if (checksum !== record.checksum) {
      throw new Error(`Bundle checksum mismatch for ${record.slug}@${record.version}`);
    }

    const stagingDir = path.join(this.cacheRoot, '__staging', `${key}-${Date.now()}`);
    await ensureDir(stagingDir);
    try {
      await tar.x({
        file: artifactPath,
        cwd: stagingDir,
        strict: true,
        preservePaths: false,
        onentry: (entry: ReadEntry) => {
          if (!entry.path || entry.path.includes('..')) {
            throw new Error('Unsafe path detected while extracting bundle artifact');
          }
        }
      });
    } catch (err) {
      await removeDirSafe(stagingDir);
      throw err;
    }

    await removeDirSafe(bundleRoot);
    await ensureDir(path.dirname(bundleRoot));
    await fs.rename(stagingDir, bundleRoot);

    const entryFile = this.resolveEntryPath(bundleRoot, manifest.entry);
    const entryExists = await pathExists(entryFile);
    if (!entryExists) {
      throw new Error(`Bundle entry file not found at ${manifest.entry}`);
    }

    logger.info('Loaded job bundle into cache', {
      slug: record.slug,
      version: record.version,
      bundleRoot
    });

    return {
      key,
      slug: record.slug,
      version: record.version,
      checksum,
      directory: bundleRoot,
      entryFile,
      manifest,
      record,
      lastAccessed: Date.now(),
      refCount: 0
    } satisfies CacheEntry;
  }

  private resolveEntryPath(root: string, entry: string): string {
    const normalized = path.normalize(entry).replace(/^\.\//, '');
    const absolute = path.resolve(root, normalized);
    ensureWithinRoot(root, absolute);
    return absolute;
  }

  private async materializeArtifact(record: JobBundleVersionRecord): Promise<string> {
    if (record.artifactStorage === 'local') {
      await ensureLocalBundleExists(record);
      return getLocalBundleArtifactPath(record);
    }
    const downloadsRoot = path.join(this.cacheRoot, '__downloads');
    await ensureDir(downloadsRoot);
    const fileName = `${sanitizeSegment(record.slug)}-${sanitizeSegment(record.version || 'v')}-${record.checksum}.tgz`;
    const targetPath = path.join(downloadsRoot, fileName);
    if (await pathExists(targetPath)) {
      return targetPath;
    }
    const tempPath = path.join(downloadsRoot, `${fileName}.${process.pid}.${Date.now()}.tmp`);
    await downloadS3Artifact(record, tempPath);
    try {
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        await fs.rm(tempPath, { force: true });
      } else {
        await fs.rm(tempPath, { force: true });
        throw err;
      }
    }
    return targetPath;
  }

  private async evictIfNeeded(): Promise<void> {
    const now = Date.now();
    for (const entry of Array.from(this.entries.values())) {
      if (entry.refCount === 0 && now - entry.lastAccessed > this.ttlMs) {
        await this.evictEntry(entry);
      }
    }

    while (this.entries.size > this.maxEntries) {
      const candidate = this.findLeastRecentlyUsed();
      if (!candidate || candidate.refCount > 0) {
        break;
      }
      await this.evictEntry(candidate);
    }
  }

  private findLeastRecentlyUsed(): CacheEntry | null {
    let selected: CacheEntry | null = null;
    for (const entry of this.entries.values()) {
      if (entry.refCount > 0) {
        continue;
      }
      if (!selected || entry.lastAccessed < selected.lastAccessed) {
        selected = entry;
      }
    }
    return selected;
  }

  private async evictEntry(entry: CacheEntry): Promise<void> {
    this.entries.delete(entry.key);
    const relative = path.relative(this.cacheRoot, entry.directory);
    if (relative && !relative.startsWith('..')) {
      await removeDirSafe(entry.directory);
      logger.info('Evicted job bundle from cache', {
        slug: entry.slug,
        version: entry.version
      });
    }
  }
}

export const bundleCache = new BundleCache();
