import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
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

type FileRelocatorParameters = {
  dropId: string;
  sourcePath: string;
  relativePath: string;
  destinationDir: string;
  destinationFilename: string;
};

type FileRelocationResult = {
  dropId: string;
  sourcePath: string;
  destinationPath: string;
  relativePath: string;
  bytesMoved: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  attempts: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireString(value: unknown, field: keyof FileRelocatorParameters): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${String(field)} is required`);
  }
  return value.trim();
}

function sanitizeRelativePath(candidate: string): string {
  const normalized = path.normalize(candidate).replace(/^\.\/+/, '');
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`relativePath cannot escape the destination root: ${candidate}`);
  }
  return normalized;
}

async function ensureDirectory(dirPath: string) {
  await mkdir(dirPath, { recursive: true });
}

async function resolveDestinationPath(dirPath: string, filename: string): Promise<{ path: string; attempts: number }> {
  const ext = path.extname(filename);
  const name = path.basename(filename, ext);
  let attempts = 0;
  let candidate = path.join(dirPath, filename);

  while (attempts < 1000) {
    try {
      await stat(candidate);
      attempts += 1;
      const suffix = `-${attempts}`;
      candidate = path.join(dirPath, `${name}${suffix}${ext}`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { path: candidate, attempts: attempts + 1 };
      }
      throw err;
    }
  }

  throw new Error('Unable to resolve unique destination filename after 1000 attempts');
}

async function moveFile(sourcePath: string, destinationPath: string) {
  try {
    await rename(sourcePath, destinationPath);
    return;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== 'EXDEV') {
      throw err;
    }
  }

  await copyFile(sourcePath, destinationPath);
  await unlink(sourcePath);
}

function normalizeParameters(raw: unknown): FileRelocatorParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const dropId = requireString(raw.dropId, 'dropId');
  const sourcePath = path.resolve(requireString(raw.sourcePath, 'sourcePath'));
  const relativePath = sanitizeRelativePath(requireString(raw.relativePath, 'relativePath'));
  const destinationDir = path.resolve(requireString(raw.destinationDir, 'destinationDir'));
  const destinationFilenameRaw = raw.destinationFilename;
  const destinationFilename =
    typeof destinationFilenameRaw === 'string' && destinationFilenameRaw.trim().length > 0
      ? destinationFilenameRaw.trim()
      : path.basename(relativePath);

  return {
    dropId,
    sourcePath,
    relativePath,
    destinationDir,
    destinationFilename
  } satisfies FileRelocatorParameters;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: FileRelocatorParameters;
  try {
    parameters = normalizeParameters(context.parameters);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  }

  const startedAt = new Date();
  const relativeDir = path.dirname(parameters.relativePath);
  const destinationDir = path.join(parameters.destinationDir, relativeDir === '.' ? '' : relativeDir);

  try {
    const stats = await stat(parameters.sourcePath);
    if (!stats.isFile()) {
      throw new Error(`Source path is not a file: ${parameters.sourcePath}`);
    }

    await context.update({ status: 'preparing', dropId: parameters.dropId, sourcePath: parameters.sourcePath });

    await ensureDirectory(destinationDir);
    const { path: destinationPath, attempts } = await resolveDestinationPath(
      destinationDir,
      parameters.destinationFilename
    );

    await context.update({ status: 'moving', dropId: parameters.dropId, destinationPath });

    await moveFile(parameters.sourcePath, destinationPath);

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const result: FileRelocationResult = {
      dropId: parameters.dropId,
      sourcePath: parameters.sourcePath,
      destinationPath,
      relativePath: parameters.relativePath,
      bytesMoved: stats.size,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs,
      attempts
    } satisfies FileRelocationResult;

    await context.update({ status: 'completed', dropId: parameters.dropId, destinationPath, bytesMoved: stats.size });

    context.logger('file-relocated', {
      dropId: result.dropId,
      destinationPath: result.destinationPath,
      bytesMoved: result.bytesMoved,
      attempts: result.attempts
    });

    return {
      status: 'succeeded',
      result
    } satisfies JobRunResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger('relocation-failed', {
      dropId: parameters.dropId,
      error: message
    });
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  }
}

export default handler;
