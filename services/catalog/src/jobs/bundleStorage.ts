import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import type { ReadStream } from 'node:fs';
import path from 'node:path';
import type { JobBundleStorageKind, JobBundleVersionRecord } from '../db';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let configuredBackend: JobBundleStorageKind | null = null;
let localRootDir: string | null = null;
let signingSecret: Buffer | null = null;
let s3Client: S3Client | null = null;

const DEFAULT_DOWNLOAD_TTL_MS = Number(process.env.APPHUB_JOB_BUNDLE_DOWNLOAD_TTL_MS ?? 5 * 60_000);
const SIGNATURE_VERSION = 'v1';
const DOWNLOAD_ROUTE_BASE = '/job-bundles';

const s3Bucket = process.env.APPHUB_JOB_BUNDLE_S3_BUCKET;
const s3Region = process.env.APPHUB_JOB_BUNDLE_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const s3Endpoint = process.env.APPHUB_JOB_BUNDLE_S3_ENDPOINT;
const s3ForcePathStyle = (process.env.APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true';
const s3PrefixRaw = process.env.APPHUB_JOB_BUNDLE_S3_PREFIX ?? '';
const s3Prefix = s3PrefixRaw.replace(/^\/+/, '').replace(/\/+$/, '');

function getBackend(): JobBundleStorageKind {
  if (!configuredBackend) {
    const raw = (process.env.APPHUB_JOB_BUNDLE_STORAGE_BACKEND ?? 'local').trim().toLowerCase();
    configuredBackend = raw === 's3' ? 's3' : 'local';
  }
  return configuredBackend;
}

function getLocalRoot(): string {
  if (!localRootDir) {
    const defaultDir = path.resolve(__dirname, '..', '..', 'data', 'job-bundles');
    const configured = process.env.APPHUB_JOB_BUNDLE_STORAGE_DIR;
    localRootDir = configured ? path.resolve(configured) : defaultDir;
  }
  return localRootDir;
}

async function ensureLocalRootExists(): Promise<void> {
  const root = getLocalRoot();
  await fs.mkdir(root, { recursive: true });
}

function getSigningSecret(): Buffer {
  if (!signingSecret) {
    const raw = process.env.APPHUB_JOB_BUNDLE_SIGNING_SECRET;
    if (raw && raw.trim().length > 0) {
      signingSecret = Buffer.from(raw.trim(), 'utf8');
    } else {
      signingSecret = randomBytes(32);
    }
  }
  return signingSecret;
}

function sanitizeSegmentValue(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase();
}

function ensureSegment(value: string, fallback: string): string {
  const sanitized = sanitizeSegmentValue(value);
  if (sanitized.length > 0) {
    return sanitized;
  }
  const sanitizedFallback = sanitizeSegmentValue(fallback);
  return sanitizedFallback.length > 0 ? sanitizedFallback : 'bundle';
}

function sanitizeFilename(value: string | null | undefined, versionSegment: string): string {
  const fallbackStem = `bundle-${versionSegment}`;
  if (!value) {
    return `${fallbackStem}.tgz`;
  }
  const base = path.basename(value);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safeStem = ensureSegment(stem, fallbackStem);
  const extValid = /^\.[a-zA-Z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : '';
  if (!extValid) {
    return `${safeStem}.bin`;
  }
  return `${safeStem}${extValid}`;
}

function computeChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function ensurePositiveTtl(expiresInMs?: number): number {
  const candidate = typeof expiresInMs === 'number' && Number.isFinite(expiresInMs) ? expiresInMs : DEFAULT_DOWNLOAD_TTL_MS;
  return candidate > 1_000 ? candidate : DEFAULT_DOWNLOAD_TTL_MS;
}

function buildDownloadPath(slug: string, version: string): string {
  const encodedSlug = encodeURIComponent(slug);
  const encodedVersion = encodeURIComponent(version);
  return `${DOWNLOAD_ROUTE_BASE}/${encodedSlug}/versions/${encodedVersion}/download`;
}

function createSignaturePayload(slug: string, version: string, artifactPath: string, expires: number): Buffer {
  return Buffer.from(`${SIGNATURE_VERSION}\n${slug}\n${version}\n${artifactPath}\n${expires}`, 'utf8');
}

function signToken(slug: string, version: string, artifactPath: string, expires: number): string {
  const hmac = createHmac('sha256', getSigningSecret());
  hmac.update(createSignaturePayload(slug, version, artifactPath, expires));
  return hmac.digest('hex');
}

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return false;
  }
  const buffA = Buffer.from(a, 'hex');
  const buffB = Buffer.from(b, 'hex');
  if (buffA.length === 0 || buffB.length === 0 || buffA.length !== buffB.length) {
    return false;
  }
  return timingSafeEqual(buffA, buffB);
}

function getS3Client(): S3Client {
  if (!s3Client) {
    if (!s3Bucket) {
      throw new Error('APPHUB_JOB_BUNDLE_S3_BUCKET must be configured for s3 storage backend');
    }
    s3Client = new S3Client({
      region: s3Region,
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle
    });
  }
  return s3Client;
}

function buildS3Key(slugSegment: string, versionSegment: string, filename: string): string {
  const prefix = s3Prefix.length > 0 ? `${s3Prefix}/` : '';
  return `${prefix}${slugSegment}/${versionSegment}/${filename}`;
}

export type BundleArtifactUpload = {
  slug: string;
  version: string;
  data: Buffer;
  contentType?: string | null;
  filename?: string | null;
};

export type BundleArtifactSaveResult = {
  storage: JobBundleStorageKind;
  artifactPath: string;
  checksum: string;
  size: number;
  contentType: string | null;
};

export async function saveJobBundleArtifact(input: BundleArtifactUpload): Promise<BundleArtifactSaveResult> {
  const backend = getBackend();
  const slugSegment = ensureSegment(input.slug, 'bundle');
  const versionSegment = ensureSegment(input.version, 'v');
  const filename = sanitizeFilename(input.filename, versionSegment);
  const checksum = computeChecksum(input.data);
  const size = input.data.byteLength;
  const contentType = input.contentType?.trim() && input.contentType.trim().length > 0
    ? input.contentType.trim()
    : null;

  if (backend === 's3') {
    const key = buildS3Key(slugSegment, versionSegment, filename);
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: input.data,
        ContentType: contentType ?? 'application/octet-stream',
        ContentLength: size,
        ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64')
      })
    );
    return {
      storage: 's3',
      artifactPath: key,
      checksum,
      size,
      contentType
    } satisfies BundleArtifactSaveResult;
  }

  await ensureLocalRootExists();
  const root = getLocalRoot();
  const relativeDir = path.posix.join(slugSegment, versionSegment);
  const relativePath = path.posix.join(relativeDir, filename);
  const absoluteDir = path.resolve(root, relativeDir.split('/').join(path.sep));
  const absolutePath = path.resolve(root, relativePath.split('/').join(path.sep));

  const relativeValidation = path.relative(root, absolutePath);
  if (relativeValidation.startsWith('..')) {
    throw new Error('Resolved artifact path escapes storage root');
  }

  await fs.mkdir(absoluteDir, { recursive: true });

  try {
    await fs.stat(absolutePath);
    throw new Error('Artifact already exists for bundle version');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  await fs.writeFile(absolutePath, input.data);

  return {
    storage: 'local',
    artifactPath: relativePath,
    checksum,
    size,
    contentType
  } satisfies BundleArtifactSaveResult;
}

export type BundleDownloadInfo = {
  storage: JobBundleStorageKind;
  url: string;
  expiresAt: number;
  kind: 'local' | 'external';
};

export async function createBundleDownloadUrl(
  record: JobBundleVersionRecord,
  options?: { expiresInMs?: number; filename?: string | null }
): Promise<BundleDownloadInfo> {
  const expiresIn = ensurePositiveTtl(options?.expiresInMs);
  const expiresAt = Date.now() + expiresIn;

  if (record.artifactStorage === 's3') {
    const client = getS3Client();
    if (!s3Bucket) {
      throw new Error('S3 bucket is not configured');
    }
    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: record.artifactPath,
      ResponseContentDisposition: options?.filename
        ? `attachment; filename="${sanitizeFilename(options.filename, ensureSegment(record.version, 'v'))}"`
        : undefined,
      ResponseContentType: record.artifactContentType ?? undefined
    });
    const expiresSeconds = Math.max(1, Math.floor(expiresIn / 1000));
    const signedUrl = await getSignedUrl(client, command, { expiresIn: expiresSeconds });
    return {
      storage: 's3',
      url: signedUrl,
      expiresAt,
      kind: 'external'
    } satisfies BundleDownloadInfo;
  }

  const downloadPath = buildDownloadPath(record.slug, record.version);
  const token = signToken(record.slug, record.version, record.artifactPath, expiresAt);
  const params = new URLSearchParams();
  params.set('expires', String(expiresAt));
  params.set('token', token);
  if (options?.filename) {
    params.set('filename', sanitizeFilename(options.filename, ensureSegment(record.version, 'v')));
  }
  const url = `${downloadPath}?${params.toString()}`;
  return {
    storage: 'local',
    url,
    expiresAt,
    kind: 'local'
  } satisfies BundleDownloadInfo;
}

export function verifyLocalBundleDownload(
  record: JobBundleVersionRecord,
  token: string,
  expires: number
): boolean {
  if (record.artifactStorage !== 'local') {
    return false;
  }
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return false;
  }
  const expected = signToken(record.slug, record.version, record.artifactPath, expires);
  return timingSafeCompare(expected, token);
}

function resolveLocalArtifactAbsolutePath(record: JobBundleVersionRecord): string {
  if (record.artifactStorage !== 'local') {
    throw new Error('Bundle version is not stored locally');
  }
  const root = getLocalRoot();
  const normalized = path.normalize(record.artifactPath.split('/').join(path.sep));
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..')) {
    throw new Error('Artifact path escapes storage root');
  }
  return absolute;
}

export async function openLocalBundleArtifact(
  record: JobBundleVersionRecord
): Promise<ReadStream> {
  const absolute = resolveLocalArtifactAbsolutePath(record);
  return createReadStream(absolute);
}

export async function ensureLocalBundleExists(record: JobBundleVersionRecord): Promise<void> {
  const absolute = resolveLocalArtifactAbsolutePath(record);
  await fs.access(absolute);
}

export function getDownloadRoute(slug: string, version: string): string {
  return buildDownloadPath(slug, version);
}
