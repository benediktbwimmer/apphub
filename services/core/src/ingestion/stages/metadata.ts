import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import type { RepositoryPreviewInput, RepositoryPreviewKind } from '../../db/index';
import { MAX_INLINE_PREVIEW_BYTES } from '../config';
import { fileExists } from '../fs';
import { log } from '../logger';
import type {
  DiscoveredTag,
  IngestionPipelineContext,
  PipelineStage,
  PreviewNormalizerOptions,
  ReadmeMetadata,
  PackageMetadata
} from '../types';

const PREVIEW_MANIFEST_FILES = [
  '.apphub/previews.json',
  '.apphub/previews.yaml',
  '.apphub/previews.yml',
  'apphub.previews.json',
  'apphub.previews.yaml',
  'apphub.previews.yml',
  'previews.json',
  'previews.yaml',
  'previews.yml'
];

function normalizeTagEntry(key: string, value: unknown): DiscoveredTag[] {
  const result: DiscoveredTag[] = [];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      result.push({ key, value: trimmed, source: 'ingestion:tags-file' });
    }
    return result;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if (trimmed) {
          result.push({ key, value: trimmed, source: 'ingestion:tags-file' });
        }
      }
    }
    return result;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [childKey, childValue] of entries) {
      if (typeof childValue === 'string') {
        const trimmed = childValue.trim();
        if (!trimmed) {
          continue;
        }
        const compoundKey = `${key}:${childKey}`;
        result.push({ key: compoundKey, value: trimmed, source: 'ingestion:tags-file' });
      }
    }
    return result;
  }
  return result;
}

async function readTagFile(projectDir: string): Promise<DiscoveredTag[]> {
  const fileNames = ['.apphub/tags.json', '.apphub/tags.yaml', 'apphub.tags.json', 'apphub.tags.yaml'];
  const results: DiscoveredTag[] = [];
  for (const fileName of fileNames) {
    const fullPath = path.join(projectDir, fileName);
    if (!(await fileExists(fullPath))) {
      continue;
    }
    try {
      const raw = await fs.readFile(fullPath, 'utf8');
      const data = fileName.endsWith('.json')
        ? JSON.parse(raw)
        : (YAML.parse(raw) as Record<string, unknown> | unknown[] | null);
      const container = Array.isArray(data) ? { tags: data } : (data as Record<string, unknown> | null);
      if (!container || typeof container !== 'object') {
        continue;
      }
      const record = container as Record<string, unknown>;
      const entries = Object.entries(record);
      entries.sort((a, b) => a[0].localeCompare(b[0]));
      for (const [key, value] of entries) {
        for (const tag of normalizeTagEntry(key, value)) {
          results.push(tag);
        }
      }
    } catch (err) {
      log('Failed to parse tag file', { fileName, error: (err as Error).message });
    }
  }
  return results;
}

function isHttpUrl(value: string) {
  return value.startsWith('http://') || value.startsWith('https://');
}

function isDataUrl(value: string) {
  return value.startsWith('data:');
}

function sanitizeRelativePreviewPath(raw: string) {
  const normalized = raw.replace(/\\/g, '/');
  if (normalized.includes('..')) {
    return null;
  }
  return normalized.replace(/^\//, '');
}

function extractRepoHostAndPath(repoUrl: string) {
  try {
    const { hostname, pathname } = new URL(repoUrl);
    return { hostname, pathname };
  } catch {
    return null;
  }
}

function toRawContentUrl(repoUrl: string, commitSha: string | null, relativePath: string) {
  const parsed = extractRepoHostAndPath(repoUrl);
  if (!parsed) {
    return null;
  }
  const { hostname, pathname } = parsed;
  const normalizedPath = pathname.replace(/\.git$/, '').replace(/\/$/, '');
  if (hostname === 'github.com') {
    const ref = commitSha ?? 'main';
    return `https://raw.githubusercontent.com${normalizedPath}/${ref}/${relativePath}`;
  }
  if (hostname === 'gitlab.com') {
    const ref = commitSha ?? 'main';
    return `https://gitlab.com${normalizedPath}/-/raw/${ref}/${relativePath}`;
  }
  if (hostname === 'bitbucket.org') {
    const ref = commitSha ?? 'main';
    return `https://bitbucket.org${normalizedPath}/raw/${ref}/${relativePath}`;
  }
  return null;
}

function guessMimeType(filePath: string) {
  if (filePath.endsWith('.png')) {
    return 'image/png';
  }
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (filePath.endsWith('.gif')) {
    return 'image/gif';
  }
  if (filePath.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (filePath.endsWith('.webm')) {
    return 'video/webm';
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

async function inlineLocalAsset(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_INLINE_PREVIEW_BYTES) {
      return null;
    }
    const mimeType = guessMimeType(filePath);
    const buffer = await fs.readFile(filePath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
  } catch (err) {
    log('Failed to inline preview asset', {
      filePath,
      error: (err as Error).message
    });
    return null;
  }
}

async function resolvePreviewReference(value: unknown, options: PreviewNormalizerOptions) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (isHttpUrl(trimmed) || isDataUrl(trimmed)) {
    return trimmed;
  }
  const relative = sanitizeRelativePreviewPath(trimmed);
  if (!relative) {
    return null;
  }
  const remote = toRawContentUrl(options.repoUrl, options.commitSha, relative);
  if (remote) {
    return remote;
  }
  const absolute = path.resolve(options.projectDir, relative);
  if (!(await fileExists(absolute))) {
    return null;
  }
  return inlineLocalAsset(absolute);
}

function coerceNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function normalizePreviewKind(rawType: string, src: string | null): RepositoryPreviewKind {
  const normalized = rawType.trim().toLowerCase();
  if (normalized === 'gif') {
    return 'gif';
  }
  if (normalized === 'storybook') {
    return 'storybook';
  }
  if (normalized === 'video') {
    return 'video';
  }
  if (normalized === 'embed' || normalized === 'iframe' || normalized === 'external') {
    return 'embed';
  }
  if (normalized === 'image' || normalized === 'picture') {
    return 'image';
  }
  if (src && src.toLowerCase().endsWith('.gif')) {
    return 'gif';
  }
  if (src && (src.toLowerCase().endsWith('.mp4') || src.toLowerCase().endsWith('.webm'))) {
    return 'video';
  }
  return 'image';
}

function buildStorybookEmbedUrl(baseUrl: string, storyId: string) {
  const trimmedBase = baseUrl.replace(/\/iframe\.html.*$/, '').replace(/\/$/, '');
  const normalizedBase = trimmedBase.endsWith('/iframe.html') ? trimmedBase : `${trimmedBase}/iframe.html`;
  const params = new URLSearchParams({ id: storyId, viewMode: 'story' });
  return `${normalizedBase}?${params.toString()}`;
}

function extractManifestEntries(raw: unknown) {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw && typeof raw === 'object') {
    const container = raw as Record<string, unknown>;
    for (const key of ['tiles', 'previews', 'items', 'cards']) {
      const value = container[key];
      if (Array.isArray(value)) {
        return value;
      }
    }
  }
  return [] as unknown[];
}

async function normalizeManifestPreview(
  entry: Record<string, unknown>,
  ctx: PreviewNormalizerOptions & { defaultOrder: number }
) {
  const rawType =
    typeof entry.type === 'string'
      ? entry.type
      : typeof entry.kind === 'string'
      ? entry.kind
      : '';
  const title = typeof entry.title === 'string' ? entry.title.trim() : undefined;
  const description = typeof entry.description === 'string' ? entry.description.trim() : undefined;
  const rawSrc =
    typeof entry.src === 'string'
      ? entry.src
      : typeof entry.url === 'string'
      ? entry.url
      : typeof entry.href === 'string'
      ? entry.href
      : undefined;
  const rawPoster =
    typeof entry.poster === 'string'
      ? entry.poster
      : typeof entry.posterUrl === 'string'
      ? entry.posterUrl
      : undefined;
  const rawEmbed =
    typeof entry.embed === 'string'
      ? entry.embed
      : typeof entry.embedUrl === 'string'
      ? entry.embedUrl
      : typeof entry.iframe === 'string'
      ? entry.iframe
      : undefined;

  const resolvedSrc = await resolvePreviewReference(rawSrc, ctx);
  const resolvedPoster = await resolvePreviewReference(rawPoster, ctx);

  let embedUrl = await resolvePreviewReference(rawEmbed, ctx);
  if (!embedUrl) {
    const storyId =
      typeof entry.storyId === 'string'
        ? entry.storyId
        : typeof entry.story === 'string'
        ? entry.story
        : null;
    const baseUrl =
      typeof entry.storybookUrl === 'string'
        ? entry.storybookUrl
        : typeof entry.baseUrl === 'string'
        ? entry.baseUrl
        : null;
    if (storyId && baseUrl) {
      embedUrl = buildStorybookEmbedUrl(baseUrl, storyId);
    }
  }

  const kind = normalizePreviewKind(rawType ?? '', resolvedSrc ?? rawSrc ?? null);
  const width = coerceNumber(entry.width);
  const height = coerceNumber(entry.height);
  const orderValue = coerceNumber(entry.order ?? entry.sortOrder) ?? ctx.defaultOrder;

  if (kind === 'storybook' || kind === 'embed') {
    if (!embedUrl) {
      return null;
    }
    return {
      kind,
      source: 'ingestion:previews-manifest',
      title: title ?? null,
      description: description ?? null,
      embedUrl,
      posterUrl: resolvedPoster ?? null,
      src: resolvedSrc ?? null,
      width,
      height,
      sortOrder: orderValue
    } satisfies RepositoryPreviewInput;
  }

  if ((kind === 'image' || kind === 'gif' || kind === 'video') && !resolvedSrc) {
    return null;
  }

  return {
    kind,
    source: 'ingestion:previews-manifest',
    title: title ?? null,
    description: description ?? null,
    src: resolvedSrc ?? null,
    embedUrl: embedUrl ?? null,
    posterUrl: resolvedPoster ?? null,
    width,
    height,
    sortOrder: orderValue
  } satisfies RepositoryPreviewInput;
}

async function readPreviewManifest(options: PreviewNormalizerOptions): Promise<RepositoryPreviewInput[]> {
  for (const candidate of PREVIEW_MANIFEST_FILES) {
    const manifestPath = path.join(options.projectDir, candidate);
    if (!(await fileExists(manifestPath))) {
      continue;
    }
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = candidate.endsWith('.json')
        ? JSON.parse(raw)
        : (YAML.parse(raw) as unknown);
      const entries = extractManifestEntries(parsed);
      const results: RepositoryPreviewInput[] = [];
      let index = 0;
      for (const value of entries) {
        if (!value || typeof value !== 'object') {
          continue;
        }
        const normalized = await normalizeManifestPreview(value as Record<string, unknown>, {
          projectDir: options.projectDir,
          repoUrl: options.repoUrl,
          commitSha: options.commitSha,
          defaultOrder: index
        });
        if (normalized) {
          results.push({ ...normalized, sortOrder: normalized.sortOrder ?? index });
          index += 1;
        }
      }
      return results;
    } catch (err) {
      log('Failed to parse preview manifest', {
        fileName: candidate,
        error: (err as Error).message
      });
    }
  }
  return [];
}

async function readReadmeMetadata(
  projectDir: string,
  repoUrl: string,
  commitSha: string | null
): Promise<ReadmeMetadata> {
  const readmePath = path.join(projectDir, 'README.md');
  if (!(await fileExists(readmePath))) {
    return { summary: null, previews: [] };
  }
  try {
    const raw = await fs.readFile(readmePath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    const summary = lines[0] ?? null;
    const previews: RepositoryPreviewInput[] = [];
    const imagePattern = /!\[(.*?)\]\(([^\s)]+)(?:\s+".*?")?\)/g;
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    let index = 0;
    while ((match = imagePattern.exec(raw))) {
      const alt = match[1] ?? '';
      const ref = match[2] ?? '';
      if (seen.has(ref)) {
        continue;
      }
      seen.add(ref);
      const resolved = await resolvePreviewReference(ref, { projectDir, repoUrl, commitSha });
      if (!resolved) {
        continue;
      }
      const kind =
        resolved.toLowerCase().endsWith('.gif') || ref.toLowerCase().endsWith('.gif') ? 'gif' : 'image';
      previews.push({
        kind,
        source: 'ingestion:readme',
        title: alt.trim() || null,
        description: null,
        src: resolved,
        embedUrl: null,
        posterUrl: null,
        sortOrder: index
      });
      index += 1;
      if (previews.length >= 6) {
        break;
      }
    }
    return { summary, previews };
  } catch (err) {
    log('Failed to read README', { error: (err as Error).message });
    return { summary: null, previews: [] };
  }
}

function mergePreviewInputs(
  primary: RepositoryPreviewInput[],
  secondary: RepositoryPreviewInput[],
  limit = 6
) {
  const combined: RepositoryPreviewInput[] = [];
  const seen = new Set<string>();
  const pushPreview = (preview: RepositoryPreviewInput) => {
    const signature = preview.embedUrl ?? preview.src;
    if (!signature || seen.has(signature)) {
      return;
    }
    seen.add(signature);
    combined.push(preview);
  };

  const sortedPrimary = primary
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const item of sortedPrimary) {
    if (combined.length >= limit) {
      break;
    }
    pushPreview(item);
  }

  for (const item of secondary) {
    if (combined.length >= limit) {
      break;
    }
    pushPreview(item);
  }

  return combined.slice(0, limit).map((preview, index) => ({
    ...preview,
    sortOrder: index
  }));
}

function normalizeDockerfileCandidate(raw?: string | null) {
  if (!raw || typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\\/g, '/').replace(/^\//, '');
}

function toRelativePosix(baseDir: string, target: string) {
  const relative = path.relative(baseDir, target);
  return relative.split(path.sep).join('/');
}

function isDockerfileFileName(name: string) {
  return name.toLowerCase() === 'dockerfile' || name.toLowerCase().endsWith('.dockerfile');
}

function shouldSkipDirectory(name: string) {
  return name === '.git' || name === 'node_modules' || name.startsWith('.apphub');
}

async function findDockerfileFallback(projectDir: string, maxDepth = 6, maxEntries = 5000) {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: projectDir, depth: 0 }];
  const results: string[] = [];
  let scanned = 0;

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (depth > maxDepth) {
      continue;
    }
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      scanned += 1;
      if (scanned > maxEntries) {
        return results;
      }
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        continue;
      }
      if (entry.isFile() && isDockerfileFileName(entry.name)) {
        results.push(path.join(dir, entry.name));
      }
    }
  }

  return results;
}

async function detectDockerfilePath(projectDir: string, preferredPath?: string) {
  const normalizedPreferred = normalizeDockerfileCandidate(preferredPath);
  if (normalizedPreferred) {
    const candidatePath = path.join(projectDir, normalizedPreferred);
    if (await fileExists(candidatePath)) {
      return normalizedPreferred;
    }
  }

  const rootDockerfile = path.join(projectDir, 'Dockerfile');
  if (await fileExists(rootDockerfile)) {
    return 'Dockerfile';
  }

  const fallbacks = await findDockerfileFallback(projectDir);
  if (fallbacks.length === 0) {
    return null;
  }
  fallbacks.sort((a, b) => a.length - b.length);
  const relative = toRelativePosix(projectDir, fallbacks[0]);
  return relative;
}

async function readPackageMetadata(
  projectDir: string,
  options: { dockerfilePath?: string | null } = {}
): Promise<PackageMetadata> {
  const repoRoot = path.resolve(projectDir);
  const seen = new Set<string>();
  const candidates: string[] = [];

  const pushCandidate = (candidatePath: string) => {
    const absolute = path.resolve(candidatePath);
    if (!seen.has(absolute)) {
      seen.add(absolute);
      candidates.push(absolute);
    }
  };

  const dockerfilePath = options.dockerfilePath ?? null;
  if (dockerfilePath) {
    let currentDir = path.dirname(path.resolve(projectDir, dockerfilePath));
    while (true) {
      const relative = path.relative(repoRoot, currentDir);
      if (relative.startsWith('..')) {
        break;
      }
      pushCandidate(path.join(currentDir, 'package.json'));
      if (relative === '') {
        break;
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      currentDir = parent;
    }
  }

  pushCandidate(path.join(repoRoot, 'package.json'));

  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      continue;
    }

    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const data = JSON.parse(raw) as {
        name?: string;
        description?: string;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        engines?: Record<string, string>;
      };

      const tags: DiscoveredTag[] = [];
      const dependencies = {
        ...(data.dependencies ?? {}),
        ...(data.devDependencies ?? {})
      };

      if ('next' in dependencies) {
        tags.push({ key: 'framework', value: 'nextjs', source: 'ingestion:package' });
      }
      if ('astro' in dependencies) {
        tags.push({ key: 'framework', value: 'astro', source: 'ingestion:package' });
      }
      if ('@remix-run/react' in dependencies || 'remix' in dependencies) {
        tags.push({ key: 'framework', value: 'remix', source: 'ingestion:package' });
      }
      if ('react' in dependencies) {
        tags.push({ key: 'library', value: 'react', source: 'ingestion:package' });
      }
      if ('vue' in dependencies || 'nuxt' in dependencies || 'nuxt3' in dependencies) {
        tags.push({ key: 'framework', value: 'vue', source: 'ingestion:package' });
      }
      if ('svelte' in dependencies || 'sveltekit' in dependencies) {
        tags.push({ key: 'framework', value: 'svelte', source: 'ingestion:package' });
      }
      if (
        'typescript' in dependencies ||
        (await fileExists(path.join(path.dirname(candidate), 'tsconfig.json')))
      ) {
        tags.push({ key: 'language', value: 'typescript', source: 'ingestion:package' });
      }
      if (
        data.engines &&
        typeof data.engines === 'object' &&
        typeof data.engines.node === 'string' &&
        data.engines.node.trim()
      ) {
        tags.push({ key: 'runtime', value: `node@${data.engines.node.trim()}`, source: 'ingestion:package' });
      }

      return {
        name: data.name?.trim(),
        description: data.description?.trim(),
        tags,
        packageJsonPath: candidate
      };
    } catch (err) {
      log('Failed to parse package.json', {
        file: candidate,
        error: (err as Error).message
      });
    }
  }

  return {
    name: undefined,
    description: undefined,
    tags: [],
    packageJsonPath: null
  };
}

export const metadataStage: PipelineStage = {
  name: 'metadata',
  async run(context: IngestionPipelineContext) {
    if (!context.workingDir) {
      throw new Error('working directory missing for metadata stage');
    }

    const declaredTags = await readTagFile(context.workingDir);
    context.declaredTags = declaredTags;

    const dockerfilePath = await detectDockerfilePath(context.workingDir, context.repository.dockerfilePath);
    if (!dockerfilePath) {
      throw new Error('Dockerfile not found, unable to launch app');
    }
    context.dockerfilePath = dockerfilePath;

    const packageMetadata = await readPackageMetadata(context.workingDir, {
      dockerfilePath
    });
    context.packageMetadata = packageMetadata;

    const readmeMetadata = await readReadmeMetadata(
      context.workingDir,
      context.repository.repoUrl,
      context.commitSha
    );
    context.readmeMetadata = readmeMetadata;

    const manifestPreviews = await readPreviewManifest({
      projectDir: context.workingDir,
      repoUrl: context.repository.repoUrl,
      commitSha: context.commitSha
    });
    context.manifestPreviews = manifestPreviews;
    context.previewTiles = mergePreviewInputs(manifestPreviews, readmeMetadata.previews);
  }
};

export {
  readPackageMetadata,
  readPreviewManifest,
  readReadmeMetadata,
  mergePreviewInputs,
  detectDockerfilePath,
  readTagFile
};
