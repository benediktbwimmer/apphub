import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import tar from 'tar';
import https from 'node:https';
import http from 'node:http';

import type { AiGeneratedBundleFile, AiGeneratedBundleSuggestion } from '../ai/bundlePublisher';
import {
  cloneSuggestion,
  extractMetadata,
  findNextVersion,
  type BundleBinding
} from './bundleRecovery';
import type { JobBundleVersionRecord, JobDefinitionRecord, JsonValue } from '../db/types';
import {
  createBundleDownloadUrl,
  ensureLocalBundleExists,
  getLocalBundleArtifactPath
} from './bundleStorage';
import {
  getJobBundleVersion,
  listJobBundleVersions
} from '../db/jobBundles';

const BUNDLE_ENTRY_REGEX = /^bundle:([a-z0-9][a-z0-9._-]*)@([^#]+?)(?:#([a-zA-Z_$][\w$]*))?$/i;
const MANIFEST_FALLBACK_PATH = 'manifest.json';

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.cjs',
  '.mjs',
  '.json',
  '.md',
  '.txt',
  '.yaml',
  '.yml'
]);

type SuggestionSource = 'metadata' | 'artifact';

export type BundleEditorSnapshot = {
  binding: BundleBinding;
  version: JobBundleVersionRecord;
  suggestion: AiGeneratedBundleSuggestion;
  suggestionSource: SuggestionSource;
  manifestPath: string;
  manifest: JsonValue;
  aiBuilderMetadata: Record<string, unknown> | null;
  history: Array<{
    slug: string;
    version: string;
    checksum?: string;
    regeneratedAt?: string;
  }>;
  availableVersions: JobBundleVersionRecord[];
};

export function parseBundleEntryPoint(entryPoint: string | null | undefined): BundleBinding | null {
  if (!entryPoint || typeof entryPoint !== 'string') {
    return null;
  }
  const trimmed = entryPoint.trim();
  const matches = BUNDLE_ENTRY_REGEX.exec(trimmed);
  if (!matches) {
    return null;
  }
  const [, rawSlug, rawVersion, rawExport] = matches;
  const slug = rawSlug.toLowerCase();
  const version = rawVersion.trim();
  if (!version) {
    return null;
  }
  return {
    slug,
    version,
    exportName: rawExport ?? null
  };
}

function resolveManifestPath(candidate?: string | null): string {
  if (!candidate || typeof candidate !== 'string') {
    return MANIFEST_FALLBACK_PATH;
  }
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : MANIFEST_FALLBACK_PATH;
}

function isProbableText(buffer: Buffer, extension: string): boolean {
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  if (buffer.length === 0) {
    return true;
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }
  }
  return true;
}

async function collectRelativeFilePaths(root: string): Promise<string[]> {
  async function walk(current: string, prefix = ''): Promise<string[]> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const collected: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const relative = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        const nested = await walk(entryPath, relative);
        collected.push(...nested);
      } else if (entry.isFile()) {
        collected.push(relative);
      }
    }
    return collected;
  }

  return walk(root, '');
}

async function downloadUrlToBuffer(url: string, depth = 0): Promise<Buffer> {
  if (depth > 3) {
    throw new Error('Too many redirects while downloading bundle artifact');
  }

  return new Promise<Buffer>((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        const nextUrl = new URL(response.headers.location, url).toString();
        response.resume();
        downloadUrlToBuffer(nextUrl, depth + 1).then(resolve).catch(reject);
        return;
      }
      if (status >= 400) {
        response.resume();
        reject(new Error(`Failed to download bundle artifact (${status})`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      response.on('error', reject);
    });
    request.on('error', reject);
  });
}

async function ensureExtractedWorkspace(version: JobBundleVersionRecord): Promise<string> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-bundle-editor-'));
  try {
    if (version.artifactStorage === 'local') {
      await ensureLocalBundleExists(version);
      const artifactPath = getLocalBundleArtifactPath(version);
      await tar.x({ cwd: workspace, file: artifactPath });
      return workspace;
    }

    const download = await createBundleDownloadUrl(version, { expiresInMs: 60_000 });
    const buffer = await downloadUrlToBuffer(download.url);
    const archivePath = path.join(workspace, 'bundle.tgz');
    await fs.writeFile(archivePath, buffer);
    await tar.x({ cwd: workspace, file: archivePath });
    await fs.unlink(archivePath).catch(() => undefined);
    return workspace;
  } catch (err) {
    await fs.rm(workspace, { recursive: true, force: true });
    throw err;
  }
}

async function readBundleArtifactBuffer(version: JobBundleVersionRecord): Promise<Buffer> {
  if (version.artifactStorage === 'local') {
    await ensureLocalBundleExists(version);
    const artifactPath = getLocalBundleArtifactPath(version);
    return fs.readFile(artifactPath);
  }
  const download = await createBundleDownloadUrl(version, { expiresInMs: 60_000 });
  return downloadUrlToBuffer(download.url);
}

async function buildFilesFromArtifact(
  version: JobBundleVersionRecord,
  manifestPath: string,
  entryPoint: string
): Promise<AiGeneratedBundleFile[]> {
  const workspace = await ensureExtractedWorkspace(version);
  try {
    const relativePaths = await collectRelativeFilePaths(workspace);
    const files: AiGeneratedBundleFile[] = [];
    for (const relative of relativePaths) {
      const normalized = relative.split(path.sep).join('/');
      if (normalized === manifestPath) {
        continue;
      }
      const absolute = path.join(workspace, relative);
      const stat = await fs.stat(absolute);
      if (!stat.isFile()) {
        continue;
      }
      const data = await fs.readFile(absolute);
      const extension = path.extname(normalized).toLowerCase();
      const executable = (stat.mode & 0o111) !== 0;
      if (isProbableText(data, extension)) {
        files.push({ path: normalized, contents: data.toString('utf8'), executable: executable || undefined });
      } else {
        files.push({
          path: normalized,
          contents: data.toString('base64'),
          encoding: 'base64',
          executable: executable || undefined
        });
      }
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

async function buildFilesWithFallback(
  version: JobBundleVersionRecord,
  manifestPath: string,
  entryPoint: string
): Promise<AiGeneratedBundleFile[]> {
  try {
    return await buildFilesFromArtifact(version, manifestPath, entryPoint);
  } catch {
    const buffer = await readBundleArtifactBuffer(version);
    const extension = path.extname(entryPoint).toLowerCase();
    const text = isProbableText(buffer, extension);
    return [
      {
        path: entryPoint,
        contents: text ? buffer.toString('utf8') : buffer.toString('base64'),
        encoding: text ? 'utf8' : 'base64',
        executable: false
      }
    ];
  }
}

function normalizeManifest(
  manifest: JsonValue,
  binding: BundleBinding,
  entryPoint: string
): JsonValue {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return {
      name: binding.slug,
      version: binding.version,
      entry: entryPoint,
      main: entryPoint
    } satisfies Record<string, unknown> as JsonValue;
  }
  const cloned = JSON.parse(JSON.stringify(manifest ?? null)) as Record<string, unknown>;
  const mainEntry = typeof cloned.entry === 'string' && cloned.entry.trim().length > 0 ? cloned.entry.trim() : entryPoint;
  cloned.name = typeof cloned.name === 'string' && cloned.name.trim().length > 0 ? cloned.name.trim() : binding.slug;
  cloned.version = binding.version;
  cloned.entry = mainEntry;
  cloned.main = typeof cloned.main === 'string' && cloned.main.trim().length > 0 ? cloned.main.trim() : mainEntry;
  return cloned as JsonValue;
}

async function loadSuggestionFromMetadata(
  job: JobDefinitionRecord,
  binding: BundleBinding
): Promise<{
  suggestion: AiGeneratedBundleSuggestion;
  manifestPath: string;
  history: BundleEditorSnapshot['history'];
  metadata: Record<string, unknown> | null;
} | null> {
  const metadataState = extractMetadata(job);
  const stored = metadataState.aiBuilder.bundle;
  if (!stored || stored.slug !== binding.slug || stored.version !== binding.version) {
    return null;
  }
  const manifestPath = resolveManifestPath(stored.manifestPath);
  const history = Array.isArray(metadataState.aiBuilder.history)
    ? metadataState.aiBuilder.history.map((entry) => ({
        slug: entry.slug,
        version: entry.version,
        checksum: entry.checksum,
        regeneratedAt: entry.regeneratedAt
      }))
    : [];
  const metadata = metadataState.root.aiBuilder as Record<string, unknown> | null;
  return {
    suggestion: cloneSuggestion(stored),
    manifestPath,
    history,
    metadata
  };
}

async function loadSuggestionFromArtifact(
  version: JobBundleVersionRecord,
  binding: BundleBinding,
  manifestPath: string
): Promise<AiGeneratedBundleSuggestion> {
  const entryPoint = deriveEntryPoint(version);
  const manifest = normalizeManifest(version.manifest, binding, entryPoint);
  const files = await buildFilesWithFallback(version, manifestPath, entryPoint);
  return {
    slug: binding.slug,
    version: binding.version,
    entryPoint,
    manifest,
    manifestPath,
    capabilityFlags: version.capabilityFlags,
    metadata: version.metadata,
    files
  } satisfies AiGeneratedBundleSuggestion;
}

function deriveEntryPoint(version: JobBundleVersionRecord): string {
  const manifest = version.manifest;
  if (manifest && typeof manifest === 'object' && !Array.isArray(manifest)) {
    const data = manifest as Record<string, unknown>;
    const entry = typeof data.entry === 'string' && data.entry.trim().length > 0 ? data.entry.trim() : null;
    if (entry) {
      return entry;
    }
    const main = typeof data.main === 'string' && data.main.trim().length > 0 ? data.main.trim() : null;
    if (main) {
      return main;
    }
  }
  return 'index.js';
}

export async function loadBundleEditorSnapshot(
  job: JobDefinitionRecord
): Promise<BundleEditorSnapshot | null> {
  const binding = parseBundleEntryPoint(job.entryPoint);
  if (!binding) {
    return null;
  }

  const version = await getJobBundleVersion(binding.slug, binding.version);
  if (!version) {
    return null;
  }

  const metadataResult = await loadSuggestionFromMetadata(job, binding);
  const manifestPath = metadataResult ? metadataResult.manifestPath : MANIFEST_FALLBACK_PATH;
  const suggestion = metadataResult
    ? metadataResult.suggestion
    : await loadSuggestionFromArtifact(version, binding, manifestPath);
  const history = metadataResult ? metadataResult.history : [];
  const aiBuilderMetadata = metadataResult?.metadata ?? null;
  const availableVersions = await listJobBundleVersions(binding.slug);

  return {
    binding,
    version,
    suggestion,
    suggestionSource: metadataResult ? 'metadata' : 'artifact',
    manifestPath,
    manifest: suggestion.manifest,
    aiBuilderMetadata,
    history,
    availableVersions
  } satisfies BundleEditorSnapshot;
}

export { findNextVersion };
