import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import {
  getExampleJobBundle,
  isExampleJobSlug,
  type ExampleJobBundle,
  type ExampleJobSlug
} from '@apphub/examples-registry';
import { loadBundleContext, packageBundle } from './lib/bundle';
import { ensureDir, pathExists, removeDir } from './lib/fs';
import { readJsonFile, writeJsonFile } from './lib/json';
import type {
  BundleConfig,
  JobBundleManifest,
  JsonValue,
  NormalizedBundleConfig,
  PackageResult
} from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_INSTALL_MAX_BUFFER = 32 * 1024 * 1024;
const DEFAULT_CONTENT_TYPE = 'application/gzip';
const DEFAULT_CACHE_DIRNAME = path.join('services', 'catalog', 'data', 'example-bundles');
const LOCKFILE_CANDIDATES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'];

export type ExampleBundlerProgressStage =
  | 'queued'
  | 'resolving'
  | 'cache-hit'
  | 'installing-dependencies'
  | 'packaging'
  | 'completed'
  | 'failed';

export type ExampleBundlerProgressEvent = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  message?: string;
  details?: Record<string, JsonValue>;
};

export type ExampleBundlerOptions = {
  repoRoot?: string;
  cacheDir?: string;
  installCommand?: string[];
  installMaxBuffer?: number;
};

export type PackageExampleOptions = {
  force?: boolean;
  skipBuild?: boolean;
  minify?: boolean;
  onProgress?: (event: ExampleBundlerProgressEvent) => void;
};

export type ExampleBundleCacheEntry = {
  slug: string;
  fingerprint: string;
  version: string;
  checksum: string;
  filename: string;
  createdAt: string;
  size: number;
  manifest: JobBundleManifest;
  manifestObject: Record<string, JsonValue>;
};

export type PackagedExampleBundle = ExampleBundleCacheEntry & {
  buffer: Buffer;
  tarballPath: string;
  contentType: string;
  cached: boolean;
};

export class ExampleBundler {
  private readonly repoRoot: string;
  private readonly cacheRoot: string;
  private readonly installCommand: string[];
  private readonly installMaxBuffer: number;
  private readonly installLocks = new Map<string, Promise<void>>();
  private readonly packageLocks = new Map<string, Promise<PackagedExampleBundle>>();

  constructor(options: ExampleBundlerOptions = {}) {
    this.repoRoot = resolveRepoRoot(options.repoRoot);
    this.cacheRoot = resolveCacheRoot(this.repoRoot, options.cacheDir);
    this.installCommand = Array.isArray(options.installCommand) && options.installCommand.length > 0
      ? options.installCommand
      : ['npm', 'install'];
    this.installMaxBuffer =
      typeof options.installMaxBuffer === 'number' && Number.isFinite(options.installMaxBuffer)
        ? options.installMaxBuffer
        : DEFAULT_INSTALL_MAX_BUFFER;
  }

  async packageExampleBySlug(
    slug: string,
    options: PackageExampleOptions = {}
  ): Promise<PackagedExampleBundle> {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!isExampleJobSlug(normalizedSlug)) {
      throw new Error(`Unknown example bundle slug: ${slug}`);
    }
    const bundle = getExampleJobBundle(normalizedSlug);
    if (!bundle) {
      throw new Error(`Unknown example bundle slug: ${slug}`);
    }
    return this.packageExample(bundle, options);
  }

  async packageExample(
    bundle: ExampleJobBundle,
    options: PackageExampleOptions = {}
  ): Promise<PackagedExampleBundle> {
    const key = await this.computeCacheKey(bundle);
    const existing = this.packageLocks.get(key.cacheKey);
    if (existing) {
      return existing;
    }
    const promise = this.packageExampleInternal(bundle, key, options).finally(() => {
      this.packageLocks.delete(key.cacheKey);
    });
    this.packageLocks.set(key.cacheKey, promise);
    return promise;
  }

  async loadCachedExampleBySlug(slug: string): Promise<PackagedExampleBundle | null> {
    const normalizedSlug = slug.trim().toLowerCase();
    if (!isExampleJobSlug(normalizedSlug)) {
      return null;
    }
    const bundle = getExampleJobBundle(normalizedSlug);
    if (!bundle) {
      return null;
    }
    const key = await this.computeCacheKey(bundle);
    const cached = await this.loadCache(bundle.slug, key.fingerprint);
    if (!cached) {
      return null;
    }
    const buffer = await fs.readFile(cached.tarballPath);
    return {
      ...cached,
      buffer,
      tarballPath: cached.tarballPath,
      contentType: DEFAULT_CONTENT_TYPE,
      cached: true
    } satisfies PackagedExampleBundle;
  }

  async listCachedBundles(slug?: string): Promise<ExampleBundleCacheEntry[]> {
    const root = this.cacheRoot;
    const entries: ExampleBundleCacheEntry[] = [];
    const slugs = slug ? [slug.trim().toLowerCase()] : await listDirectories(root);
    for (const candidateSlug of slugs) {
      const slugDir = path.join(root, candidateSlug);
      if (!(await pathExists(slugDir))) {
        continue;
      }
      const fingerprints = await listDirectories(slugDir);
      for (const fingerprint of fingerprints) {
        const entry = await this.loadCacheRecord(candidateSlug, fingerprint);
        if (entry) {
          entries.push(entry);
        }
      }
    }
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async invalidateCache(slug?: string): Promise<void> {
    if (!slug) {
      await removeDir(this.cacheRoot);
      await ensureDir(this.cacheRoot);
      return;
    }
    const normalized = slug.trim().toLowerCase();
    const target = path.join(this.cacheRoot, normalized);
    if (await pathExists(target)) {
      await removeDir(target);
    }
  }

  private async packageExampleInternal(
    bundle: ExampleJobBundle,
    key: CacheKey,
    options: PackageExampleOptions
  ): Promise<PackagedExampleBundle> {
    const progress = options.onProgress;
    emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'queued'));
    emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'resolving'));

    try {
      if (!options.force) {
        const cached = await this.loadCache(bundle.slug, key.fingerprint);
        if (cached) {
          emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'cache-hit'));
          return {
            ...cached,
            buffer: await fs.readFile(cached.tarballPath),
            tarballPath: cached.tarballPath,
            contentType: DEFAULT_CONTENT_TYPE,
            cached: true
          } satisfies PackagedExampleBundle;
        }
      }

      const bundleDir = path.resolve(this.repoRoot, bundle.directory);
      await ensureDir(this.cacheRoot);
      const cacheDir = path.join(this.cacheRoot, bundle.slug, key.fingerprint);
      await ensureDir(cacheDir);

      const skipInstall = await this.shouldSkipInstall(bundleDir, key.lockHash);
      const installMessage = skipInstall
        ? 'No package manifest detected; skipping dependency install.'
        : undefined;
      emitProgress(
        progress,
        buildProgress(bundle.slug, key.fingerprint, 'installing-dependencies', installMessage)
      );
      if (!skipInstall) {
        await this.ensureDependencies(bundleDir, bundle.slug, key.lockHash);
      }

      emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'packaging'));
      const packaged = await this.buildBundle(bundleDir, cacheDir, options);

      const metadata = await this.writeCacheMetadata({
        slug: bundle.slug,
        fingerprint: key.fingerprint,
        cacheDir,
        result: packaged
      });

      emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'completed'));

      const buffer = await fs.readFile(metadata.tarballPath);
      return {
        ...metadata,
        buffer,
        tarballPath: metadata.tarballPath,
        contentType: DEFAULT_CONTENT_TYPE,
        cached: false
      } satisfies PackagedExampleBundle;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'failed', message));
      throw err;
    }
  }

  private async ensureDependencies(bundleDir: string, slug: string, lockHash: string | null): Promise<void> {
    const normalizedSlug = slug.trim().toLowerCase();
    const lockKey = path.join(bundleDir, 'node_modules');
    const existing = this.installLocks.get(lockKey);
    if (existing) {
      await existing;
      return;
    }

    const installPromise = this.ensureDependenciesInternal(bundleDir, normalizedSlug, lockHash).finally(() => {
      this.installLocks.delete(lockKey);
    });
    this.installLocks.set(lockKey, installPromise);
    await installPromise;
  }

  private async ensureDependenciesInternal(
    bundleDir: string,
    slug: string,
    lockHash: string | null
  ): Promise<void> {
    if (lockHash === null && !(await this.hasInstallManifest(bundleDir))) {
      return;
    }
    const nodeModules = path.join(bundleDir, 'node_modules');
    const installStatePath = path.join(this.cacheRoot, slug, 'install.json');
    const installMatches = await this.installStateMatches(installStatePath, nodeModules, lockHash);
    if (installMatches) {
      return;
    }
    if (await pathExists(nodeModules)) {
      await removeDir(nodeModules);
    }
    await execFileAsync(this.installCommand[0], this.installCommand.slice(1), {
      cwd: bundleDir,
      maxBuffer: this.installMaxBuffer
    });
    await writeJsonFile(installStatePath, {
      lockHash,
      command: this.installCommand,
      updatedAt: new Date().toISOString()
    });
  }

  private async installStateMatches(
    installStatePath: string,
    nodeModulesDir: string,
    lockHash: string | null
  ): Promise<boolean> {
    if (!(await pathExists(nodeModulesDir))) {
      return false;
    }
    if (!(await pathExists(installStatePath))) {
      return false;
    }
    try {
      const contents = await readJsonFile<{ lockHash?: string | null }>(installStatePath);
      return contents.lockHash === lockHash;
    } catch {
      return false;
    }
  }

  private async buildBundle(
    bundleDir: string,
    cacheDir: string,
    options: PackageExampleOptions
  ): Promise<PackageResult & { manifestObject: Record<string, JsonValue> }>
  {
    const { context } = await loadBundleContext(bundleDir, { allowScaffold: false });
    const relativeOutputDir = path.relative(context.bundleDir, cacheDir);
    const result = await packageBundle(context, {
      outputDir: relativeOutputDir,
      force: true,
      skipBuild: Boolean(options.skipBuild),
      minify: Boolean(options.minify)
    });
    const manifestObject = JSON.parse(JSON.stringify(context.manifest)) as Record<string, JsonValue>;
    return { ...result, manifestObject };
  }

  private async writeCacheMetadata(input: {
    slug: string;
    fingerprint: string;
    cacheDir: string;
    result: PackageResult & { manifestObject: Record<string, JsonValue> };
  }): Promise<ExampleBundleCacheRecord> {
    const metadataPath = path.join(input.cacheDir, 'metadata.json');
    const tarballPath = input.result.tarballPath;
    const stats = await fs.stat(tarballPath);
    const record: ExampleBundleCacheRecord = {
      slug: input.slug,
      fingerprint: input.fingerprint,
      version: input.result.manifest.version,
      checksum: input.result.checksum,
      filename: path.basename(tarballPath),
      createdAt: new Date().toISOString(),
      size: stats.size,
      manifest: input.result.manifest,
      manifestObject: input.result.manifestObject,
      tarballPath
    };
    await writeJsonFile(metadataPath, record);
    return record;
  }

  private async loadCache(slug: string, fingerprint: string): Promise<ExampleBundleCacheRecord | null> {
    return this.loadCacheRecord(slug, fingerprint);
  }

  private async loadCacheRecord(slug: string, fingerprint: string): Promise<ExampleBundleCacheRecord | null> {
    const metadataPath = path.join(this.cacheRoot, slug, fingerprint, 'metadata.json');
    if (!(await pathExists(metadataPath))) {
      return null;
    }
    try {
      const record = await readJsonFile<ExampleBundleCacheRecord>(metadataPath);
      if (!(await pathExists(record.tarballPath))) {
        return null;
      }
      return record;
    } catch {
      return null;
    }
  }

  private async computeCacheKey(bundle: ExampleJobBundle): Promise<CacheKey> {
    const bundleDir = path.resolve(this.repoRoot, bundle.directory);
    let fingerprint = await computeGitFingerprint(this.repoRoot, bundleDir);
    if (fingerprint) {
      const dirty = await hasWorkingTreeChanges(this.repoRoot, bundleDir);
      if (dirty) {
        fingerprint = await hashDirectory(bundleDir);
      }
    }
    if (!fingerprint) {
      fingerprint = await hashDirectory(bundleDir);
    }
    const lockHash = await computeLockfileHash(bundleDir);
    return {
      slug: bundle.slug,
      fingerprint,
      lockHash,
      cacheKey: `${bundle.slug}:${fingerprint}`
    } satisfies CacheKey;
  }

  private async shouldSkipInstall(bundleDir: string, lockHash: string | null): Promise<boolean> {
    if (lockHash !== null) {
      return false;
    }
    return !(await this.hasInstallManifest(bundleDir));
  }

  private async hasInstallManifest(bundleDir: string): Promise<boolean> {
    for (const candidate of LOCKFILE_CANDIDATES) {
      const candidatePath = path.join(bundleDir, candidate);
      if (await pathExists(candidatePath)) {
        return true;
      }
    }
    return false;
  }
}

type CacheKey = {
  slug: string;
  fingerprint: string;
  lockHash: string | null;
  cacheKey: string;
};

type ExampleBundleCacheRecord = ExampleBundleCacheEntry & {
  tarballPath: string;
};

function resolveRepoRoot(candidate?: string): string {
  if (candidate) {
    return path.resolve(candidate);
  }
  const envRoot = process.env.APPHUB_REPO_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot.trim());
  }
  return path.resolve(__dirname, '..', '..', '..');
}

function resolveCacheRoot(repoRoot: string, candidate?: string): string {
  if (candidate) {
    return path.resolve(candidate);
  }
  const envDir = process.env.APPHUB_EXAMPLE_BUNDLE_CACHE_DIR;
  if (envDir && envDir.trim().length > 0) {
    return path.resolve(envDir.trim());
  }
  return path.resolve(repoRoot, DEFAULT_CACHE_DIRNAME);
}

async function listDirectories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function emitProgress(
  callback: PackageExampleOptions['onProgress'],
  event: ExampleBundlerProgressEvent
) {
  if (callback) {
    callback(event);
  }
}

function buildProgress(
  slug: string,
  fingerprint: string,
  stage: ExampleBundlerProgressStage,
  message?: string,
  details?: Record<string, JsonValue>
): ExampleBundlerProgressEvent {
  return {
    slug,
    fingerprint,
    stage,
    message,
    details
  };
}

async function computeGitFingerprint(repoRoot: string, bundleDir: string): Promise<string | null> {
  const relative = path.relative(repoRoot, bundleDir).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return null;
  }
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', `HEAD:${relative}`], {
      cwd: repoRoot,
      maxBuffer: 4 * 1024 * 1024
    });
    const hash = stdout.trim();
    return hash.length > 0 ? hash : null;
  } catch {
    return null;
  }
}

async function hasWorkingTreeChanges(repoRoot: string, bundleDir: string): Promise<boolean> {
  const relative = path.relative(repoRoot, bundleDir).replace(/\\/g, '/');
  if (!relative || relative.startsWith('..')) {
    return true;
  }
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', relative], {
      cwd: repoRoot,
      maxBuffer: 1 * 1024 * 1024
    });
    return stdout.trim().length > 0;
  } catch {
    return true;
  }
}

async function hashDirectory(root: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = await fg('**/*', {
    cwd: root,
    dot: true,
    onlyFiles: true,
    ignore: ['node_modules/**', 'dist/**', 'artifacts/**', '.git/**', '__pycache__/**', '*.pyc']
  });
  entries.sort();
  for (const entry of entries) {
    const filePath = path.join(root, entry);
    hash.update(entry);
    const buffer = await fs.readFile(filePath);
    hash.update(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  }
  return hash.digest('hex');
}

async function computeLockfileHash(root: string): Promise<string | null> {
  for (const candidate of LOCKFILE_CANDIDATES) {
    const candidatePath = path.join(root, candidate);
    if (await pathExists(candidatePath)) {
      const contents = await fs.readFile(candidatePath);
      const hash = createHash('sha256')
        .update(new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength))
        .digest('hex');
      return `${candidate}:${hash}`;
    }
  }
  return null;
}
