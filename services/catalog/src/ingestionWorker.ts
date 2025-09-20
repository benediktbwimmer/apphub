import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import YAML from 'yaml';
import {
  createBuild,
  getRepositoryById,
  listNetworksForMemberRepository,
  upsertRepository,
  setRepositoryStatus,
  takeNextPendingRepository,
  replaceRepositoryPreviews,
  replaceRepositoryTags,
  type RepositoryRecord,
  type TagKV,
  type RepositoryPreviewInput,
  type RepositoryPreviewKind
} from './db/index';
import {
  INGEST_QUEUE_NAME,
  closeQueueConnection,
  enqueueBuildJob,
  getQueueConnection,
  isInlineQueueMode
} from './queue';
import { runBuildJob } from './buildRunner';

const CLONE_DEPTH = process.env.INGEST_CLONE_DEPTH ?? '1';
const INGEST_CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 2);
const useInlineQueue = isInlineQueueMode();
const MAX_INLINE_PREVIEW_BYTES = Number(process.env.INGEST_MAX_INLINE_PREVIEW_BYTES ?? 1_500_000);

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

const git = simpleGit();

function log(message: string, meta?: Record<string, unknown>) {
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[ingest] ${message}${payload}`);
}

async function fileExists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

type DiscoveredTag = TagKV & { source: string };

type PackageMetadata = {
  name?: string;
  description?: string;
  tags: DiscoveredTag[];
};

async function readPackageMetadata(projectDir: string): Promise<PackageMetadata> {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!(await fileExists(pkgPath))) {
    return { tags: [] };
  }

  try {
    const raw = await fs.readFile(pkgPath, 'utf8');
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
    if ('typescript' in dependencies || (await fileExists(path.join(projectDir, 'tsconfig.json')))) {
      tags.push({ key: 'language', value: 'typescript', source: 'ingestion:package' });
    }

    const nodeEngine = data.engines?.node;
    if (nodeEngine) {
      const match = nodeEngine.match(/(\d+)(?:\.(\d+))?/);
      if (match) {
        tags.push({ key: 'runtime', value: `node${match[1]}`, source: 'ingestion:package' });
      }
    }

    return {
      name: data.name,
      description: data.description,
      tags
    };
  } catch (err) {
    log('Failed to parse package.json', { error: (err as Error).message });
    return { tags: [] };
  }
}

function normalizeTagEntry(key: string, value: unknown): DiscoveredTag[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => normalizeTagEntry(key, entry));
  }
  if (typeof value === 'string') {
    return [{ key, value, source: 'ingestion:tagsfile' }];
  }
  if (value && typeof value === 'object') {
    const maybeValue = (value as Record<string, unknown>).value;
    if (typeof maybeValue === 'string') {
      return [{ key, value: maybeValue, source: 'ingestion:tagsfile' }];
    }
  }
  return [];
}

async function readTagFile(projectDir: string): Promise<DiscoveredTag[]> {
  for (const fileName of ['tags.yaml', 'tags.yml', 'tags.json']) {
    const candidate = path.join(projectDir, fileName);
    if (!(await fileExists(candidate))) {
      continue;
    }

    try {
      const raw = await fs.readFile(candidate, 'utf8');
      if (fileName.endsWith('.json')) {
        const data = JSON.parse(raw) as Record<string, unknown> | unknown[];
        return extractTagsFromStructure(data);
      }
      const data = YAML.parse(raw) as unknown;
      return extractTagsFromStructure(data);
    } catch (err) {
      log('Failed to parse tag file', { fileName, error: (err as Error).message });
    }
  }
  return [];
}

function extractTagsFromStructure(data: unknown): DiscoveredTag[] {
  if (!data) {
    return [];
  }

  if (Array.isArray(data)) {
    return data.flatMap((item) => {
      if (typeof item === 'string') {
        const [key, value] = item.split(':');
        if (key && value) {
          return [{ key: key.trim(), value: value.trim(), source: 'ingestion:tagsfile' }];
        }
        return [];
      }
      if (item && typeof item === 'object') {
        const key = (item as Record<string, unknown>).key;
        const value = (item as Record<string, unknown>).value;
        if (typeof key === 'string' && typeof value === 'string') {
          return [{ key: key.trim(), value: value.trim(), source: 'ingestion:tagsfile' }];
        }
      }
      return [];
    });
  }

  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).flatMap(([key, value]) =>
      normalizeTagEntry(key, value)
    );
  }

  return [];
}

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isDataUrl(value: string) {
  return value.startsWith('data:');
}

function sanitizeRelativePreviewPath(raw: string) {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim().replace(/"/g, '');
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/^\.\/+/, '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('..')) {
    return null;
  }
  return normalized;
}

function extractRepoHostAndPath(repoUrl: string) {
  const trimmed = repoUrl.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith('git@')) {
    const match = trimmed.match(/^git@([^:]+):(.+?)(\.git)?$/);
    if (!match) {
      return null;
    }
    return {
      host: match[1],
      path: match[2].replace(/\.git$/, '')
    };
  }
  try {
    const url = new URL(trimmed);
    return {
      host: url.hostname,
      path: url.pathname.replace(/^\/+/, '').replace(/\.git$/, '')
    };
  } catch (err) {
    return null;
  }
}

function toRawContentUrl(repoUrl: string, commitSha: string | null, relativePath: string) {
  if (!commitSha) {
    return null;
  }
  const parts = extractRepoHostAndPath(repoUrl);
  if (!parts) {
    return null;
  }
  const { host, path } = parts;
  if (!path) {
    return null;
  }
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return null;
  }
  const normalizedRelative = relativePath.replace(/^\/+/, '');
  if (host === 'github.com') {
    if (segments.length < 2) {
      return null;
    }
    const [owner, repo] = segments;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${commitSha}/${normalizedRelative}`;
  }
  if (host === 'gitlab.com') {
    const projectPath = segments.join('/');
    return `https://gitlab.com/${projectPath}/-/raw/${commitSha}/${normalizedRelative}`;
  }
  if (host === 'bitbucket.org') {
    if (segments.length < 2) {
      return null;
    }
    const [owner, repo, ...rest] = segments;
    const repoPath = [owner, repo, ...rest].join('/');
    return `https://bitbucket.org/${repoPath}/raw/${commitSha}/${normalizedRelative}`;
  }
  return null;
}

function guessMimeType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.gif') {
    return 'image/gif';
  }
  if (ext === '.png') {
    return 'image/png';
  }
  if (ext === '.jpg' || ext === '.jpeg') {
    return 'image/jpeg';
  }
  if (ext === '.webp') {
    return 'image/webp';
  }
  if (ext === '.apng') {
    return 'image/apng';
  }
  if (ext === '.svg') {
    return 'image/svg+xml';
  }
  if (ext === '.mp4') {
    return 'video/mp4';
  }
  if (ext === '.webm') {
    return 'video/webm';
  }
  return null;
}

async function inlineLocalAsset(filePath: string) {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) {
      return null;
    }
    if (stats.size > MAX_INLINE_PREVIEW_BYTES) {
      return null;
    }
    const mime = guessMimeType(filePath);
    if (!mime || !mime.startsWith('image/')) {
      return null;
    }
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    return `data:${mime};base64,${base64}`;
  } catch (err) {
    return null;
  }
}

async function resolvePreviewReference(
  value: unknown,
  options: { projectDir: string; repoUrl: string; commitSha: string | null }
) {
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
  ctx: { projectDir: string; repoUrl: string; commitSha: string | null; defaultOrder: number }
) {
  const rawType = typeof entry.type === 'string' ? entry.type : typeof entry.kind === 'string' ? entry.kind : '';
  const title = typeof entry.title === 'string' ? entry.title.trim() : undefined;
  const description = typeof entry.description === 'string' ? entry.description.trim() : undefined;
  const rawSrc = typeof entry.src === 'string' ? entry.src : typeof entry.url === 'string' ? entry.url : typeof entry.href === 'string' ? entry.href : undefined;
  const rawPoster = typeof entry.poster === 'string' ? entry.poster : typeof entry.posterUrl === 'string' ? entry.posterUrl : undefined;
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
    const storyId = typeof entry.storyId === 'string' ? entry.storyId : typeof entry.story === 'string' ? entry.story : null;
    const baseUrl = typeof entry.storybookUrl === 'string' ? entry.storybookUrl : typeof entry.baseUrl === 'string' ? entry.baseUrl : null;
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

async function readPreviewManifest(options: {
  projectDir: string;
  repoUrl: string;
  commitSha: string | null;
}): Promise<RepositoryPreviewInput[]> {
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
          results.push(normalized);
          index += 1;
        }
      }
      if (results.length > 0) {
        return results;
      }
    } catch (err) {
      log('Failed to parse preview manifest', { fileName: candidate, error: (err as Error).message });
    }
  }
  return [];
}

async function readReadmeMetadata(
  projectDir: string,
  repoUrl: string,
  commitSha: string | null
): Promise<{ summary: string | null; previews: RepositoryPreviewInput[] }> {
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
      const kind = resolved.toLowerCase().endsWith('.gif') || ref.toLowerCase().endsWith('.gif') ? 'gif' : 'image';
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
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const unixLike = trimmed.replace(/\\/g, '/');
  const normalized = path.posix.normalize(unixLike.replace(/^\.\/?/, ''));
  if (!normalized || normalized === '.') {
    return null;
  }
  if (normalized.startsWith('..')) {
    return null;
  }
  return normalized.replace(/^\/+/g, '');
}

function toRelativePosix(baseDir: string, target: string) {
  const relative = path.relative(baseDir, target);
  return relative.split(path.sep).join('/');
}

function isDockerfileFileName(name: string) {
  const lower = name.toLowerCase();
  return (
    lower === 'dockerfile' ||
    lower.startsWith('dockerfile.') ||
    lower.endsWith('.dockerfile') ||
    lower === 'containerfile'
  );
}

function shouldSkipDirectory(name: string) {
  const lower = name.toLowerCase();
  return (
    lower === '.git' ||
    lower === '.hg' ||
    lower === '.svn' ||
    lower === 'node_modules' ||
    lower === '.next' ||
    lower === 'dist' ||
    lower === 'build' ||
    lower === 'out' ||
    lower === '.cache'
  );
}

async function findDockerfileFallback(projectDir: string, maxDepth = 6, maxEntries = 5000) {
  const queue: { absolute: string; relative: string; depth: number }[] = [
    { absolute: projectDir, relative: '', depth: 0 }
  ];
  let visited = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (visited > maxEntries) {
      break;
    }

    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(current.absolute, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      visited += 1;
      if (visited > maxEntries) {
        break;
      }
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const absolute = path.join(current.absolute, entry.name);
      if (entry.isDirectory()) {
        if (current.depth >= maxDepth) {
          continue;
        }
        if (shouldSkipDirectory(entry.name)) {
          continue;
        }
        queue.push({ absolute, relative, depth: current.depth + 1 });
        continue;
      }
      if (entry.isFile() || entry.isSymbolicLink()) {
        if (isDockerfileFileName(entry.name)) {
          return toRelativePosix(projectDir, absolute);
        }
      }
    }
  }

  return null;
}

async function detectDockerfilePath(projectDir: string, preferredPath?: string) {
  const seen = new Set<string>();
  const candidates: string[] = [];

  const pushCandidate = (value?: string | null) => {
    const normalized = normalizeDockerfileCandidate(value ?? null);
    if (!normalized) {
      return;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      candidates.push(normalized);
    }
  };

  pushCandidate(preferredPath);
  ['Dockerfile', 'docker/Dockerfile', 'deploy/Dockerfile', 'ops/Dockerfile', 'Dockerfile.prod', 'Dockerfile.release', 'Containerfile'].forEach((candidate) =>
    pushCandidate(candidate)
  );

  for (const candidate of candidates) {
    const absolute = path.resolve(projectDir, candidate);
    const relative = path.relative(projectDir, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      continue;
    }
    if (await fileExists(absolute)) {
      return toRelativePosix(projectDir, absolute);
    }
  }

  return findDockerfileFallback(projectDir);
}

async function detectTagsFromDockerfile(projectDir: string, relativePath: string | null) {
  if (!relativePath) {
    return [] as DiscoveredTag[];
  }
  const absolute = path.join(projectDir, relativePath);
  if (!(await fileExists(absolute))) {
    return [] as DiscoveredTag[];
  }

  try {
    const contents = await fs.readFile(absolute, 'utf8');
    const tags: DiscoveredTag[] = [];
    const fromMatch = contents.match(/FROM\s+([^\s]+)/i);
    if (fromMatch) {
      const baseImage = fromMatch[1];
      if (/node:?\s*(\d+)/i.test(baseImage)) {
        const version = baseImage.match(/node:?([\d.]+)/i)?.[1] ?? 'latest';
        tags.push({ key: 'runtime', value: `node${version.replace(/\./g, '')}`, source: 'ingestion:dockerfile' });
        tags.push({ key: 'language', value: 'javascript', source: 'ingestion:dockerfile' });
      }
      if (/python:?/i.test(baseImage)) {
        const version = baseImage.match(/python:?([\d.]+)/i)?.[1];
        tags.push({ key: 'language', value: 'python', source: 'ingestion:dockerfile' });
        if (version) {
          tags.push({ key: 'runtime', value: `python${version.replace(/\./g, '')}`, source: 'ingestion:dockerfile' });
        }
      }
      if (/nginx/i.test(baseImage)) {
        tags.push({ key: 'runtime', value: 'nginx', source: 'ingestion:dockerfile' });
      }
    }
    if (/streamlit/i.test(contents)) {
      tags.push({ key: 'framework', value: 'streamlit', source: 'ingestion:dockerfile' });
    }
    if (/uvicorn/i.test(contents)) {
      tags.push({ key: 'framework', value: 'fastapi', source: 'ingestion:dockerfile' });
    }
    return tags;
  } catch (err) {
    log('Failed to analyze Dockerfile', { error: (err as Error).message });
    return [];
  }
}

function createTagMap(initial: DiscoveredTag[]) {
  const map = new Map<string, DiscoveredTag>();
  for (const tag of initial) {
    addTag(map, tag.key, tag.value, tag.source);
  }
  return map;
}

function addTag(map: Map<string, DiscoveredTag>, key: string, value: string, source: string) {
  const normalizedKey = key.trim();
  const normalizedValue = value.trim();
  if (!normalizedKey || !normalizedValue) {
    return;
  }
  const compoundKey = `${normalizedKey.toLowerCase()}:${normalizedValue.toLowerCase()}`;
  if (!map.has(compoundKey)) {
    map.set(compoundKey, { key: normalizedKey, value: normalizedValue, source });
  }
}

async function processRepository(repository: RepositoryRecord) {
  const startedAt = Date.now();
  let commitSha: string | null = null;
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apphub-ingest-'));
  log('Processing repository', { id: repository.id });

  try {
    await git.clone(repository.repoUrl, workingDir, ['--depth', CLONE_DEPTH, '--single-branch']);
    const repoGit = simpleGit(workingDir);
    try {
      commitSha = await repoGit.revparse(['HEAD']);
    } catch (err) {
      log('Failed to resolve commit SHA', { id: repository.id, error: (err as Error).message });
    }

    const packageMeta = await readPackageMetadata(workingDir);
    const declaredTags = await readTagFile(workingDir);

    const tagMap = createTagMap(
      repository.tags.map((tag) => ({ key: tag.key, value: tag.value, source: tag.source ?? 'author' }))
    );

    for (const tag of packageMeta.tags) {
      addTag(tagMap, tag.key, tag.value, tag.source);
    }

    for (const tag of declaredTags) {
      addTag(tagMap, tag.key, tag.value, tag.source);
    }

    const dockerfilePath = await detectDockerfilePath(workingDir, repository.dockerfilePath);
    if (!dockerfilePath) {
      throw new Error('Dockerfile not found, unable to launch app');
    }

    const dockerTags = await detectTagsFromDockerfile(workingDir, dockerfilePath);
    for (const tag of dockerTags) {
      addTag(tagMap, tag.key, tag.value, tag.source);
    }

    const networkMemberships = await listNetworksForMemberRepository(repository.id);
    for (const networkId of networkMemberships) {
      addTag(tagMap, 'service-network', networkId, 'manifest:service-network');
    }

    const readmeMetadata = await readReadmeMetadata(workingDir, repository.repoUrl, commitSha);
    const manifestPreviews = await readPreviewManifest({
      projectDir: workingDir,
      repoUrl: repository.repoUrl,
      commitSha
    });
    const previewTiles = mergePreviewInputs(manifestPreviews, readmeMetadata.previews);

    const now = new Date().toISOString();
    await upsertRepository({
      id: repository.id,
      name: packageMeta.name ?? repository.name,
      description: readmeMetadata.summary ?? repository.description,
      repoUrl: repository.repoUrl,
      dockerfilePath,
      ingestStatus: 'ready',
      updatedAt: now,
      lastIngestedAt: now,
      ingestError: null,
      tags: Array.from(tagMap.values()),
      ingestAttempts: repository.ingestAttempts
    });
    await replaceRepositoryPreviews(repository.id, previewTiles);
    await replaceRepositoryTags(repository.id, Array.from(tagMap.values()), { clearExisting: true });
    await setRepositoryStatus(repository.id, 'ready', {
      updatedAt: now,
      lastIngestedAt: now,
      ingestError: null,
      eventMessage: 'Ingestion succeeded',
      commitSha,
      durationMs: Date.now() - startedAt
    });

    const build = await createBuild(repository.id, { commitSha });
    if (useInlineQueue) {
      log('Running build inline', { repositoryId: repository.id, buildId: build.id });
      await runBuildJob(build.id);
    } else {
      log('Enqueuing build job', { repositoryId: repository.id, buildId: build.id });
      await enqueueBuildJob(build.id, repository.id);
    }

    log('Repository ingested', { id: repository.id, dockerfilePath });
  } catch (err) {
    const now = new Date().toISOString();
    const message = (err as Error).message ?? 'Unknown error';
    await setRepositoryStatus(repository.id, 'failed', {
      updatedAt: now,
      lastIngestedAt: now,
      ingestError: message.slice(0, 500),
      eventMessage: message,
      durationMs: Date.now() - startedAt,
      commitSha
    });
    log('Ingestion failed', { id: repository.id, error: message });
    throw err;
  } finally {
    await fs.rm(workingDir, { recursive: true, force: true });
  }
}

async function runWorker() {
  log('Starting ingestion worker', {
    queue: INGEST_QUEUE_NAME,
    concurrency: INGEST_CONCURRENCY,
    mode: useInlineQueue ? 'inline' : 'redis'
  });

  const handleJob = async ({ repositoryId }: { repositoryId: string }) => {
    const repository = await getRepositoryById(repositoryId);
    if (!repository) {
      log('Repository missing for job', { repositoryId });
      return;
    }

    const now = new Date().toISOString();
    await setRepositoryStatus(repositoryId, 'processing', {
      updatedAt: now,
      ingestError: null,
      incrementAttempts: true,
      eventMessage: 'Ingestion started'
    });

    const refreshed = await getRepositoryById(repositoryId);
    await processRepository(
      refreshed ?? {
        ...repository,
        ingestStatus: 'processing',
        ingestError: null,
        updatedAt: now
      }
    );
  };

  if (useInlineQueue) {
    let running = true;

    const poll = async () => {
      try {
        while (true) {
          const pending = await takeNextPendingRepository();
          if (!pending) {
            break;
          }
          await handleJob({ repositoryId: pending.id });
        }
      } catch (err) {
        log('Inline worker poll error', { error: (err as Error).message });
      }
    };

    const interval = setInterval(() => {
      if (!running) {
        return;
      }
      void poll();
    }, 200);

    void poll();

    log('Inline ingestion worker ready');

    const shutdown = async () => {
      running = false;
      clearInterval(interval);
      log('Shutdown signal received');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return;
  }

  const connection = getQueueConnection();
  const { Worker } = await import('bullmq');

  const worker = new Worker(
    INGEST_QUEUE_NAME,
    async (job) => {
      const { repositoryId } = job.data as { repositoryId: string };
      log('Job received', { repositoryId, jobId: job.id });
      await handleJob({ repositoryId });
    },
    {
      connection,
      concurrency: INGEST_CONCURRENCY
    }
  );

  worker.on('failed', (job, err) => {
    log('Worker job failed', {
      jobId: job?.id ?? 'unknown',
      error: err?.message ?? 'unknown'
    });
  });

  worker.on('completed', (job) => {
    log('Worker job completed', { jobId: job.id });
  });

  await worker.waitUntilReady();
  log('Ingestion worker ready');

  const shutdown = async () => {
    log('Shutdown signal received');
    await worker.close();
    try {
      await closeQueueConnection(connection);
    } catch (err) {
      log('Error closing Redis connection', { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

runWorker().catch((err) => {
  console.error('[ingest] Worker crashed', err);
  process.exit(1);
});
