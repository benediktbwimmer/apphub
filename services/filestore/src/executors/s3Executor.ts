import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';
import type { GetObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { FilestoreError, assertUnreachable } from '../errors';
import type { BackendMountRecord } from '../db/backendMounts';
import type { FilestoreCommand } from '../commands/types';
import type {
  CommandExecutor,
  ExecutorContext,
  ExecutorFileMetadata,
  ExecutorPresignOptions,
  ExecutorPresignResult,
  ExecutorReadStreamOptions,
  ExecutorReadStreamResult,
  ExecutorResult
} from './types';

const defaultS3Clients = new Map<number, S3Client>();

interface S3BackendConfig {
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
}

function toNodeReadable(body: unknown, info: { bucket: string; key: string }): Readable {
  if (!body) {
    throw new FilestoreError('S3 object stream missing', 'NODE_NOT_FOUND', info);
  }
  if (body instanceof Readable) {
    return body;
  }
  if (typeof (body as { pipe?: unknown }).pipe === 'function') {
    return body as Readable;
  }
  const fromWeb = (Readable as unknown as { fromWeb?: (stream: unknown) => Readable }).fromWeb;
  if (typeof fromWeb === 'function' && typeof (body as { getReader?: () => unknown }).getReader === 'function') {
    return fromWeb(body);
  }
  throw new FilestoreError('S3 response body is not streamable', 'NOT_SUPPORTED', info);
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

async function copyS3Prefix(
  client: S3Client,
  bucket: string,
  sourcePrefix: string,
  targetPrefix: string
): Promise<void> {
  let continuationToken: string | undefined;
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: sourcePrefix,
        ContinuationToken: continuationToken
      })
    );

    const objects = (response.Contents ?? []).filter((item) => typeof item.Key === 'string');
    for (const object of objects) {
      const key = object.Key as string;
      const relative = key.slice(sourcePrefix.length);
      const destinationKey = `${targetPrefix}${relative}`;
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${key}`,
          Key: destinationKey
        })
      );
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);
}

async function pathRepresentsDirectory(
  client: S3Client,
  bucket: string,
  pathKey: string
): Promise<boolean> {
  const directoryKey = pathKey ? `${pathKey}/` : '';
  if (!directoryKey) {
    return false;
  }
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: directoryKey,
      MaxKeys: 1
    })
  );
  return (response.KeyCount ?? 0) > 0;
}

async function keyExists(
  client: S3Client,
  bucket: string,
  key: string
): Promise<boolean> {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: key,
      MaxKeys: 1
    })
  );
  return (response.KeyCount ?? 0) > 0;
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
    async head(targetPath, context) {
      ensureS3Backend(context.backend);
      const client = resolveClient(context.backend);
      const bucket = context.backend.bucket;
      const key = buildKey(context.backend, targetPath);
      if (!key) {
        throw new FilestoreError('Target path must not resolve to root', 'INVALID_PATH');
      }

      try {
        const response = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key
          })
        );
        const etag = response.ETag ? response.ETag.replace(/"/g, '') : null;
        return {
          sizeBytes: response.ContentLength ?? null,
          checksum: response.ChecksumSHA256 ?? null,
          contentHash: etag,
          contentType: response.ContentType ?? null,
          lastModifiedAt: response.LastModified ?? null,
          etag,
          metadata: response.Metadata ?? null
        } satisfies ExecutorFileMetadata;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) {
          return null;
        }
        throw err;
      }
    },
    async createReadStream(targetPath, context, options) {
      ensureS3Backend(context.backend);
      const client = resolveClient(context.backend);
      const bucket = context.backend.bucket;
      const key = buildKey(context.backend, targetPath);
      if (!key) {
        throw new FilestoreError('Target path must not resolve to root', 'INVALID_PATH');
      }

      const params: GetObjectCommandInput = {
        Bucket: bucket,
        Key: key
      };
      if (options?.range) {
        params.Range = `bytes=${options.range.start}-${options.range.end}`;
      }

      try {
        const response = await client.send(new GetObjectCommand(params));
        const stream = toNodeReadable(response.Body, { bucket, key });
        const etag = response.ETag ? response.ETag.replace(/"/g, '') : null;
        const contentRange = response.ContentRange ?? null;
        let totalSize: number | null = null;
        if (contentRange && contentRange.includes('/')) {
          const totalPart = contentRange.split('/')[1];
          if (totalPart) {
            const parsed = Number.parseInt(totalPart, 10);
            if (Number.isFinite(parsed)) {
              totalSize = parsed;
            }
          }
        }
        if (totalSize === null && typeof response.ContentLength === 'number') {
          totalSize = options?.range ? null : response.ContentLength;
        }

        const chunkLength =
          typeof response.ContentLength === 'number'
            ? response.ContentLength
            : options?.range
              ? options.range.end - options.range.start + 1
              : null;

        return {
          stream,
          contentLength: chunkLength,
          totalSize,
          contentRange,
          contentType: response.ContentType ?? null,
          etag,
          lastModifiedAt: response.LastModified ?? null
        } satisfies ExecutorReadStreamResult;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) {
          throw new FilestoreError('File not found for download', 'NODE_NOT_FOUND', {
            bucket,
            key
          });
        }
        throw err;
      }
    },
    async createPresignedDownload(targetPath, context, options) {
      ensureS3Backend(context.backend);
      const client = resolveClient(context.backend);
      const bucket = context.backend.bucket;
      const key = buildKey(context.backend, targetPath);
      if (!key) {
        throw new FilestoreError('Target path must not resolve to root', 'INVALID_PATH');
      }

      try {
        await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key
          })
        );
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) {
          throw new FilestoreError('File not found for presign', 'NODE_NOT_FOUND', {
            bucket,
            key
          });
        }
        throw err;
      }

      const expiresIn = Math.max(options?.expiresInSeconds ?? 300, 1);
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key
      });
      const url = await getSignedUrl(client, command, { expiresIn });
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      return {
        url,
        expiresAt,
        method: 'GET',
        headers: {}
      } satisfies ExecutorPresignResult;
    },
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
        case 'moveNode': {
          if (typeof command.targetPath !== 'string') {
            throw new FilestoreError('Target path is required for move', 'INVALID_PATH');
          }

          const targetKey = buildKey(context.backend, command.targetPath);
          if (!targetKey) {
            throw new FilestoreError('Target path must not resolve to root', 'INVALID_PATH');
          }

          const isDirectory =
            command.nodeKind === 'directory' ||
            (command.nodeKind === undefined && (await pathRepresentsDirectory(client, bucket, baseKey)));

          if (isDirectory) {
            const sourcePrefix = `${baseKey}/`;
            const targetPrefix = `${targetKey}/`;
            if (!sourcePrefix || !targetPrefix) {
              throw new FilestoreError('Directory move requires non-root paths', 'INVALID_PATH');
            }
            await copyS3Prefix(client, bucket, sourcePrefix, targetPrefix);
            await deletePrefixRecursive(client, bucket, sourcePrefix);
            await deleteObjectIfExists(client, bucket, baseKey);
            await client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: targetPrefix,
                Body: '',
                ContentType: 'application/x-directory'
              })
            );
            return {
              sizeBytes: 0,
              lastModifiedAt: new Date()
            } satisfies ExecutorResult;
          }

          await client.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `${bucket}/${baseKey}`,
              Key: targetKey
            })
          );
          await client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: baseKey
            })
          );

          const head = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: targetKey,
              MaxKeys: 1
            })
          );

          const sizeBytes = head.Contents && head.Contents[0] ? head.Contents[0].Size ?? null : null;
          return {
            sizeBytes,
            lastModifiedAt: new Date()
          } satisfies ExecutorResult;
        }
        case 'updateNodeMetadata': {
          return {};
        }
        case 'copyNode': {
          if (typeof command.targetPath !== 'string') {
            throw new FilestoreError('Target path is required for copy', 'INVALID_PATH');
          }

          const targetKey = buildKey(context.backend, command.targetPath);
          if (!targetKey) {
            throw new FilestoreError('Target path must not resolve to root', 'INVALID_PATH');
          }

          const isDirectory =
            command.nodeKind === 'directory' ||
            (command.nodeKind === undefined && (await pathRepresentsDirectory(client, bucket, baseKey)));
          const targetDirectoryKey = `${targetKey}/`;
          const targetFileExists = await keyExists(client, bucket, targetKey);
          const targetDirectoryExists = await keyExists(client, bucket, targetDirectoryKey);

          if (targetFileExists || targetDirectoryExists) {
            const targetIsDirectory = targetDirectoryExists;
            if (targetIsDirectory !== isDirectory) {
              throw new FilestoreError('Target path already exists', 'NODE_EXISTS', {
                targetPath: command.targetPath
              });
            }

            if (targetIsDirectory) {
              return {
                sizeBytes: 0,
                lastModifiedAt: new Date()
              } satisfies ExecutorResult;
            }

            const listing = await client.send(
              new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: targetKey,
                MaxKeys: 1
              })
            );
            const sizeBytes = listing.Contents && listing.Contents[0] ? listing.Contents[0].Size ?? null : null;
            const lastModified = listing.Contents && listing.Contents[0] && listing.Contents[0].LastModified
              ? listing.Contents[0].LastModified
              : new Date();
            return {
              sizeBytes,
              lastModifiedAt: lastModified
            } satisfies ExecutorResult;
          }

          if (isDirectory) {
            const sourcePrefix = `${baseKey}/`;
            const targetPrefix = `${targetKey}/`;
            if (!sourcePrefix || !targetPrefix) {
              throw new FilestoreError('Directory copy requires non-root paths', 'INVALID_PATH');
            }
            await copyS3Prefix(client, bucket, sourcePrefix, targetPrefix);

            await client.send(
              new PutObjectCommand({
                Bucket: bucket,
                Key: targetPrefix,
                Body: '',
                ContentType: 'application/x-directory'
              })
            );

            return {
              sizeBytes: 0,
              lastModifiedAt: new Date()
            } satisfies ExecutorResult;
          }

          await client.send(
            new CopyObjectCommand({
              Bucket: bucket,
              CopySource: `${bucket}/${baseKey}`,
              Key: targetKey
            })
          );

          const listing = await client.send(
            new ListObjectsV2Command({
              Bucket: bucket,
              Prefix: targetKey,
              MaxKeys: 1
            })
          );
          const sizeBytes = listing.Contents && listing.Contents[0] ? listing.Contents[0].Size ?? null : null;

          return {
            sizeBytes,
            lastModifiedAt: new Date()
          } satisfies ExecutorResult;
        }
        case 'uploadFile':
        case 'writeFile': {
          if (!command.stagingPath || command.stagingPath.trim().length === 0) {
            throw new FilestoreError('Staging path missing for upload', 'INVALID_REQUEST');
          }

          const stagingStats = await fs.stat(command.stagingPath).catch((err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') {
              return null;
            }
            throw err;
          });

          if (!stagingStats) {
            throw new FilestoreError('Staging file missing for upload', 'NODE_NOT_FOUND', {
              stagingPath: command.stagingPath
            });
          }

          const targetKey = buildKey(context.backend, command.path);
          if (!targetKey) {
            throw new FilestoreError('Target path must not resolve to root', 'INVALID_PATH');
          }

          if (command.type === 'uploadFile') {
            const objectExists = await keyExists(client, bucket, targetKey);
            const directoryExists = await pathRepresentsDirectory(client, bucket, targetKey);
            if (objectExists || directoryExists) {
              throw new FilestoreError('Target path already exists', 'NODE_EXISTS', {
                targetPath: command.path
              });
            }
          } else {
            const directoryExists = await pathRepresentsDirectory(client, bucket, targetKey);
            if (directoryExists) {
              throw new FilestoreError('Cannot overwrite directory placeholder with file', 'NOT_A_DIRECTORY', {
                path: command.path
              });
            }
          }

          const fileBuffer = await fs.readFile(command.stagingPath);

          const response = await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: targetKey,
              Body: fileBuffer,
              ContentLength: command.sizeBytes ?? fileBuffer.length,
              ContentType: command.mimeType ?? undefined
            })
          );

          const etag = response.ETag ? response.ETag.replace(/"/g, '') : null;

          return {
            sizeBytes: command.sizeBytes ?? fileBuffer.length,
            checksum: command.checksum ?? null,
            contentHash: command.contentHash ?? etag,
            lastModifiedAt: new Date()
          } satisfies ExecutorResult;
        }
        default:
          return assertUnreachable(command);
      }
    }
  } satisfies CommandExecutor;
}
