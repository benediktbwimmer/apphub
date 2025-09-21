import path from 'node:path';
import { Buffer } from 'node:buffer';
import { promises as fs, constants as fsConstants, type Stats } from 'node:fs';
import { registerJobHandler, type JobRunContext, type JobResult } from './runtime';

const HOST_ROOT_MOUNT = process.env.APPHUB_HOST_ROOT ?? process.env.HOST_ROOT_PATH ?? '/root-fs';
const DEFAULT_ENCODING: BufferEncoding = 'utf8';

const ENCODING_ALIASES: Record<string, BufferEncoding> = {
  utf8: 'utf8',
  'utf-8': 'utf8',
  utf16le: 'utf16le',
  'utf-16le': 'utf16le',
  latin1: 'latin1',
  ascii: 'ascii',
  base64: 'base64',
  hex: 'hex'
};

type ResolvedPath = {
  hostPath: string;
  containerPath: string;
  effectivePath: string;
};

type ResolvedReadablePath = ResolvedPath & {
  stats: Stats;
};

function normalizeEncoding(candidate: unknown, fallback: BufferEncoding = DEFAULT_ENCODING): BufferEncoding {
  if (typeof candidate !== 'string') {
    return fallback;
  }
  const key = candidate.trim().toLowerCase();
  if (!key) {
    return fallback;
  }
  return ENCODING_ALIASES[key] ?? fallback;
}

function ensureAbsolutePath(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} parameter is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldName} parameter is required`);
  }
  if (!path.isAbsolute(trimmed)) {
    throw new Error(`${fieldName} must be an absolute path`);
  }
  return path.normalize(trimmed);
}

function buildCandidatePaths(normalizedHostPath: string): { containerPath: string; candidates: string[] } {
  const relativeFromRoot = path.relative('/', normalizedHostPath);
  const hasHostRoot = Boolean(HOST_ROOT_MOUNT && path.isAbsolute(HOST_ROOT_MOUNT));
  const containerPath = hasHostRoot && !relativeFromRoot.startsWith('..')
    ? path.join(HOST_ROOT_MOUNT, relativeFromRoot)
    : normalizedHostPath;

  const candidates: string[] = [];
  if (hasHostRoot && !relativeFromRoot.startsWith('..')) {
    candidates.push(containerPath);
  }
  candidates.push(normalizedHostPath);
  return { containerPath, candidates };
}

async function resolveReadableFile(hostPath: string): Promise<ResolvedReadablePath> {
  const normalizedHostPath = ensureAbsolutePath(hostPath, 'hostPath');
  const { containerPath, candidates } = buildCandidatePaths(normalizedHostPath);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const stats = await fs.stat(candidate, { bigint: false });
      if (!stats.isFile()) {
        errors.push(`${candidate} is not a regular file`);
        continue;
      }
      await fs.access(candidate, fsConstants.R_OK);
      return {
        hostPath: normalizedHostPath,
        containerPath,
        effectivePath: candidate,
        stats
      };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const reason = errors.length > 0 ? `: ${errors.join('; ')}` : '';
  throw new Error(`Unable to read file at ${hostPath}${reason}`);
}

async function resolveWritablePath(targetHostPath: string): Promise<ResolvedPath> {
  const normalizedHostPath = ensureAbsolutePath(targetHostPath, 'targetPath');
  const { containerPath, candidates } = buildCandidatePaths(normalizedHostPath);
  const errors: string[] = [];

  for (const candidate of candidates) {
    try {
      const parentDir = path.dirname(candidate);
      await fs.mkdir(parentDir, { recursive: true });
      await fs.access(parentDir, fsConstants.W_OK);
      return {
        hostPath: normalizedHostPath,
        containerPath,
        effectivePath: candidate
      };
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const reason = errors.length > 0 ? `: ${errors.join('; ')}` : '';
  throw new Error(`Unable to resolve writable path for ${targetHostPath}${reason}`);
}

registerJobHandler('fs-read-file', async (context: JobRunContext): Promise<JobResult> => {
  const params = (context.parameters ?? {}) as Record<string, unknown>;
  const hostPath = ensureAbsolutePath(params.hostPath, 'hostPath');
  const encoding = normalizeEncoding(params.encoding);

  context.logger('Reading file from host filesystem', { hostPath });

  const resolved = await resolveReadableFile(hostPath);
  const content = await fs.readFile(resolved.effectivePath, { encoding });
  const byteLength = Buffer.byteLength(content, encoding);
  const directory = path.dirname(resolved.hostPath);
  const fileName = path.basename(resolved.hostPath);

  await context.update({
    metrics: {
      bytesRead: byteLength,
      hostPath: resolved.hostPath
    }
  });

  return {
    status: 'succeeded',
    result: {
      hostPath: resolved.hostPath,
      containerPath: resolved.containerPath,
      resolvedPath: resolved.effectivePath,
      encoding,
      size: resolved.stats.size,
      byteLength,
      modifiedAt: resolved.stats.mtime.toISOString(),
      createdAt: resolved.stats.birthtime.toISOString(),
      directory,
      fileName,
      content
    }
  } satisfies JobResult;
});

registerJobHandler('fs-write-file', async (context: JobRunContext): Promise<JobResult> => {
  const params = (context.parameters ?? {}) as Record<string, unknown>;
  const sourcePath = ensureAbsolutePath(params.sourcePath, 'sourcePath');

  const explicitOutputPath =
    typeof params.outputPath === 'string' && params.outputPath.trim().length > 0
      ? ensureAbsolutePath(params.outputPath, 'outputPath')
      : undefined;

  const outputFilenameRaw = typeof params.outputFilename === 'string' ? params.outputFilename.trim() : '';
  if (outputFilenameRaw && outputFilenameRaw.includes(path.sep)) {
    throw new Error('outputFilename must not include path separators');
  }

  const content = params.content;
  if (typeof content !== 'string') {
    throw new Error('content parameter is required and must be a string');
  }

  const encoding = normalizeEncoding(params.encoding);
  const overwrite = typeof params.overwrite === 'boolean' ? params.overwrite : true;

  const targetHostPath = explicitOutputPath
    ? explicitOutputPath
    : path.join(
        path.dirname(sourcePath),
        outputFilenameRaw || `${path.basename(sourcePath)}.summary.txt`
      );

  context.logger('Writing summary file to host filesystem', {
    sourcePath,
    targetHostPath,
    overwrite
  });

  const resolved = await resolveWritablePath(targetHostPath);

  let existed = false;
  try {
    await fs.access(resolved.effectivePath, fsConstants.F_OK);
    existed = true;
  } catch {
    existed = false;
  }

  if (existed && !overwrite) {
    throw new Error(`File already exists at ${targetHostPath} and overwrite is disabled`);
  }

  await fs.writeFile(resolved.effectivePath, content, { encoding });
  const stats = await fs.stat(resolved.effectivePath);
  const bytesWritten = Buffer.byteLength(content, encoding);
  const directory = path.dirname(resolved.hostPath);
  const fileName = path.basename(resolved.hostPath);

  await context.update({
    metrics: {
      bytesWritten,
      hostPath: resolved.hostPath,
      overwrite: existed
    }
  });

  return {
    status: 'succeeded',
    result: {
      sourcePath,
      hostPath: resolved.hostPath,
      containerPath: resolved.containerPath,
      resolvedPath: resolved.effectivePath,
      encoding,
      bytesWritten,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      createdAt: stats.birthtime.toISOString(),
      overwroteExisting: existed,
      directory,
      fileName
    }
  } satisfies JobResult;
});
