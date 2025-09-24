import { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

type JobRunStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

type JobRunResult = {
  status?: JobRunStatus;
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

type ScanJobParameters = {
  scanDir: string;
  maxEntries?: number;
};

type FileSummary = {
  path: string;
  relativePath: string;
  size: number;
  extension: string;
  depth: number;
  modifiedAt: string | null;
};

type DirectorySummary = {
  path: string;
  relativePath: string;
  depth: number;
  directFileCount: number;
  totalFileCount: number;
  directSubdirectoryCount: number;
  totalSubdirectoryCount: number;
  totalSize: number;
  latestModifiedAt: string | null;
};

type ExtensionStat = {
  extension: string;
  count: number;
  totalSize: number;
  averageSize: number;
};

type SizeBucketStat = {
  bucket: string;
  count: number;
  totalSize: number;
};

type DepthStat = {
  depth: number;
  directoryCount: number;
  fileCount: number;
  totalSize: number;
};

type ScanJobResult = {
  rootPath: string;
  generatedAt: string;
  durationMs: number;
  summary: {
    totalFiles: number;
    totalDirectories: number;
    totalSize: number;
    averageFileSize: number;
    maxDepth: number;
    earliestModifiedAt: string | null;
    latestModifiedAt: string | null;
    truncated: boolean;
    maxEntries: number;
  };
  directories: DirectorySummary[];
  extensionStats: ExtensionStat[];
  sizeDistribution: SizeBucketStat[];
  depthStats: DepthStat[];
  largestFiles: FileSummary[];
  directoriesBySize: Array<{
    relativePath: string;
    totalSize: number;
    totalFileCount: number;
  }>;
  issues: Array<{ path: string; message: string }>;
};

type WalkAccumulator = {
  parameters: Required<Pick<ScanJobParameters, 'scanDir' | 'maxEntries'>>;
  rootPath: string;
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  maxDepth: number;
  earliestModified: number | null;
  latestModified: number | null;
  entriesProcessed: number;
  truncated: boolean;
  directories: DirectorySummary[];
  topFiles: FileSummary[];
  extensionStats: Map<string, { count: number; totalSize: number }>;
  sizeBuckets: Map<string, { count: number; totalSize: number }>;
  depthStats: Map<number, { directoryCount: number; fileCount: number; totalSize: number }>;
  issues: Array<{ path: string; message: string }>;
};

const DEFAULT_MAX_ENTRIES = 20_000;
const MAX_TOP_FILES = 40;
const MAX_RECORDED_ISSUES = 50;

const SIZE_BUCKETS: ReadonlyArray<{ label: string; max: number }> = [
  { label: '0-1KB', max: 1024 },
  { label: '1-10KB', max: 10 * 1024 },
  { label: '10-100KB', max: 100 * 1024 },
  { label: '100KB-1MB', max: 1024 * 1024 },
  { label: '1-10MB', max: 10 * 1024 * 1024 },
  { label: '>10MB', max: Number.POSITIVE_INFINITY }
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeParameters(raw: unknown): ScanJobParameters {
  if (!isRecord(raw)) {
    throw new Error('Job parameters must be an object');
  }

  const scanDirRaw = raw.scanDir ?? raw['directory'];
  if (typeof scanDirRaw !== 'string' || scanDirRaw.trim().length === 0) {
    throw new Error('scanDir parameter is required');
  }

  const maxEntriesValue = raw.maxEntries;
  let maxEntries = DEFAULT_MAX_ENTRIES;
  if (typeof maxEntriesValue === 'number' && Number.isFinite(maxEntriesValue)) {
    maxEntries = Math.max(1000, Math.min(200_000, Math.floor(maxEntriesValue)));
  }

  return {
    scanDir: scanDirRaw,
    maxEntries
  } satisfies ScanJobParameters;
}

function trackIssue(state: WalkAccumulator, targetPath: string, err: unknown) {
  if (state.issues.length >= MAX_RECORDED_ISSUES) {
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  state.issues.push({ path: targetPath, message });
}

function classifyExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext || '[no-ext]';
}

function classifySizeBucket(size: number): string {
  for (const bucket of SIZE_BUCKETS) {
    if (size <= bucket.max) {
      return bucket.label;
    }
  }
  return SIZE_BUCKETS[SIZE_BUCKETS.length - 1]?.label ?? '>10MB';
}

function bucketOrder(label: string): number {
  const index = SIZE_BUCKETS.findIndex((entry) => entry.label === label);
  return index === -1 ? SIZE_BUCKETS.length : index;
}

function recordDepth(
  stats: Map<number, { directoryCount: number; fileCount: number; totalSize: number }>,
  depth: number,
  kind: 'directory' | 'file',
  size = 0
) {
  const current =
    stats.get(depth) ?? {
      directoryCount: 0,
      fileCount: 0,
      totalSize: 0
    };
  if (kind === 'directory') {
    current.directoryCount += 1;
  } else {
    current.fileCount += 1;
    current.totalSize += size;
  }
  stats.set(depth, current);
}

function trackTopFiles(target: FileSummary[], entry: FileSummary) {
  target.push(entry);
  target.sort((a, b) => b.size - a.size);
  if (target.length > MAX_TOP_FILES) {
    target.length = MAX_TOP_FILES;
  }
}

type WalkResult = {
  totalSize: number;
  fileCount: number;
  subdirectoryCount: number;
  maxDepth: number;
  latestModified: number | null;
};

async function walkDirectory(
  state: WalkAccumulator,
  absolutePath: string,
  relativePath: string,
  depth: number
): Promise<WalkResult> {
  if (state.truncated || state.entriesProcessed >= state.parameters.maxEntries) {
    state.truncated = true;
    return { totalSize: 0, fileCount: 0, subdirectoryCount: 0, maxDepth: depth, latestModified: null };
  }

  let dirEntries: Dirent[];
  try {
    dirEntries = await readdir(absolutePath, { withFileTypes: true });
  } catch (err) {
    trackIssue(state, absolutePath, err);
    return { totalSize: 0, fileCount: 0, subdirectoryCount: 0, maxDepth: depth, latestModified: null };
  }

  state.entriesProcessed += 1;
  state.totalDirectories += 1;
  recordDepth(state.depthStats, depth, 'directory');

  let totalSize = 0;
  let fileCount = 0;
  let subdirectoryCount = 0;
  let maxObservedDepth = depth;
  let latestModified: number | null = null;
  let directFileCount = 0;
  let directSubdirectoryCount = 0;

  for (const entry of dirEntries) {
    if (state.truncated || state.entriesProcessed >= state.parameters.maxEntries) {
      state.truncated = true;
      break;
    }

    const entryAbsolute = path.join(absolutePath, entry.name);
    const entryRelative = relativePath ? path.join(relativePath, entry.name) : entry.name;

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      directSubdirectoryCount += 1;
      const child = await walkDirectory(state, entryAbsolute, entryRelative, depth + 1);
      totalSize += child.totalSize;
      fileCount += child.fileCount;
      subdirectoryCount += child.subdirectoryCount + 1;
      maxObservedDepth = Math.max(maxObservedDepth, child.maxDepth);
      if (child.latestModified !== null) {
        latestModified = Math.max(latestModified ?? child.latestModified, child.latestModified);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    state.entriesProcessed += 1;
    let fileStat;
    try {
      fileStat = await stat(entryAbsolute);
    } catch (err) {
      trackIssue(state, entryAbsolute, err);
      continue;
    }

    const size = Number(fileStat.size) || 0;
    const mtimeMs = typeof fileStat.mtimeMs === 'number' ? fileStat.mtimeMs : fileStat.mtime.getTime();
    const fileDepth = depth + 1;

    totalSize += size;
    fileCount += 1;
    state.totalFiles += 1;
    state.totalSize += size;
    state.maxDepth = Math.max(state.maxDepth, fileDepth);

    if (state.earliestModified === null || mtimeMs < state.earliestModified) {
      state.earliestModified = mtimeMs;
    }
    if (state.latestModified === null || mtimeMs > state.latestModified) {
      state.latestModified = mtimeMs;
    }

    latestModified = latestModified === null ? mtimeMs : Math.max(latestModified, mtimeMs);

    const extension = classifyExtension(entry.name);
    const extStat = state.extensionStats.get(extension) ?? { count: 0, totalSize: 0 };
    extStat.count += 1;
    extStat.totalSize += size;
    state.extensionStats.set(extension, extStat);

    const bucket = classifySizeBucket(size);
    const bucketStat = state.sizeBuckets.get(bucket) ?? { count: 0, totalSize: 0 };
    bucketStat.count += 1;
    bucketStat.totalSize += size;
    state.sizeBuckets.set(bucket, bucketStat);

    recordDepth(state.depthStats, fileDepth, 'file', size);

    const fileSummary: FileSummary = {
      path: entryAbsolute,
      relativePath: entryRelative,
      size,
      extension,
      depth: fileDepth,
      modifiedAt: Number.isFinite(mtimeMs) ? new Date(mtimeMs).toISOString() : null
    };
    trackTopFiles(state.topFiles, fileSummary);
    directFileCount += 1;
  }

  const directorySummary: DirectorySummary = {
    path: absolutePath,
    relativePath: relativePath || '.',
    depth,
    directFileCount,
    totalFileCount: fileCount,
    directSubdirectoryCount,
    totalSubdirectoryCount: subdirectoryCount,
    totalSize,
    latestModifiedAt: latestModified !== null && Number.isFinite(latestModified)
      ? new Date(latestModified).toISOString()
      : null
  };
  state.directories.push(directorySummary);

  return {
    totalSize,
    fileCount,
    subdirectoryCount,
    maxDepth: maxObservedDepth,
    latestModified
  };
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  const start = Date.now();
  let parameters: ScanJobParameters;
  try {
    parameters = normalizeParameters(context.parameters);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'invalid parameters';
    return { status: 'failed', errorMessage: message } satisfies JobRunResult;
  }

  const rootPath = path.resolve(parameters.scanDir);
  context.logger('directory-scan:start', { rootPath, maxEntries: parameters.maxEntries });

  const state: WalkAccumulator = {
    parameters: {
      scanDir: rootPath,
      maxEntries: parameters.maxEntries ?? DEFAULT_MAX_ENTRIES
    },
    rootPath,
    totalFiles: 0,
    totalDirectories: 0,
    totalSize: 0,
    maxDepth: 0,
    earliestModified: null,
    latestModified: null,
    entriesProcessed: 0,
    truncated: false,
    directories: [],
    topFiles: [],
    extensionStats: new Map(),
    sizeBuckets: new Map(),
    depthStats: new Map(),
    issues: []
  };

  try {
    await walkDirectory(state, rootPath, '', 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Directory scan failed';
    context.logger('directory-scan:error', { error: message });
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  }

  const extensionStats: ExtensionStat[] = Array.from(state.extensionStats.entries())
    .map(([extension, value]) => ({
      extension,
      count: value.count,
      totalSize: value.totalSize,
      averageSize: value.count > 0 ? value.totalSize / value.count : 0
    }))
    .sort((a, b) => b.totalSize - a.totalSize || b.count - a.count);

  const sizeDistribution: SizeBucketStat[] = Array.from(state.sizeBuckets.entries())
    .map(([bucket, value]) => ({ bucket, count: value.count, totalSize: value.totalSize }))
    .sort((a, b) => bucketOrder(a.bucket) - bucketOrder(b.bucket));

  const depthStats: DepthStat[] = Array.from(state.depthStats.entries())
    .map(([depth, value]) => ({ depth, ...value }))
    .sort((a, b) => a.depth - b.depth);

  const directories = state.directories.slice().sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const directoriesBySize = state.directories
    .slice()
    .sort((a, b) => b.totalSize - a.totalSize)
    .slice(0, 25)
    .map((dir) => ({
      relativePath: dir.relativePath,
      totalSize: dir.totalSize,
      totalFileCount: dir.totalFileCount
    }));

  const summary: ScanJobResult['summary'] = {
    totalFiles: state.totalFiles,
    totalDirectories: state.totalDirectories,
    totalSize: state.totalSize,
    averageFileSize: state.totalFiles > 0 ? state.totalSize / state.totalFiles : 0,
    maxDepth: state.maxDepth,
    earliestModifiedAt:
      state.earliestModified !== null && Number.isFinite(state.earliestModified)
        ? new Date(state.earliestModified).toISOString()
        : null,
    latestModifiedAt:
      state.latestModified !== null && Number.isFinite(state.latestModified)
        ? new Date(state.latestModified).toISOString()
        : null,
    truncated: state.truncated,
    maxEntries: state.parameters.maxEntries
  };

  const result: ScanJobResult = {
    rootPath,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
    summary,
    directories,
    extensionStats,
    sizeDistribution,
    depthStats,
    largestFiles: state.topFiles,
    directoriesBySize,
    issues: state.issues
  } satisfies ScanJobResult;

  context.logger('directory-scan:complete', {
    rootPath,
    totalFiles: summary.totalFiles,
    totalDirectories: summary.totalDirectories,
    truncated: summary.truncated
  });

  await context.update({ metrics: { totalFiles: summary.totalFiles, totalDirectories: summary.totalDirectories } });

  return {
    status: 'succeeded',
    result
  } satisfies JobRunResult;
}

export default handler;
