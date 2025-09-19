import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import simpleGit from 'simple-git';
import YAML from 'yaml';
import {
  createBuild,
  getRepositoryById,
  upsertRepository,
  setRepositoryStatus,
  takeNextPendingRepository,
  type RepositoryRecord,
  type TagKV
} from './db';
import {
  INGEST_QUEUE_NAME,
  enqueueBuildJob,
  getQueueConnection,
  isInlineQueueMode
} from './queue';
import { runBuildJob } from './buildRunner';

const CLONE_DEPTH = process.env.INGEST_CLONE_DEPTH ?? '1';
const INGEST_CONCURRENCY = Number(process.env.INGEST_CONCURRENCY ?? 2);
const useInlineQueue = isInlineQueueMode();

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

async function readReadmeSummary(projectDir: string) {
  const readmePath = path.join(projectDir, 'README.md');
  if (!(await fileExists(readmePath))) {
    return null;
  }
  try {
    const raw = await fs.readFile(readmePath, 'utf8');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    return lines[0] ?? null;
  } catch (err) {
    log('Failed to read README', { error: (err as Error).message });
    return null;
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

    const readmeSummary = await readReadmeSummary(workingDir);

    const now = new Date().toISOString();
    upsertRepository({
      id: repository.id,
      name: packageMeta.name ?? repository.name,
      description: readmeSummary ?? repository.description,
      repoUrl: repository.repoUrl,
      dockerfilePath,
      ingestStatus: 'ready',
      updatedAt: now,
      lastIngestedAt: now,
      ingestError: null,
      tags: Array.from(tagMap.values())
    });
    setRepositoryStatus(repository.id, 'ready', {
      updatedAt: now,
      lastIngestedAt: now,
      ingestError: null,
      eventMessage: 'Ingestion succeeded',
      commitSha,
      durationMs: Date.now() - startedAt
    });

    const build = createBuild(repository.id, { commitSha });
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
    setRepositoryStatus(repository.id, 'failed', {
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
    const repository = getRepositoryById(repositoryId);
    if (!repository) {
      log('Repository missing for job', { repositoryId });
      return;
    }

    const now = new Date().toISOString();
    setRepositoryStatus(repositoryId, 'processing', {
      updatedAt: now,
      ingestError: null,
      incrementAttempts: true,
      eventMessage: 'Ingestion started'
    });

    const refreshed = getRepositoryById(repositoryId);
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
        let pending: RepositoryRecord | null;
        while ((pending = takeNextPendingRepository())) {
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
      await connection.quit();
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
