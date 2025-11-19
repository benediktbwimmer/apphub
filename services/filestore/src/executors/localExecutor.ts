import { createReadStream as createFsReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { FilestoreError, assertUnreachable } from '../errors';
import type { BackendMountRecord } from '../db/backendMounts';
import type { FilestoreCommand } from '../commands/types';
import type {
  CommandExecutor,
  ExecutorContext,
  ExecutorFileMetadata,
  ExecutorReadStreamResult,
  ExecutorResult
} from './types';

function ensureLocalBackend(backend: BackendMountRecord): asserts backend is BackendMountRecord & {
  backendKind: 'local';
  rootPath: string;
} {
  if (backend.backendKind !== 'local') {
    throw new FilestoreError('Local executor received non-local backend', 'EXECUTOR_NOT_FOUND', {
      backendKind: backend.backendKind
    });
  }

  if (!backend.rootPath) {
    throw new FilestoreError('Local backend missing root path', 'BACKEND_NOT_FOUND', {
      backendId: backend.id
    });
  }
}

async function statOptional(target: string) {
  try {
    return await fs.stat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function moveFileReplacing(source: string, destination: string): Promise<void> {
  try {
    await fs.rename(source, destination);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await fs.copyFile(source, destination);
      await fs.unlink(source);
      return;
    }
    throw err;
  }
}

async function copyDirectoryRecursive(source: string, destination: string): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(sourcePath, destinationPath);
    } else {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

export function createLocalExecutor(): CommandExecutor {
  return {
    kind: 'local',
    async head(targetPath, context) {
      ensureLocalBackend(context.backend);
      const root = context.backend.rootPath;
      const resolvedRoot = path.resolve(root);
      const resolved = path.resolve(resolvedRoot, targetPath);
      if (!resolved.startsWith(resolvedRoot)) {
        throw new FilestoreError('Resolved path escapes backend root', 'INVALID_PATH', {
          root,
          requestedPath: targetPath
        });
      }

      const stats = await statOptional(resolved);
      if (!stats || !stats.isFile()) {
        return null;
      }

      return {
        sizeBytes: stats.size,
        lastModifiedAt: stats.mtime
      } satisfies ExecutorFileMetadata;
    },
    async createReadStream(targetPath, context, options) {
      ensureLocalBackend(context.backend);
      const root = context.backend.rootPath;
      const resolvedRoot = path.resolve(root);
      const resolved = path.resolve(resolvedRoot, targetPath);
      if (!resolved.startsWith(resolvedRoot)) {
        throw new FilestoreError('Resolved path escapes backend root', 'INVALID_PATH', {
          root,
          requestedPath: targetPath
        });
      }

      const stats = await statOptional(resolved);
      if (!stats) {
        throw new FilestoreError('File not found for download', 'NODE_NOT_FOUND', {
          path: targetPath
        });
      }
      if (!stats.isFile()) {
        throw new FilestoreError('Requested node is not a file', 'NOT_A_DIRECTORY', {
          path: targetPath
        });
      }

      const totalSize = stats.size;
      const range = options?.range;
      const start = range ? range.start : 0;
      const end = range ? range.end : Math.max(totalSize - 1, 0);
      const length = range ? end - start + 1 : totalSize;
      const stream = createFsReadStream(resolved, range ? { start, end } : undefined);

      return {
        stream,
        contentLength: length,
        totalSize,
        lastModifiedAt: stats.mtime,
        contentType: null
      } satisfies ExecutorReadStreamResult;
    },
    async execute(command: FilestoreCommand, context: ExecutorContext): Promise<ExecutorResult> {
      ensureLocalBackend(context.backend);
      const root = context.backend.rootPath;
      const relativePath = 'path' in command ? command.path : '';
      const resolved = path.resolve(root, relativePath);
      if (!resolved.startsWith(path.resolve(root))) {
        throw new FilestoreError('Resolved path escapes backend root', 'INVALID_PATH', {
          root,
          requestedPath: relativePath
        });
      }

      switch (command.type) {
        case 'createDirectory': {
          await fs.mkdir(resolved, { recursive: true });
          const stats = await fs.stat(resolved);
          return {
            sizeBytes: 0,
            lastModifiedAt: stats.mtime,
            metadata: command.metadata ?? null
          };
        }
        case 'deleteNode': {
          const stats = await statOptional(resolved);
          if (!stats) {
            return {};
          }

          if (stats.isDirectory()) {
            if (command.recursive) {
              await fs.rm(resolved, { recursive: true, force: true });
            } else {
              await fs.rmdir(resolved);
            }
          } else {
            await fs.unlink(resolved);
          }

          return {
            sizeBytes: 0,
            lastModifiedAt: new Date()
          };
        }
        case 'moveNode': {
          if (typeof command.targetPath !== 'string') {
            throw new FilestoreError('Target path is required for move', 'INVALID_PATH');
          }
          const targetResolved = path.resolve(root, command.targetPath);
          if (!targetResolved.startsWith(path.resolve(root))) {
            throw new FilestoreError('Resolved target path escapes backend root', 'INVALID_PATH', {
              root,
              requestedPath: command.targetPath
            });
          }
          await fs.mkdir(path.dirname(targetResolved), { recursive: true });
          await fs.rename(resolved, targetResolved);
          const stats = await statOptional(targetResolved);
          return {
            sizeBytes: stats?.isDirectory() ? 0 : stats?.size ?? null,
            lastModifiedAt: stats?.mtime ?? new Date()
          } satisfies ExecutorResult;
        }
        case 'copyNode': {
          if (typeof command.targetPath !== 'string') {
            throw new FilestoreError('Target path is required for copy', 'INVALID_PATH');
          }
          const targetResolved = path.resolve(root, command.targetPath);
          if (!targetResolved.startsWith(path.resolve(root))) {
            throw new FilestoreError('Resolved target path escapes backend root', 'INVALID_PATH', {
              root,
              requestedPath: command.targetPath
            });
          }

          const sourceStats = await statOptional(resolved);
          if (!sourceStats) {
            throw new FilestoreError('Source path not found for copy', 'NODE_NOT_FOUND', {
              path: command.path
            });
          }

          const sourceIsDirectory = sourceStats.isDirectory();
          const existingTarget = await statOptional(targetResolved);
          if (existingTarget) {
            const targetIsDirectory = existingTarget.isDirectory();
            if (targetIsDirectory !== sourceIsDirectory) {
              throw new FilestoreError('Target path already exists', 'NODE_EXISTS', {
                targetPath: command.targetPath
              });
            }
            return {
              sizeBytes: targetIsDirectory ? 0 : existingTarget.size ?? null,
              lastModifiedAt: existingTarget.mtime ?? new Date()
            } satisfies ExecutorResult;
          }

          await fs.mkdir(path.dirname(targetResolved), { recursive: true });

          if (sourceIsDirectory) {
            await copyDirectoryRecursive(resolved, targetResolved);
            return {
              sizeBytes: 0,
              lastModifiedAt: new Date()
            } satisfies ExecutorResult;
          }

          await fs.copyFile(resolved, targetResolved);
          const copiedStats = await statOptional(targetResolved);
          return {
            sizeBytes: copiedStats?.size ?? sourceStats.size,
            lastModifiedAt: copiedStats?.mtime ?? new Date()
          } satisfies ExecutorResult;
        }
        case 'uploadFile':
        case 'writeFile': {
          const resolved = path.resolve(root, command.path);
          if (!resolved.startsWith(path.resolve(root))) {
            throw new FilestoreError('Resolved path escapes backend root', 'INVALID_PATH', {
              root,
              requestedPath: command.path
            });
          }

          if (!command.stagingPath || command.stagingPath.trim().length === 0) {
            throw new FilestoreError('Staging path missing for upload', 'INVALID_REQUEST');
          }

          const stagingStats = await statOptional(command.stagingPath);
          if (!stagingStats || !stagingStats.isFile()) {
            throw new FilestoreError('Staging file missing for upload', 'NODE_NOT_FOUND', {
              stagingPath: command.stagingPath
            });
          }

          let targetStats = await statOptional(resolved);
          if (targetStats && targetStats.isDirectory()) {
            throw new FilestoreError('Cannot overwrite directory with file', 'NOT_A_DIRECTORY', {
              path: command.path
            });
          }
          if (command.type === 'uploadFile' && targetStats) {
            if (!command.overwrite) {
              throw new FilestoreError('Target path already exists', 'NODE_EXISTS', {
                path: command.path
              });
            }
            await fs.unlink(resolved).catch((err: NodeJS.ErrnoException) => {
              if (err.code !== 'ENOENT') {
                throw err;
              }
            });
            targetStats = null;
          }

          await fs.mkdir(path.dirname(resolved), { recursive: true });
          await moveFileReplacing(command.stagingPath, resolved);

          const finalStats = await statOptional(resolved);
          return {
            sizeBytes: finalStats?.size ?? stagingStats.size,
            checksum: command.checksum ?? null,
            contentHash: command.contentHash ?? null,
            lastModifiedAt: finalStats?.mtime ?? new Date()
          } satisfies ExecutorResult;
        }
        case 'updateNodeMetadata': {
          return {};
        }
        default:
          return assertUnreachable(command);
      }
    }
  } satisfies CommandExecutor;
}
