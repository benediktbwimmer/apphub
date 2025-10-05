import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  CreateBucketCommand,
  type BucketLocationConstraint
} from '@aws-sdk/client-s3';
import type { ModuleDeploymentLogger } from './types';

export type ArtifactStorageBackend = 'inline' | 's3';

export type InlineArtifactDescriptor = {
  storage: 'inline';
  filename: string;
  contentType: string;
  data: string;
  size: number;
  checksum: string;
};

export type S3ArtifactDescriptor = {
  storage: 's3';
  bucket: string;
  key: string;
  contentType: string;
  size: number;
  checksum: string;
};

export type ModuleArtifactDescriptor = InlineArtifactDescriptor | S3ArtifactDescriptor;

export interface PrepareArtifactOptions {
  moduleId: string;
  moduleVersion: string;
  moduleEntryPath: string;
  env: NodeJS.ProcessEnv;
  logger: ModuleDeploymentLogger;
}

export async function prepareModuleArtifact(
  options: PrepareArtifactOptions
): Promise<ModuleArtifactDescriptor> {
  const backend = resolveStorageBackend(options.env);
  if (backend === 's3') {
    return uploadArtifactToS3(options);
  }

  options.logger.warn(
    'Module artifact S3 storage not configured; falling back to inline upload (may hit payload limits)'
  );
  return encodeInlineArtifact(options);
}

function resolveStorageBackend(env: NodeJS.ProcessEnv): ArtifactStorageBackend {
  const explicit = env.APPHUB_MODULE_ARTIFACT_STORAGE_BACKEND?.trim().toLowerCase();
  if (explicit === 's3') {
    return 's3';
  }
  if (explicit === 'inline' || explicit === 'filesystem') {
    return 'inline';
  }
  const bundleBackend = env.APPHUB_BUNDLE_STORAGE_BACKEND?.trim().toLowerCase();
  if (bundleBackend === 's3') {
    return 's3';
  }
  return 'inline';
}

async function encodeInlineArtifact(options: PrepareArtifactOptions): Promise<InlineArtifactDescriptor> {
  const data = await readFile(options.moduleEntryPath);
  const checksum = sha256(data);
  const contentType = 'application/javascript';
  const filename = path.basename(options.moduleEntryPath);
  return {
    storage: 'inline',
    filename,
    contentType,
    data: data.toString('base64'),
    size: data.byteLength,
    checksum
  } satisfies InlineArtifactDescriptor;
}

async function uploadArtifactToS3(options: PrepareArtifactOptions): Promise<S3ArtifactDescriptor> {
  const config = resolveS3Config(options.env);
  if (!config) {
    throw new Error(
      'Module artifact storage is set to s3, but APPHUB_MODULE_ARTIFACT_BUCKET or APPHUB_BUNDLE_STORAGE_BUCKET is not configured'
    );
  }

  const buffer = await readFile(options.moduleEntryPath);
  const checksum = sha256(buffer);

  const key = buildS3Key({
    moduleId: options.moduleId,
    moduleVersion: options.moduleVersion,
    filename: path.basename(options.moduleEntryPath),
    prefix: config.prefix
  });

  const client = createS3Client(config);
  await ensureBucketExists(client, config);
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'application/javascript',
      ContentLength: buffer.byteLength,
      ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64')
    })
  );

  options.logger.info('Uploaded module artifact to object storage', {
    bucket: config.bucket,
    key,
    size: buffer.byteLength
  });

  return {
    storage: 's3',
    bucket: config.bucket,
    key,
    contentType: 'application/javascript',
    size: buffer.byteLength,
    checksum
  } satisfies S3ArtifactDescriptor;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function buildS3Key(params: {
  moduleId: string;
  moduleVersion: string;
  filename: string;
  prefix?: string;
}): string {
  const safeModule = sanitizeSegment(params.moduleId);
  const safeVersion = sanitizeSegment(params.moduleVersion);
  const safeFilename = sanitizeFilename(params.filename);
  const segments = [params.prefix, safeModule, safeVersion, safeFilename].filter(
    (segment): segment is string => Boolean(segment && segment.length)
  );
  return segments.join('/');
}

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase();
}

function sanitizeFilename(value: string): string {
  const base = path.basename(value || 'module.js');
  if (!base) {
    return 'module.js';
  }
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

type S3Config = {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  prefix?: string;
};

function resolveS3Config(env: NodeJS.ProcessEnv): S3Config | null {
  const bucket =
    env.APPHUB_MODULE_ARTIFACT_BUCKET?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_BUCKET?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_BUCKET?.trim() ||
    env.APPHUB_JOB_BUNDLE_S3_BUCKET?.trim() ||
    '';

  if (!bucket) {
    return null;
  }

  const region =
    env.APPHUB_MODULE_ARTIFACT_REGION?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_REGION?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_REGION?.trim() ||
    env.AWS_REGION?.trim() ||
    'us-east-1';

  const endpoint =
    env.APPHUB_MODULE_ARTIFACT_ENDPOINT?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_ENDPOINT?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_ENDPOINT?.trim() ||
    env.APPHUB_JOB_BUNDLE_S3_ENDPOINT?.trim();

  const forcePathStyleRaw =
    env.APPHUB_MODULE_ARTIFACT_FORCE_PATH_STYLE ??
    env.APPHUB_MODULE_ARTIFACT_S3_FORCE_PATH_STYLE ??
    env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE ??
    env.APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE ??
    'false';

  const accessKeyId =
    env.APPHUB_MODULE_ARTIFACT_ACCESS_KEY_ID ??
    env.APPHUB_MODULE_ARTIFACT_S3_ACCESS_KEY_ID ??
    env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ??
    env.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ??
    env.AWS_ACCESS_KEY_ID ??
    undefined;

  const secretAccessKey =
    env.APPHUB_MODULE_ARTIFACT_SECRET_ACCESS_KEY ??
    env.APPHUB_MODULE_ARTIFACT_S3_SECRET_ACCESS_KEY ??
    env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ??
    env.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ??
    env.AWS_SECRET_ACCESS_KEY ??
    undefined;

  const sessionToken =
    env.APPHUB_MODULE_ARTIFACT_SESSION_TOKEN ??
    env.APPHUB_MODULE_ARTIFACT_S3_SESSION_TOKEN ??
    env.APPHUB_BUNDLE_STORAGE_SESSION_TOKEN ??
    env.APPHUB_JOB_BUNDLE_S3_SESSION_TOKEN ??
    env.AWS_SESSION_TOKEN ??
    undefined;

  const prefix =
    env.APPHUB_MODULE_ARTIFACT_PREFIX?.trim() ||
    env.APPHUB_MODULE_ARTIFACT_S3_PREFIX?.trim() ||
    env.APPHUB_BUNDLE_STORAGE_PREFIX?.trim() ||
    env.APPHUB_JOB_BUNDLE_S3_PREFIX?.trim() ||
    'modules';

  return {
    bucket,
    region,
    endpoint,
    forcePathStyle: String(forcePathStyleRaw).toLowerCase() === 'true',
    accessKeyId,
    secretAccessKey,
    sessionToken,
    prefix: prefix.replace(/^\/+/, '').replace(/\/+$/, '')
  } satisfies S3Config;
}

function createS3Client(config: S3Config): S3Client {
  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region: config.region,
    forcePathStyle: config.forcePathStyle
  };
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }
  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken
    };
  }
  return new S3Client(clientConfig);
}

async function ensureBucketExists(client: S3Client, config: S3Config): Promise<void> {
  try {
    const input: ConstructorParameters<typeof CreateBucketCommand>[0] = { Bucket: config.bucket };
    const normalizedRegion = config.region?.toLowerCase() ?? 'us-east-1';
    if (normalizedRegion && normalizedRegion !== 'us-east-1' && config.region) {
      input.CreateBucketConfiguration = {
        LocationConstraint: config.region as BucketLocationConstraint
      };
    }
    await client.send(new CreateBucketCommand(input));
  } catch (error) {
    const code = (error as { name?: string; Code?: string }).name ?? (error as { Code?: string }).Code;
    if (code === 'BucketAlreadyOwnedByYou' || code === 'BucketAlreadyExists') {
      return;
    }
    throw error;
  }
}
