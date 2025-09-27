import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import {
  getExampleJobBundle,
  isExampleJobSlug,
  type ExampleJobBundle
} from '@apphub/examples-registry';
import { loadBundleContext, packageBundle } from './lib/bundle';
import { ensureDir, pathExists, removeDir } from './lib/fs';
import type {
  JobBundleManifest,
  JsonValue,
  PackageResult
} from './types';

const execFileAsync = promisify(execFile);

const DEFAULT_INSTALL_MAX_BUFFER = 32 * 1024 * 1024;
const DEFAULT_CONTENT_TYPE = 'application/gzip';
const LOCKFILE_CANDIDATES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'];
const EXCLUDED_COPY_DIRECTORIES = new Set(['node_modules', 'dist', 'artifacts', '.turbo', '.cache']);

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
  installCommand?: string[];
  installMaxBuffer?: number;
};

export type PackageExampleOptions = {
  force?: boolean;
  skipBuild?: boolean;
  minify?: boolean;
  onProgress?: (event: ExampleBundlerProgressEvent) => void;
};

export type PackagedExampleBundle = {
  slug: string;
  fingerprint: string;
  version: string;
  checksum: string;
  filename: string;
  createdAt: string;
  size: number;
  manifest: JobBundleManifest;
  manifestObject: Record<string, JsonValue>;
  buffer: Buffer;
  tarballPath: string | null;
  contentType: string;
  cached: boolean;
};

export class ExampleBundler {
  private readonly repoRoot: string;
  private readonly installCommand: string[];
  private readonly installMaxBuffer: number;
  private readonly packageLocks = new Map<string, Promise<PackagedExampleBundle>>();

  constructor(options: ExampleBundlerOptions = {}) {
    this.repoRoot = resolveRepoRoot(options.repoRoot);
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
    const key = await this.computeBundleKey(bundle);
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

  private async packageExampleInternal(
    bundle: ExampleJobBundle,
    key: BundleKey,
    options: PackageExampleOptions
  ): Promise<PackagedExampleBundle> {
    const progress = options.onProgress;
    emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'queued'));
    emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'resolving'));

    const bundleDir = path.resolve(this.repoRoot, bundle.directory);
    const workspaceRoot = await createWorkspaceRoot(bundle.slug, key.fingerprint);
    const workspaceDir = path.join(workspaceRoot, 'bundle');

    try {
      await ensureDir(workspaceDir);
      await copyBundleSources(bundleDir, workspaceDir);

      const skipInstall = await this.shouldSkipInstall(workspaceDir);
      const installMessage = skipInstall
        ? 'No package manifest detected; skipping dependency install.'
        : undefined;
      emitProgress(
        progress,
        buildProgress(bundle.slug, key.fingerprint, 'installing-dependencies', installMessage)
      );
      if (!skipInstall) {
        await this.installDependencies(workspaceDir);
      }

      await populateWorkspacePackages(this.repoRoot, workspaceDir);

      emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'packaging'));
      const packaged = await this.buildBundle(workspaceDir, options);

      const stats = await fs.stat(packaged.tarballPath);
      const buffer = await fs.readFile(packaged.tarballPath);
      const now = new Date().toISOString();

      const result: PackagedExampleBundle = {
        slug: bundle.slug,
        fingerprint: key.fingerprint,
        version: packaged.manifest.version,
        checksum: packaged.checksum,
        filename: path.basename(packaged.tarballPath),
        createdAt: now,
        size: stats.size,
        manifest: packaged.manifest,
        manifestObject: packaged.manifestObject,
        buffer,
        tarballPath: null,
        contentType: DEFAULT_CONTENT_TYPE,
        cached: false
      } satisfies PackagedExampleBundle;

      emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'completed'));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitProgress(progress, buildProgress(bundle.slug, key.fingerprint, 'failed', message));
      throw err;
    } finally {
      await removeDir(workspaceRoot).catch(() => {});
    }
  }

  private async installDependencies(workspaceDir: string): Promise<void> {
    const command = await determineInstallCommand(workspaceDir, this.installCommand);
    if (!command) {
      return;
    }
    await execFileAsync(command[0], command.slice(1), {
      cwd: workspaceDir,
      maxBuffer: this.installMaxBuffer
    });
  }

  private async buildBundle(
    bundleDir: string,
    options: PackageExampleOptions
  ): Promise<PackageResult & { manifestObject: Record<string, JsonValue> }>
  {
    const { context } = await loadBundleContext(bundleDir, { allowScaffold: false });
    const result = await packageBundle(context, {
      force: true,
      skipBuild: Boolean(options.skipBuild),
      minify: Boolean(options.minify)
    });
    const manifestObject = JSON.parse(JSON.stringify(context.manifest)) as Record<string, JsonValue>;
    return { ...result, manifestObject };
  }

  private async computeBundleKey(bundle: ExampleJobBundle): Promise<BundleKey> {
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
    return {
      slug: bundle.slug,
      fingerprint,
      cacheKey: `${bundle.slug}:${fingerprint}`
    } satisfies BundleKey;
  }

  private async shouldSkipInstall(workspaceDir: string): Promise<boolean> {
    for (const candidate of LOCKFILE_CANDIDATES) {
      if (await pathExists(path.join(workspaceDir, candidate))) {
        return false;
      }
    }
    return !(await pathExists(path.join(workspaceDir, 'package.json')));
  }
}

type BundleKey = {
  slug: string;
  fingerprint: string;
  cacheKey: string;
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

async function createWorkspaceRoot(slug: string, fingerprint: string): Promise<string> {
  const sanitizedSlug = sanitizeTempSegment(slug);
  const prefix = `apphub-example-${sanitizedSlug}-${fingerprint.slice(0, 8)}-`;
  const base = path.join(os.tmpdir(), prefix);
  return fs.mkdtemp(base);
}

async function populateWorkspacePackages(repoRoot: string, workspaceDir: string): Promise<void> {
  const packagesRoot = path.join(repoRoot, 'packages');
  const rootNodeModules = path.join(repoRoot, 'node_modules');
  let entries: Dirent[];
  try {
    entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const nodeModulesRoot = path.join(workspaceDir, 'node_modules');
  const scopedRoot = path.join(nodeModulesRoot, '@apphub');
  await ensureDir(scopedRoot);

  const copiedThirdPartyDeps = new Set<string>();

  const copyThirdPartyDependency = async (moduleName: string) => {
    if (!moduleName || copiedThirdPartyDeps.has(moduleName)) {
      return;
    }
    const segments = moduleName.startsWith('@') ? moduleName.split('/') : [moduleName];
    const sourceDir = path.join(rootNodeModules, ...segments);
    try {
      const stats = await fs.stat(sourceDir);
      if (!stats.isDirectory()) {
        return;
      }
    } catch {
      return;
  }

  const rootScopedSource = path.join(rootNodeModules, '@apphub');
  try {
    const scopedEntries = await fs.readdir(rootScopedSource, { withFileTypes: true });
    for (const entry of scopedEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const sourceDir = path.join(rootScopedSource, entry.name);
      const targetDir = path.join(scopedRoot, entry.name);
      const alreadyExists = await pathExists(targetDir);
      if (alreadyExists) {
        continue;
      }
      await ensureDir(path.dirname(targetDir));
      await fs.cp(sourceDir, targetDir, {
        recursive: true,
        dereference: false
      });
    }
  } catch {
    // Ignore missing scoped dependencies; workspace copies may already cover them.
  }

    const targetDir = path.join(nodeModulesRoot, ...segments);
    await ensureDir(path.dirname(targetDir));
    await removeDir(targetDir).catch(() => {});
    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      dereference: false
    });
    copiedThirdPartyDeps.add(moduleName);
  };

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const sourceDir = path.join(packagesRoot, entry.name);
    const packageJsonPath = path.join(sourceDir, 'package.json');
    if (!(await pathExists(packageJsonPath))) {
      continue;
    }
    const targetDir = path.join(scopedRoot, entry.name);
    await removeDir(targetDir).catch(() => {});
    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      dereference: false,
      filter: (src) => !isNodeModulesPath(src)
    });

    try {
      const packageJsonRaw = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonRaw) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      const dependencyNames = new Set<string>([
        ...Object.keys(packageJson.dependencies ?? {}),
        ...Object.keys(packageJson.peerDependencies ?? {})
      ]);
      for (const depName of dependencyNames) {
        if (!depName || depName.startsWith('@apphub/')) {
          continue;
        }
        await copyThirdPartyDependency(depName);
      }
    } catch {
      // Ignore dependency resolution errors; missing packages will surface during build.
    }
  }
}

function isNodeModulesPath(candidate: string): boolean {
  const segments = candidate.split(path.sep);
  return segments.includes('node_modules');
}

async function copyBundleSources(sourceDir: string, targetDir: string): Promise<void> {
  await fs.cp(sourceDir, targetDir, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      const name = path.basename(src);
      if (EXCLUDED_COPY_DIRECTORIES.has(name)) {
        const relative = path.relative(sourceDir, src);
        if (!relative || !relative.startsWith('..')) {
          return false;
        }
      }
      return true;
    }
  });
}

async function determineInstallCommand(
  workspaceDir: string,
  fallback: string[]
): Promise<string[] | null> {
  const hasPackageLock = await pathExists(path.join(workspaceDir, 'package-lock.json'));
  const hasPnpmLock = await pathExists(path.join(workspaceDir, 'pnpm-lock.yaml'));
  const hasYarnLock = await pathExists(path.join(workspaceDir, 'yarn.lock'));
  const hasPackageJson = await pathExists(path.join(workspaceDir, 'package.json'));

  if (hasPackageLock) {
    return ['npm', 'ci'];
  }
  if (hasPnpmLock) {
    return ['pnpm', 'install', '--frozen-lockfile'];
  }
  if (hasYarnLock) {
    return ['yarn', 'install', '--frozen-lockfile'];
  }
  if (hasPackageJson) {
    return fallback;
  }
  return null;
}

function sanitizeTempSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase() || 'bundle';
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
