import { createHash } from 'node:crypto';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import * as tar from 'tar';
import fg from 'fast-glob';
import esbuild from 'esbuild';
import {
  ensureDir,
  pathExists,
  removeDir,
  writeFile
} from './fs';
import { readJsonFile, writeJsonFile } from './json';
import {
  DEFAULT_ARTIFACT_DIR,
  DEFAULT_CONFIG_FILENAME,
  DEFAULT_FILES,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_OUT_DIR,
  DEFAULT_PYTHON_ENTRY,
  DEFAULT_PYTHON_REQUIREMENTS_PATH,
  DEFAULT_SAMPLE_INPUT_PATH,
  DEFAULT_SOURCE_ENTRY,
  loadBundleConfig,
  normalizeBundleConfig,
  resolvePath,
  saveBundleConfig
} from './config';
import { validateManifest } from './manifest';
import type {
  BundleConfig,
  JobBundleManifest,
  NormalizedBundleConfig,
  PackageResult
} from '../types';

export type ScaffoldOptions = {
  slug?: string;
  configPath?: string;
};

export type LoadBundleOptions = {
  configPath?: string;
  slugOverride?: string;
  allowScaffold?: boolean;
};

export type BuildOptions = {
  minify?: boolean;
  skipBuild?: boolean;
};

export type PackageOptions = BuildOptions & {
  outputDir?: string;
  filename?: string;
  force?: boolean;
};

export type BundleContext = {
  config: NormalizedBundleConfig;
  manifest: JobBundleManifest;
  bundleDir: string;
  manifestPath: string;
  configPath: string;
};

const MANIFEST_DOC_URL = 'docs/job-bundles.md';

function sanitizeSlug(candidate: string): string {
  const normalized = candidate
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'job-bundle';
}

function deriveSlugFromDir(bundleDir: string): string {
  const stem = path.basename(bundleDir);
  return sanitizeSlug(stem || 'job-bundle');
}

async function scaffoldManifest(bundleDir: string, manifestPath: string, slug: string): Promise<void> {
  if (await pathExists(manifestPath)) {
    return;
  }
  const manifest: JobBundleManifest = {
    name: slug
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    version: '0.1.0',
    entry: path.join(DEFAULT_OUT_DIR, 'index.js').replace(/\\/g, '/'),
    runtime: 'node18',
    pythonEntry: DEFAULT_PYTHON_ENTRY.replace(/\\/g, '/'),
    description: 'Describe what this job bundle does.',
    capabilities: []
  };
  await writeJsonFile(manifestPath, manifest);
}

async function scaffoldNodeSource(bundleDir: string, sourceEntry: string): Promise<string | null> {
  const resolvedEntry = resolvePath(bundleDir, sourceEntry);
  if (await pathExists(resolvedEntry)) {
    return null;
  }

  const template = `/**
 * Example job handler. Update this file to implement your bundle logic.
 */

type JobRunResult = {
  status?: 'succeeded' | 'failed' | 'canceled' | 'expired';
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  context.logger('Running sample job bundle', {
    parameters: context.parameters
  });
  await context.update({ sample: 'progress' });
  return {
    status: 'succeeded',
    result: {
      echoed: context.parameters
    }
  } satisfies JobRunResult;
}

export default handler;
`;

  await writeFile(resolvedEntry, template);
  return path.relative(bundleDir, resolvedEntry);
}

async function scaffoldPythonSource(bundleDir: string, pythonEntry: string): Promise<string | null> {
  const resolvedEntry = resolvePath(bundleDir, pythonEntry);
  if (await pathExists(resolvedEntry)) {
    return null;
  }

  const template = `"""Example job handler. Update this file to implement your bundle logic."""
from __future__ import annotations

from typing import Any, Dict

JobResult = Dict[str, Any]


async def handler(context) -> JobResult:
    """Entrypoint for the AppHub Python runtime."""

    context.logger(
        "Running sample job bundle",
        {"parameters": context.parameters},
    )
    await context.update({"sample": "progress"})
    return {
        "status": "succeeded",
        "result": {"echoed": context.parameters},
    }
`;

  await writeFile(resolvedEntry, template);
  return path.relative(bundleDir, resolvedEntry);
}

function isPythonRuntime(runtime: string): boolean {
  return /^python/i.test(runtime);
}

function resolveRuntime(manifest: JobBundleManifest): string {
  const runtime = typeof manifest.runtime === 'string' ? manifest.runtime.trim() : '';
  return runtime || 'node18';
}

function toBundleRelative(bundleDir: string, targetPath: string): string {
  return path.relative(bundleDir, targetPath).replace(/\\/g, '/');
}

function getPythonEntry(context: BundleContext): string {
  const fromManifest =
    typeof context.manifest.pythonEntry === 'string' ? context.manifest.pythonEntry.trim() : '';
  if (fromManifest) {
    return fromManifest;
  }
  const fromConfig = typeof context.config.pythonEntry === 'string' ? context.config.pythonEntry.trim() : '';
  if (fromConfig) {
    return fromConfig;
  }
  throw new Error('Python runtime requires `pythonEntry` to be set in the manifest.');
}

const BUILTIN_MODULE_NAMES = new Set<string>(
  builtinModules.flatMap((entry) => {
    if (entry.startsWith('node:')) {
      const stripped = entry.slice('node:'.length);
      return stripped ? [entry, stripped] : [entry];
    }
    return [entry, `node:${entry}`];
  })
);

function isBuiltinModuleName(candidate: string): boolean {
  if (!candidate) {
    return false;
  }
  return BUILTIN_MODULE_NAMES.has(candidate);
}

function normalizeRuntimeModuleSpecifier(specifier: string): string {
  const trimmed = specifier.replace(/^node:/, '').trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed.startsWith('@')) {
    const segments = trimmed.split('/');
    if (segments.length >= 2) {
      return `${segments[0]}/${segments[1]}`;
    }
    return '';
  }
  const [head] = trimmed.split('/');
  return head ?? '';
}

async function scaffoldTest(bundleDir: string, runtime: string): Promise<string[]> {
  const testDir = resolvePath(bundleDir, 'tests');
  await ensureDir(testDir);
  const created: string[] = [];
  const sampleInputPath = resolvePath(bundleDir, DEFAULT_SAMPLE_INPUT_PATH);
  if (!(await pathExists(sampleInputPath))) {
    await writeJsonFile(sampleInputPath, { message: 'Hello from sample input' });
    created.push(path.relative(bundleDir, sampleInputPath));
  }
  if (!isPythonRuntime(runtime)) {
    const testPath = resolvePath(bundleDir, path.join('tests', 'handler.test.ts'));
    if (!(await pathExists(testPath))) {
      const content = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handler } from '../src/index';

const context = {
  parameters: { message: 'hi' },
  logger: () => undefined,
  update: async () => undefined
};

test('handler echoes parameters', async () => {
  const result = await handler(context);
  assert.equal(result.status ?? 'succeeded', 'succeeded');
});
`;
      await writeFile(testPath, content);
      created.push(path.relative(bundleDir, testPath));
    }
  }
  return created;
}

async function scaffoldConfig(
  bundleDir: string,
  configPath: string,
  slug: string
): Promise<void> {
  if (await pathExists(configPath)) {
    return;
  }
  const config: BundleConfig = {
    slug,
    entry: DEFAULT_SOURCE_ENTRY,
    outDir: DEFAULT_OUT_DIR,
    manifestPath: DEFAULT_MANIFEST_PATH,
    artifactDir: DEFAULT_ARTIFACT_DIR,
    files: DEFAULT_FILES,
    tests: {
      sampleInputPath: DEFAULT_SAMPLE_INPUT_PATH
    },
    pythonEntry: DEFAULT_PYTHON_ENTRY,
    pythonRequirementsPath: DEFAULT_PYTHON_REQUIREMENTS_PATH
  };
  await writeJsonFile(configPath, config);
}

export async function scaffoldBundle(
  bundleDir: string,
  options: ScaffoldOptions = {}
): Promise<{ created: string[]; config: NormalizedBundleConfig; manifest: JobBundleManifest }>
{
  const slug = options.slug ? sanitizeSlug(options.slug) : deriveSlugFromDir(bundleDir);
  const configPath = path.resolve(bundleDir, options.configPath ?? DEFAULT_CONFIG_FILENAME);
  const created: string[] = [];

  if (!(await pathExists(configPath))) {
    await scaffoldConfig(bundleDir, configPath, slug);
    created.push(toBundleRelative(bundleDir, configPath));
  }

  const rawConfig = (await readJsonFile<BundleConfig>(configPath)) as BundleConfig;
  const manifestRelative = rawConfig.manifestPath?.trim() || DEFAULT_MANIFEST_PATH;
  const manifestPath = path.resolve(bundleDir, manifestRelative);

  if (!(await pathExists(manifestPath))) {
    await scaffoldManifest(bundleDir, manifestPath, slug);
    created.push(toBundleRelative(bundleDir, manifestPath));
  }

  const manifest = await loadManifest(bundleDir, manifestRelative);
  const runtime = resolveRuntime(manifest);

  if (isPythonRuntime(runtime)) {
    const pythonEntry = rawConfig.pythonEntry?.trim() || DEFAULT_PYTHON_ENTRY;
    const pythonCreated = await scaffoldPythonSource(bundleDir, pythonEntry);
    if (pythonCreated) {
      created.push(pythonCreated);
    }
  } else {
    const sourceEntry = rawConfig.entry?.trim() || DEFAULT_SOURCE_ENTRY;
    const nodeCreated = await scaffoldNodeSource(bundleDir, sourceEntry);
    if (nodeCreated) {
      created.push(nodeCreated);
    }
  }

  const testCreated = await scaffoldTest(bundleDir, runtime);
  created.push(...testCreated);

  const config = normalizeBundleConfig(bundleDir, rawConfig);
  const normalizedManifest = await loadManifest(bundleDir, config.manifestPath);

  return { created, config, manifest: normalizedManifest };
}

export async function loadManifest(bundleDir: string, manifestPath: string): Promise<JobBundleManifest> {
  const resolved = resolvePath(bundleDir, manifestPath);
  if (!(await pathExists(resolved))) {
    throw new Error(
      `Manifest file not found at ${manifestPath}. Run \`apphub jobs package --init\` to scaffold a bundle.`
    );
  }
  const manifest = await readJsonFile<JobBundleManifest>(resolved);
  const validated = validateManifest(manifest);
  return validated;
}

export async function loadBundleContext(
  bundleDir: string,
  options: LoadBundleOptions = {}
): Promise<{ context: BundleContext; created: string[] }> {
  const configPath = path.resolve(bundleDir, options.configPath ?? DEFAULT_CONFIG_FILENAME);
  let config = await loadBundleConfig(bundleDir, options.configPath);
  const created: string[] = [];

  if (!config) {
    if (options.allowScaffold) {
      const scaffolded = await scaffoldBundle(bundleDir, {
        slug: options.slugOverride,
        configPath: options.configPath
      });
      created.push(...scaffolded.created);
      config = {
        slug: scaffolded.config.slug,
        entry: scaffolded.config.entry,
        outDir: scaffolded.config.outDir,
        manifestPath: scaffolded.config.manifestPath,
        artifactDir: scaffolded.config.artifactDir,
        files: scaffolded.config.files,
        tests: scaffolded.config.tests,
        pythonEntry: scaffolded.config.pythonEntry,
        pythonRequirementsPath: scaffolded.config.pythonRequirementsPath
      };
    } else {
      throw new Error(
        `Bundle config not found at ${path.relative(bundleDir, configPath)}. Use --init to scaffold new bundle files.`
      );
    }
  }

  const overrides: Partial<BundleConfig> = {};
  if (options.slugOverride) {
    overrides.slug = options.slugOverride;
  }

  const normalized = normalizeBundleConfig(bundleDir, config, overrides);
  if (config.slug !== normalized.slug) {
    await saveBundleConfig(bundleDir, { ...config, slug: normalized.slug }, options.configPath);
  }
  const manifest = await loadManifest(bundleDir, normalized.manifestPath);

  return {
    context: {
      bundleDir,
      config: normalized,
      manifest,
      manifestPath: resolvePath(bundleDir, normalized.manifestPath),
      configPath
    },
    created
  };
}

async function ensureBuildTarget(context: BundleContext): Promise<void> {
  const runtime = resolveRuntime(context.manifest);
  if (isPythonRuntime(runtime)) {
    const pythonEntry = getPythonEntry(context);
    const pythonEntryPath = resolvePath(context.bundleDir, pythonEntry);
    if (!(await pathExists(pythonEntryPath))) {
      throw new Error(
        `Python entry file not found at ${pythonEntry}. Update manifest.pythonEntry or create the file.`
      );
    }
    return;
  }

  const sourceEntry = resolvePath(context.bundleDir, context.config.entry);
  if (!(await pathExists(sourceEntry))) {
    throw new Error(
      `Source entry file not found at ${context.config.entry}. Update apphub.bundle.json or create the file.`
    );
  }
}

async function ensureRuntimeDependencies(context: BundleContext): Promise<void> {
  const dependencies = context.config.runtimeDependencies;
  if (dependencies.length === 0) {
    return;
  }

  const runtime = resolveRuntime(context.manifest);
  if (isPythonRuntime(runtime)) {
    return;
  }

  const sourceRoot = path.join(context.bundleDir, 'node_modules');
  if (!(await pathExists(sourceRoot))) {
    throw new Error(
      'Runtime dependencies requested, but no node_modules directory was found. Install dependencies before packaging.'
    );
  }

  const targetRoot = path.join(context.bundleDir, context.config.outDir, 'node_modules');
  await ensureDir(targetRoot);

  const seen = new Set<string>();

  const copyDependency = async (specifier: string, optional = false) => {
    const normalized = normalizeRuntimeModuleSpecifier(specifier);
    if (!normalized) {
      return;
    }
    if (seen.has(normalized)) {
      return;
    }
    if (isBuiltinModuleName(normalized) || isBuiltinModuleName(`node:${normalized}`)) {
      return;
    }

    const segments = normalized.startsWith('@') ? normalized.split('/') : [normalized];
    const sourceDir = path.join(sourceRoot, ...segments);
    let stats: Stats;
    try {
      stats = await fs.stat(sourceDir);
    } catch {
      if (optional) {
        return;
      }
      throw new Error(
        `Runtime dependency "${normalized}" was not found in workspace node_modules (${sourceDir}). Install it before bundling.`
      );
    }
    if (!stats.isDirectory()) {
      return;
    }

    const targetDir = path.join(targetRoot, ...segments);
    await ensureDir(path.dirname(targetDir));
    await removeDir(targetDir).catch(() => {});
    await fs.cp(sourceDir, targetDir, {
      recursive: true,
      dereference: false
    });

    if (normalized === 'debug') {
      await rewriteDebugModuleForSandbox(targetDir);
    }
    if (normalized === 'msgpackr') {
      await rewriteMsgpackrModuleForSandbox(targetDir);
    }
    if (normalized === 'msgpackr-extract') {
      await rewriteMsgpackrExtractForSandbox(targetDir);
    }

    seen.add(normalized);

    const packageJsonPath = path.join(sourceDir, 'package.json');
    let packageJsonRaw: string;
    try {
      packageJsonRaw = await fs.readFile(packageJsonPath, 'utf8');
    } catch {
      return;
    }

    let parsed: {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    try {
      parsed = JSON.parse(packageJsonRaw);
    } catch {
      return;
    }

    const nested = new Map<string, boolean>();
    for (const entry of Object.keys(parsed.dependencies ?? {})) {
      nested.set(entry, false);
    }
    for (const entry of Object.keys(parsed.optionalDependencies ?? {})) {
      if (!nested.has(entry)) {
        nested.set(entry, true);
      }
    }
    for (const entry of Object.keys(parsed.peerDependencies ?? {})) {
      if (!nested.has(entry)) {
        nested.set(entry, true);
      }
    }
    for (const [entry, isOptional] of nested) {
      await copyDependency(entry, isOptional);
    }
};

  for (const dependency of dependencies) {
    await copyDependency(dependency);
  }
}

async function rewriteDebugModuleForSandbox(moduleDir: string): Promise<void> {
  const indexPath = path.join(moduleDir, 'src', 'index.js');
  if (await pathExists(indexPath)) {
    const content = "module.exports = require('./browser.js');\n";
    await fs.writeFile(indexPath, content, 'utf8');
  }

  const packageJsonPath = path.join(moduleDir, 'package.json');
  if (await pathExists(packageJsonPath)) {
    try {
      const raw = await fs.readFile(packageJsonPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      parsed.main = './src/browser.js';
      await fs.writeFile(packageJsonPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    } catch {
      // Ignore malformed package metadata; rewrites are best-effort.
    }
  }
}

async function rewriteMsgpackrModuleForSandbox(moduleDir: string): Promise<void> {
  const nodeCjsPath = path.join(moduleDir, 'dist', 'node.cjs');
  if (await pathExists(nodeCjsPath)) {
    try {
      const raw = await fs.readFile(nodeCjsPath, 'utf8');
      const patched = raw.replace(
        "var module$1 = require('module');",
        "var module$1 = { createRequire: function () { throw new Error('module access disabled inside sandbox'); } };"
      );
      if (patched !== raw) {
        await fs.writeFile(nodeCjsPath, patched, 'utf8');
      }
    } catch {
      // Ignore failures; fallback to default module code if rewrite is not possible.
    }
  }

  const gypLoaderPath = path.join(moduleDir, '..', 'node-gyp-build-optional-packages', 'node-gyp-build.js');
  if (await pathExists(gypLoaderPath)) {
    try {
      const raw = await fs.readFile(gypLoaderPath, 'utf8');
      const pattern = "var prebuildPackage = path.dirname(require('module').createRequire";
      if (raw.includes(pattern)) {
        const patched = raw.replace(
          /var prebuildPackage = path\.dirname\(require\('module'\)\.createRequire\([^)]*\)\.resolve\(platformPackage\)\);/,
          'throw new Error("module access disabled inside sandbox");'
        );
        await fs.writeFile(gypLoaderPath, patched, 'utf8');
      }
    } catch {
      // Ignore rewrite failures; best-effort patch.
    }
  }

  const nodeIndexPath = path.join(moduleDir, 'node-index.js');
  if (await pathExists(nodeIndexPath)) {
    try {
      const raw = await fs.readFile(nodeIndexPath, 'utf8');
      if (raw.includes("import { createRequire } from 'module'")) {
        const patched = raw.replace(
          "import { createRequire } from 'module'\n",
          "const createRequire = () => { throw new Error('module access disabled inside sandbox'); };\n"
        );
        await fs.writeFile(nodeIndexPath, patched, 'utf8');
      }
    } catch {
      // Ignore rewrite failures.
    }
  }

  const extractIndexPath = path.join(moduleDir, '..', 'msgpackr-extract', 'index.js');
  if (await pathExists(extractIndexPath)) {
    try {
      await fs.writeFile(extractIndexPath, "module.exports = null;\n", 'utf8');
    } catch {
      // Ignore rewrite failures.
    }
  }
}

async function rewriteMsgpackrExtractForSandbox(moduleDir: string): Promise<void> {
  const indexPath = path.join(moduleDir, 'index.js');
  if (await pathExists(indexPath)) {
    try {
      await fs.writeFile(indexPath, "module.exports = null;\n", 'utf8');
    } catch {
      // Ignore rewrite failures.
    }
  }
}

export async function buildBundle(
  context: BundleContext,
  options: BuildOptions = {}
): Promise<void> {
  const runtime = resolveRuntime(context.manifest);
  if (isPythonRuntime(runtime)) {
    const pythonEntry = getPythonEntry(context);
    const pythonEntryPath = resolvePath(context.bundleDir, pythonEntry);
    if (!(await pathExists(pythonEntryPath))) {
      throw new Error(
        `Python entry file not found at ${pythonEntry}. Update manifest.pythonEntry or create the file.`
      );
    }
    return;
  }

  const manifestEntry =
    typeof context.manifest.entry === 'string' ? context.manifest.entry.trim() : '';
  if (!manifestEntry) {
    throw new Error('Manifest entry is required for node runtimes. Update manifest.entry to continue.');
  }

  if (options.skipBuild) {
    const runtimeEntry = resolvePath(context.bundleDir, manifestEntry);
    if (!(await pathExists(runtimeEntry))) {
      throw new Error(
        `Built entry file not found at ${path.relative(context.bundleDir, runtimeEntry)}. Remove --skip-build to compile the bundle.`
      );
    }
    return;
  }
  await ensureBuildTarget(context);
  const outDir = resolvePath(context.bundleDir, context.config.outDir);
  await removeDir(outDir);
  await ensureDir(outDir);

  const sourceEntry = resolvePath(context.bundleDir, context.config.entry);
  const runtimeEntry = resolvePath(context.bundleDir, manifestEntry);
  const result = await esbuild.build({
    entryPoints: [sourceEntry],
    outfile: runtimeEntry,
    platform: 'node',
    bundle: true,
    target: 'node18',
    format: 'cjs',
    sourcemap: true,
    minify: Boolean(options.minify),
    logLevel: 'silent',
    external: context.config.externals
  });

  if (result.errors.length > 0) {
    throw new Error('Build failed. See errors above.');
  }

  if (!(await pathExists(runtimeEntry))) {
    throw new Error(
      `Build did not produce expected entry file at ${path.relative(context.bundleDir, runtimeEntry)}`
    );
  }
}

function createTarballName(slug: string, version: string): string {
  return `${slug}-${version}.tgz`;
}

async function computeChecksum(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const file = await fs.open(filePath, 'r');
  try {
    const stream = file.createReadStream();
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer | string) => {
        if (typeof chunk === 'string') {
          hash.update(chunk);
        } else {
          hash.update(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        }
      });
      stream.on('error', reject);
      stream.on('end', () => resolve());
    });
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

export async function packageBundle(
  context: BundleContext,
  options: PackageOptions = {}
): Promise<PackageResult> {
  await buildBundle(context, options);

  if (context.config.runtimeDependencies.length > 0) {
    await ensureRuntimeDependencies(context);
  }

  const artifactDir = options.outputDir
    ? path.resolve(context.bundleDir, options.outputDir)
    : resolvePath(context.bundleDir, context.config.artifactDir);
  await ensureDir(artifactDir);

  const filename = options.filename ?? createTarballName(context.config.slug, context.manifest.version);
  const tarballPath = path.resolve(artifactDir, filename);

  if (!(options.force ?? false) && (await pathExists(tarballPath))) {
    throw new Error(`Tarball already exists at ${path.relative(context.bundleDir, tarballPath)}. Use --force to overwrite.`);
  }

  const filesToInclude = new Set<string>();
  const resolvedManifestPath = resolvePath(context.bundleDir, context.config.manifestPath);
  filesToInclude.add(toBundleRelative(context.bundleDir, resolvedManifestPath));

  const patterns = context.config.files.length > 0 ? context.config.files : DEFAULT_FILES;
  const matches = await fg(patterns, {
    cwd: context.bundleDir,
    dot: false,
    onlyFiles: true
  });
  for (const match of matches) {
    filesToInclude.add(match.replace(/\\/g, '/'));
  }

  if (!filesToInclude.has(toBundleRelative(context.bundleDir, resolvedManifestPath))) {
    filesToInclude.add(toBundleRelative(context.bundleDir, resolvedManifestPath));
  }

  const runtime = resolveRuntime(context.manifest);
  if (isPythonRuntime(runtime)) {
    const pythonEntry = getPythonEntry(context);
    const pythonEntryPath = resolvePath(context.bundleDir, pythonEntry);
    if (!(await pathExists(pythonEntryPath))) {
      throw new Error(
        `Python entry file not found at ${pythonEntry}. Update manifest.pythonEntry or create the file.`
      );
    }
    filesToInclude.add(toBundleRelative(context.bundleDir, pythonEntryPath));

    const pythonSourceRoot = path.dirname(pythonEntryPath);
    const pythonFiles = await fg('**/*.py', {
      cwd: pythonSourceRoot,
      dot: false,
      onlyFiles: true
    });
    for (const relative of pythonFiles) {
      const absolute = path.resolve(pythonSourceRoot, relative);
      filesToInclude.add(toBundleRelative(context.bundleDir, absolute));
    }

    const requirementsPath =
      typeof context.config.pythonRequirementsPath === 'string'
        ? context.config.pythonRequirementsPath.trim()
        : '';
    if (requirementsPath) {
      const resolvedRequirements = resolvePath(context.bundleDir, requirementsPath);
      if (await pathExists(resolvedRequirements)) {
        filesToInclude.add(toBundleRelative(context.bundleDir, resolvedRequirements));
      }
    }
  }

  await tar.create(
    {
      gzip: true,
      cwd: context.bundleDir,
      file: tarballPath,
      portable: true,
      mtime: new Date('2020-01-01T00:00:00Z'),
      noMtime: false
    },
    Array.from(filesToInclude).sort()
  );

  const checksum = await computeChecksum(tarballPath);
  const checksumPath = `${tarballPath}.sha256`;
  const checksumLine = `${checksum}  ${path.basename(tarballPath)}\n`;
  await writeFile(checksumPath, checksumLine);

  return {
    manifest: context.manifest,
    config: context.config,
    tarballPath,
    checksum
  } satisfies PackageResult;
}

export async function loadOrScaffoldBundle(
  bundleDir: string,
  options: LoadBundleOptions = {}
): Promise<{ context: BundleContext; created: string[] }> {
  return loadBundleContext(bundleDir, { ...options, allowScaffold: true });
}

export function getManifestDocumentationUrl(): string {
  return MANIFEST_DOC_URL;
}
