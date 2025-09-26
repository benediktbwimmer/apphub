import { promises as fs } from 'node:fs';
import path from 'node:path';
import { FilestoreError, assertUnreachable } from '../errors';
import type { BackendMountRecord } from '../db/backendMounts';
import type { FilestoreCommand } from '../commands/types';
import type { CommandExecutor, ExecutorContext, ExecutorResult } from './types';

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

export function createLocalExecutor(): CommandExecutor {
  return {
    kind: 'local',
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
        default:
          return assertUnreachable(command);
      }
    }
  } satisfies CommandExecutor;
}
