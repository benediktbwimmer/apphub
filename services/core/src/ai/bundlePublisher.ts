import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import * as tar from 'tar';

import { publishBundleVersion, type BundlePublishResult } from '../jobs/registryService';
import type { JsonValue } from '../db';

export type AiGeneratedBundleFile = {
  path: string;
  contents: string;
  encoding?: 'utf8' | 'base64';
  executable?: boolean;
};

export type AiGeneratedBundleSuggestion = {
  slug: string;
  version: string;
  entryPoint: string;
  manifest: JsonValue;
  manifestPath?: string;
  capabilityFlags?: string[];
  metadata?: JsonValue | null;
  description?: string | null;
  displayName?: string | null;
  files: AiGeneratedBundleFile[];
};

export type PublishActor = {
  subject?: string | null;
  kind?: string | null;
  tokenHash?: string | null;
};

type BundledArtifact = {
  data: Buffer;
  filename: string;
  checksum: string;
};

async function writeBundleFiles(root: string, files: AiGeneratedBundleFile[]): Promise<void> {
  await Promise.all(
    files.map(async (file) => {
      if (path.isAbsolute(file.path) || file.path.split(/[\\/]+/).some((segment) => segment === '..')) {
        throw new Error(`Invalid bundle file path: ${file.path}`);
      }
      const destination = path.join(root, file.path);
      const directory = path.dirname(destination);
      await fs.mkdir(directory, { recursive: true });
      const encoding = file.encoding ?? 'utf8';
      const data =
        encoding === 'base64' ? Buffer.from(file.contents, 'base64') : Buffer.from(file.contents, 'utf8');
      await fs.writeFile(destination, data);
      if (file.executable) {
        await fs.chmod(destination, 0o755);
      }
    })
  );
}

async function createTarball(root: string, slug: string, version: string): Promise<BundledArtifact> {
  const tarballPath = path.join(root, `${slug}-${version}.tgz`);

  const files = await collectRelativeFilePaths(root);
  await tar.create({ cwd: root, file: tarballPath, gzip: true }, files);

  const data = await fs.readFile(tarballPath);
  const checksum = crypto.createHash('sha256').update(data).digest('hex');
  return {
    data,
    filename: path.basename(tarballPath),
    checksum
  } satisfies BundledArtifact;
}

async function collectRelativeFilePaths(root: string): Promise<string[]> {
  async function walk(current: string, prefix = ''): Promise<string[]> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const collected: string[] = [];
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      const relativePath = path.join(prefix, entry.name);
      if (entry.isDirectory()) {
        const nested = await walk(entryPath, relativePath);
        collected.push(...nested);
      } else if (entry.isFile()) {
        collected.push(relativePath);
      }
    }
    return collected;
  }

  return walk(root, '');
}

export type PreparedBundleArtifact = {
  artifact: BundledArtifact;
  manifest: JsonValue;
};

function cloneManifest(manifest: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(manifest ?? {}));
}

function normalizeCapabilityList(candidate: unknown, flags?: string[]): string[] {
  const seen = new Set<string>();
  if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      if (typeof entry !== 'string') {
        continue;
      }
      const trimmed = entry.trim();
      if (!trimmed) {
        continue;
      }
      seen.add(trimmed);
    }
  }
  for (const flag of flags ?? []) {
    if (typeof flag !== 'string') {
      continue;
    }
    const trimmed = flag.trim();
    if (!trimmed) {
      continue;
    }
    seen.add(trimmed);
  }
  return Array.from(seen).sort((a, b) => a.localeCompare(b));
}

function normalizeManifestForSuggestion(
  manifest: JsonValue,
  options: { slug: string; version: string; entryPoint: string; capabilityFlags?: string[] }
): JsonValue {
  const capabilityFlags = normalizeCapabilityList(undefined, options.capabilityFlags);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    const base: Record<string, unknown> = {
      name: options.slug,
      version: options.version,
      main: options.entryPoint,
      entry: options.entryPoint
    };
    if (capabilityFlags.length > 0) {
      base.capabilities = capabilityFlags;
    }
    return base as JsonValue;
  }
  const nextManifest = cloneManifest(manifest) as Record<string, unknown>;
  if (typeof nextManifest.name !== 'string' || !nextManifest.name) {
    nextManifest.name = options.slug;
  }
  nextManifest.version = options.version;
  if (typeof nextManifest.entry !== 'string' || !nextManifest.entry) {
    nextManifest.entry = options.entryPoint;
  }
  if (typeof nextManifest.main !== 'string' || !nextManifest.main) {
    nextManifest.main = options.entryPoint;
  }
  const mergedCapabilities = normalizeCapabilityList(nextManifest.capabilities, capabilityFlags);
  if (mergedCapabilities.length > 0) {
    nextManifest.capabilities = mergedCapabilities;
  } else {
    delete nextManifest.capabilities;
  }
  return nextManifest as JsonValue;
}

export async function buildBundleArtifactFromSuggestion(
  suggestion: AiGeneratedBundleSuggestion,
  overrides?: { slug?: string; version?: string; entryPoint?: string }
): Promise<PreparedBundleArtifact> {
  const slug = overrides?.slug ?? suggestion.slug;
  const version = overrides?.version ?? suggestion.version;
  const entryPoint = overrides?.entryPoint ?? suggestion.entryPoint ?? 'index.js';

  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-ai-bundle-'));
  try {
    await writeBundleFiles(workspace, suggestion.files);

    const manifest = normalizeManifestForSuggestion(suggestion.manifest, {
      slug,
      version,
      entryPoint,
      capabilityFlags: suggestion.capabilityFlags ?? []
    });
    const manifestPath = suggestion.manifestPath ?? 'manifest.json';
    const manifestTarget = path.join(workspace, manifestPath);
    await fs.mkdir(path.dirname(manifestTarget), { recursive: true });
    await fs.writeFile(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    const artifact = await createTarball(workspace, slug, version);
    return { artifact, manifest } satisfies PreparedBundleArtifact;
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

export async function publishGeneratedBundle(
  suggestion: AiGeneratedBundleSuggestion,
  actor: PublishActor
): Promise<BundlePublishResult> {
  const prepared = await buildBundleArtifactFromSuggestion(suggestion);

  return publishBundleVersion(
    {
      slug: suggestion.slug,
      version: suggestion.version,
      manifest: prepared.manifest,
      capabilityFlags: suggestion.capabilityFlags ?? [],
      metadata: suggestion.metadata ?? null,
      description: suggestion.description ?? null,
      displayName: suggestion.displayName ?? null,
      artifact: {
        data: prepared.artifact.data,
        filename: prepared.artifact.filename,
        contentType: 'application/gzip',
        checksum: prepared.artifact.checksum
      }
    },
    actor
  );
}
