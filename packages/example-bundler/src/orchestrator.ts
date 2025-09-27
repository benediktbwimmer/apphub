import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import fg from 'fast-glob';
import simpleGit from 'simple-git';
import {
  getExampleJobBundle,
  isExampleJobSlug,
  readExampleDescriptor,
  resolveBundleManifests,
  type ExampleJobBundle
} from '@apphub/examples';
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

export type ExampleDescriptorReference = {
  module: string;
  path?: string;
  repo?: string;
  ref?: string;
  commit?: string;
  configPath?: string;
};

export type ExampleDescriptorBundleInput = {
  slug: string;
  descriptor: ExampleDescriptorReference;
};

type DescriptorWorkspace = {
  workspaceRoot: string;
  configPath: string;
  cleanup: () => Promise<void>;
};

type ResolvedExampleBundle = {
  slug: string;
  bundleDir: string;
  workspaceRoot: string | null;
  descriptorPath?: string;
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
    if (!(await isExampleJobSlug(normalizedSlug))) {
      throw new Error(`Unknown example bundle slug: ${slug}`);
    }
    const bundle = await getExampleJobBundle(normalizedSlug);
    if (!bundle) {
      throw new Error(`Unknown example bundle slug: ${slug}`);
    }
    return this.packageExample(bundle, options);
  }

  async packageExample(
    bundle: ExampleJobBundle,
    options: PackageExampleOptions = {}
  ): Promise<PackagedExampleBundle> {
    const bundleDir = path.resolve(this.repoRoot, bundle.directory);
    const resolved: ResolvedExampleBundle = {
      slug: bundle.slug,
      bundleDir,
      workspaceRoot: this.repoRoot
    };
    return this.packageResolvedBundle(resolved, options);
  }

  async packageExampleByDescriptor(
    input: ExampleDescriptorBundleInput,
    options: PackageExampleOptions = {}
  ): Promise<PackagedExampleBundle> {
    const slug = input.slug?.trim();
    if (!slug) {
      throw new Error('Descriptor bundle requires a slug');
    }

    const workspace = await this.resolveDescriptorWorkspace(input.descriptor);
    try {
      const descriptorFile = await readExampleDescriptor(workspace.configPath);
      const bundleManifests = resolveBundleManifests(descriptorFile).filter((entry) => {
        const kind = entry.kind ?? 'bundle';
        return kind === 'bundle';
      });

      if (bundleManifests.length === 0) {
        throw new Error('Descriptor does not declare any bundle manifests');
      }

      const targetSlug = slug.toLowerCase();
      let bundleConfigPath: string | null = null;
      let resolvedSlug = slug;

      for (const manifest of bundleManifests) {
        const referencedSlug = await readBundleSlug(manifest.absolutePath);
        if (!referencedSlug) {
          continue;
        }
        if (referencedSlug.trim().toLowerCase() === targetSlug) {
          resolvedSlug = referencedSlug.trim();
          bundleConfigPath = manifest.absolutePath;
          break;
        }
      }

      if (!bundleConfigPath) {
        throw new Error(`Descriptor does not define a bundle for slug ${slug}`);
      }

      const bundleDir = path.dirname(bundleConfigPath);
      const resolved: ResolvedExampleBundle = {
        slug: resolvedSlug,
        bundleDir,
        workspaceRoot: workspace.workspaceRoot,
        descriptorPath: descriptorFile.configPath
      };
      return await this.packageResolvedBundle(resolved, options);
    } finally {
      await workspace.cleanup();
    }
  }

  private async packageResolvedBundle(
    resolved: ResolvedExampleBundle,
    options: PackageExampleOptions
  ): Promise<PackagedExampleBundle> {
    const key = await this.computeBundleKey(resolved);
    const existing = this.packageLocks.get(key.cacheKey);
    if (existing) {
      return existing;
    }
    const promise = this.packageExampleInternal(resolved, key, options).finally(() => {
      this.packageLocks.delete(key.cacheKey);
    });
    this.packageLocks.set(key.cacheKey, promise);
    return promise;
  }

  private async resolveDescriptorWorkspace(
    descriptor: ExampleDescriptorReference
  ): Promise<DescriptorWorkspace> {
    const repo = descriptor.repo?.trim();
    const localPath = descriptor.path?.trim();
    const configOverride = descriptor.configPath?.trim();

    if ((repo ? 1 : 0) + (localPath ? 1 : 0) !== 1) {
      throw new Error('Descriptor reference must include exactly one of "repo" or "path"');
    }

    if (repo) {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-example-descriptor-'));
      const git = simpleGit();
      const cloneArgs: string[] = [];
      if (!descriptor.commit) {
        cloneArgs.push('--depth', '1');
      }
      if (descriptor.ref) {
        cloneArgs.push('--branch', descriptor.ref);
        cloneArgs.push('--single-branch');
      }
      await git.clone(repo, tempDir, cloneArgs);

      const repoGit = simpleGit(tempDir);
      if (descriptor.commit) {
        await repoGit.checkout(descriptor.commit);
      } else if (descriptor.ref) {
        await repoGit.checkout(descriptor.ref);
      }

      const relativeConfig = configOverride ?? 'config.json';
      const configPath = path.resolve(tempDir, relativeConfig);
      if (!(await pathExists(configPath))) {
        throw new Error(`Descriptor config not found at ${relativeConfig}`);
      }

      return {
        workspaceRoot: tempDir,
        configPath,
        cleanup: async () => {
          await removeDir(tempDir).catch(() => {});
        }
      } satisfies DescriptorWorkspace;
    }

    const resolvedPath = path.isAbsolute(localPath!)
      ? localPath!
      : path.resolve(this.repoRoot, localPath!);
    let stats;
    try {
      stats = await fs.stat(resolvedPath);
    } catch (err) {
      throw new Error(`Descriptor path not found: ${resolvedPath}`);
    }

    let configPath: string;
    if (stats.isDirectory()) {
      const relativeConfig = configOverride ?? 'config.json';
      configPath = path.resolve(resolvedPath, relativeConfig);
    } else {
      configPath = resolvedPath;
    }

    if (!(await pathExists(configPath))) {
      throw new Error(`Descriptor config not found at ${configPath}`);
    }

    const configDir = path.dirname(configPath);
    const relativeToRepo = path.relative(this.repoRoot, configDir);
    const workspaceRoot = relativeToRepo && !relativeToRepo.startsWith('..') && !path.isAbsolute(relativeToRepo)
      ? this.repoRoot
      : configDir;

    return {
      workspaceRoot,
      configPath,
      cleanup: async () => {}
    } satisfies DescriptorWorkspace;
  }

  private async packageExampleInternal(
    resolved: ResolvedExampleBundle,
    key: BundleKey,
    options: PackageExampleOptions
  ): Promise<PackagedExampleBundle> {
    const progress = options.onProgress;
    emitProgress(progress, buildProgress(resolved.slug, key.fingerprint, 'queued'));
    emitProgress(progress, buildProgress(resolved.slug, key.fingerprint, 'resolving'));

    const bundleDir = resolved.bundleDir;
    const workspaceRoot = await createWorkspaceRoot(resolved.slug, key.fingerprint);
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
        buildProgress(resolved.slug, key.fingerprint, 'installing-dependencies', installMessage)
      );
      if (!skipInstall) {
        await this.installDependencies(workspaceDir);
      }

      await populateWorkspacePackages(this.repoRoot, workspaceDir);

      emitProgress(progress, buildProgress(resolved.slug, key.fingerprint, 'packaging'));
      const packaged = await this.buildBundle(workspaceDir, options);

      const stats = await fs.stat(packaged.tarballPath);
      const buffer = await fs.readFile(packaged.tarballPath);
      const now = new Date().toISOString();

      const result: PackagedExampleBundle = {
        slug: resolved.slug,
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

      emitProgress(progress, buildProgress(resolved.slug, key.fingerprint, 'completed'));

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emitProgress(progress, buildProgress(resolved.slug, key.fingerprint, 'failed', message));
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

  private async computeBundleKey(resolved: ResolvedExampleBundle): Promise<BundleKey> {
    const bundleDir = resolved.bundleDir;
    let fingerprint = await computeGitFingerprint(resolved.workspaceRoot, bundleDir);
    if (fingerprint) {
      const dirty = await hasWorkingTreeChanges(resolved.workspaceRoot, bundleDir);
      if (dirty) {
        fingerprint = null;
      }
    }
    if (!fingerprint) {
      fingerprint = await computeContentFingerprint(bundleDir, resolved.descriptorPath);
    }
    return {
      slug: resolved.slug,
      fingerprint,
      cacheKey: `${resolved.slug}:${fingerprint}`
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
  const fallback = path.resolve(__dirname, '..', '..', '..');
  if (path.basename(fallback) === 'packages') {
    return path.resolve(fallback, '..');
  }
  return fallback;
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

    const targetDir = path.join(nodeModulesRoot, ...segments);
    await ensureDir(path.dirname(targetDir));
    await removeDir(targetDir).catch(() => {});
    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      dereference: false
    });
    copiedThirdPartyDeps.add(moduleName);
  };

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

    await ensureWorkspacePackageEntryPoints(targetDir);

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

async function ensureWorkspacePackageEntryPoints(packageDir: string): Promise<void> {
  const packageJsonPath = path.join(packageDir, 'package.json');
  let raw: string;
  try {
    raw = await fs.readFile(packageJsonPath, 'utf8');
  } catch {
    return;
  }

  let updated = false;
  let parsed: {
    main?: string;
    types?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }

  const mainEntry = typeof parsed.main === 'string' ? parsed.main.trim() : '';
  if (mainEntry) {
    const resolvedMain = path.join(packageDir, mainEntry);
    if (!(await pathExists(resolvedMain))) {
      const fallbackMain = resolveSourceFallback(mainEntry) ?? 'src/index.ts';
      const fallbackPath = path.join(packageDir, fallbackMain);
      if (await pathExists(fallbackPath)) {
        parsed.main = fallbackMain.replace(/\\/g, '/');
        updated = true;
      }
    }
  }

  const typesEntry = typeof parsed.types === 'string' ? parsed.types.trim() : '';
  if (typesEntry) {
    const resolvedTypes = path.join(packageDir, typesEntry);
    if (!(await pathExists(resolvedTypes))) {
      const fallbackTypes = resolveSourceFallback(typesEntry) ?? 'src/index.ts';
      const fallbackTypesPath = path.join(packageDir, fallbackTypes);
      if (await pathExists(fallbackTypesPath)) {
        parsed.types = fallbackTypes.replace(/\\/g, '/');
        updated = true;
      }
    }
  }

  if (updated) {
    await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  }
}

function resolveSourceFallback(entry: string): string | null {
  if (!entry) {
    return null;
  }
  const normalized = entry.replace(/\\/g, '/');
  if (normalized.startsWith('dist/')) {
    return normalized.replace(/^dist\//, 'src/').replace(/\.d\.ts$/i, '.ts').replace(/\.js$/i, '.ts');
  }
  return null;
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

async function computeGitFingerprint(repoRoot: string | null, bundleDir: string): Promise<string | null> {
  if (!repoRoot) {
    return null;
  }
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

async function hasWorkingTreeChanges(repoRoot: string | null, bundleDir: string): Promise<boolean> {
  if (!repoRoot) {
    return true;
  }
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
    try {
      const buffer = await fs.readFile(filePath);
      hash.update(entry);
      hash.update(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        continue;
      }
      throw err;
    }
  }
  return hash.digest('hex');
}

async function computeContentFingerprint(bundleDir: string, descriptorPath?: string): Promise<string> {
  const hash = createHash('sha256');
  if (descriptorPath) {
    try {
      const descriptorContents = await fs.readFile(descriptorPath);
      hash.update(descriptorContents);
    } catch {
      // ignore missing descriptor file; fallback to directory hash only
    }
  }
  const directoryHash = await hashDirectory(bundleDir);
  hash.update(directoryHash);
  return hash.digest('hex');
}

async function readBundleSlug(configPath: string): Promise<string | null> {
  try {
    const contents = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents) as { slug?: unknown };
    if (typeof parsed.slug === 'string') {
      const slug = parsed.slug.trim();
      return slug.length > 0 ? slug : null;
    }
  } catch {
    // ignore parse errors; caller will handle missing slug
  }
  return null;
}
