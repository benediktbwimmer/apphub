import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import { FilestoreError, assertUnreachable } from '../errors';
import type { BackendMountRecord } from '../db/backendMounts';
import type { FilestoreCommand } from '../commands/types';
import type { CommandExecutor, ExecutorContext, ExecutorResult } from './types';

const defaultS3Clients = new Map<number, S3Client>();

interface S3BackendConfig {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

function ensureS3Backend(backend: BackendMountRecord): asserts backend is BackendMountRecord & {
  backendKind: 's3';
  bucket: string;
} {
  if (backend.backendKind !== 's3') {
    throw new FilestoreError('S3 executor received non-s3 backend', 'EXECUTOR_NOT_FOUND', {
      backendKind: backend.backendKind
    });
  }
  if (!backend.bucket) {
    throw new FilestoreError('S3 backend missing bucket', 'BACKEND_NOT_FOUND', {
      backendId: backend.id
    });
  }
}

type CreateS3ExecutorOptions = {
  clientFactory?: (backend: BackendMountRecord & { backendKind: 's3'; bucket: string }) => S3Client;
};

function normalizePrefix(prefix: string | null): string {
  if (!prefix) {
    return '';
  }
  return prefix.replace(/^\/+/, '').replace(/\/+$/, '');
}

function buildKey(backend: BackendMountRecord & { backendKind: 's3'; bucket: string }, relativePath: string): string {
  const prefix = normalizePrefix(backend.prefix ?? null);
  const cleaned = relativePath.replace(/^\/+/, '').replace(/\/+$/, '');
  let effective = cleaned;

  if (prefix) {
    if (cleaned === prefix) {
      effective = '';
    } else if (cleaned.startsWith(`${prefix}/`)) {
      effective = cleaned.slice(prefix.length + 1);
    }
  }

  if (!prefix) {
    return effective;
  }
  return effective ? `${prefix}/${effective}` : prefix;
}

async function deleteObjectIfExists(client: S3Client, bucket: string, key: string | null): Promise<void> {
  if (!key) {
    return;
  }
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key
      })
    );
  } catch (err) {
    const code = (err as { name?: string; $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (code === 404) {
      return;
    }
    throw err;
  }
}

async function deletePrefixRecursive(client: S3Client, bucket: string, prefix: string): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken
      })
    );

    const keys = (response.Contents ?? [])
      .map((object) => object.Key)
      .filter((key): key is string => typeof key === 'string');

    if (keys.length > 0) {
      for (let index = 0; index < keys.length; index += 1000) {
        const chunk = keys.slice(index, index + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: chunk.map((Key) => ({ Key }))
            }
          })
        );
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
}

export function createS3Executor(options: CreateS3ExecutorOptions = {}): CommandExecutor {
  const clients = options.clientFactory ? new Map<number, S3Client>() : defaultS3Clients;

  function resolveClient(backend: BackendMountRecord & { backendKind: 's3'; bucket: string }): S3Client {
    const existing = clients.get(backend.id);
    if (existing) {
      return existing;
    }

    if (options.clientFactory) {
      const client = options.clientFactory(backend);
      clients.set(backend.id, client);
      return client;
    }

    const config = (backend.config ?? {}) as S3BackendConfig;
    const region = config.region ?? process.env.FILESTORE_S3_REGION ?? 'us-east-1';
    const endpoint = config.endpoint;
    const forcePathStyle = config.forcePathStyle ?? true;
    const accessKeyId = config.accessKeyId ?? process.env.FILESTORE_S3_ACCESS_KEY_ID;
    const secretAccessKey = config.secretAccessKey ?? process.env.FILESTORE_S3_SECRET_ACCESS_KEY;
    const sessionToken = config.sessionToken ?? process.env.FILESTORE_S3_SESSION_TOKEN;

    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials:
        accessKeyId && secretAccessKey
          ? {
              accessKeyId,
              secretAccessKey,
              sessionToken: sessionToken ?? undefined
            }
          : undefined
    });

    clients.set(backend.id, client);
    return client;
  }

  return {
    kind: 's3',
    async execute(command: FilestoreCommand, context: ExecutorContext): Promise<ExecutorResult> {
      ensureS3Backend(context.backend);
      const client = resolveClient(context.backend);
      const bucket = context.backend.bucket;
      const baseKey = buildKey(context.backend, 'path' in command ? command.path : '');

      switch (command.type) {
        case 'createDirectory': {
          const directoryKey = baseKey ? `${baseKey}/` : '';
          if (!directoryKey) {
            throw new FilestoreError('Root path is not allowed for S3 directory creation', 'INVALID_PATH');
          }

          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: directoryKey,
              Body: '',
              ContentType: 'application/x-directory'
            })
          );

          return {
            sizeBytes: 0,
            lastModifiedAt: new Date(),
            metadata: command.metadata ?? null
          } satisfies ExecutorResult;
        }
        case 'deleteNode': {
          const directoryKey = baseKey ? `${baseKey}/` : '';
          if (!directoryKey) {
            throw new FilestoreError('Root deletion is not permitted for S3 backends', 'INVALID_PATH');
          }

          if (command.recursive) {
            await deletePrefixRecursive(client, bucket, directoryKey);
            await deleteObjectIfExists(client, bucket, baseKey);
            await deleteObjectIfExists(client, bucket, directoryKey);
            return {
              sizeBytes: 0,
              lastModifiedAt: new Date()
            } satisfies ExecutorResult;
          }

          const listing = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: directoryKey,
              MaxKeys: 2
            })
          );

          const hasChildren = (listing.Contents ?? []).some((object) => {
            const key = object.Key ?? '';
            return key !== directoryKey;
          });

          if (hasChildren) {
            throw new FilestoreError('Directory contains objects and cannot be deleted', 'CHILDREN_EXIST', {
              bucket,
              prefix: directoryKey
            });
          }

          await deleteObjectIfExists(client, bucket, directoryKey);
          await deleteObjectIfExists(client, bucket, baseKey);

          return {
            sizeBytes: 0,
            lastModifiedAt: new Date()
          } satisfies ExecutorResult;
        }
        default:
          return assertUnreachable(command);
      }
    }
  } satisfies CommandExecutor;
}
