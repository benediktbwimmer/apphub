import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ExampleBundleArtifactRecord, ExampleBundleStorageKind } from '../db';

const DEFAULT_DOWNLOAD_TTL_MS = Number(process.env.APPHUB_BUNDLE_STORAGE_DOWNLOAD_TTL_MS ?? 5 * 60_000);
const DEFAULT_CONTENT_TYPE = 'application/gzip';
const SIGNATURE_VERSION = 'v1';
const DOWNLOAD_ROUTE_BASE = '/examples/bundles';

let configuredBackend: ExampleBundleStorageKind | null = null;
let localRootDir: string | null = null;
let signingSecret: Buffer | null = null;
let s3Client: S3Client | null = null;

const s3Bucket = process.env.APPHUB_BUNDLE_STORAGE_BUCKET;
const s3Region = process.env.APPHUB_BUNDLE_STORAGE_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const s3Endpoint = process.env.APPHUB_BUNDLE_STORAGE_ENDPOINT;
const s3ForcePathStyle = (process.env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE ?? '').toLowerCase() === 'true';
const s3PrefixRaw = process.env.APPHUB_BUNDLE_STORAGE_PREFIX ?? '';
const s3Prefix = s3PrefixRaw.replace(/^\/+/, '').replace(/\/+$/, '');
const s3AccessKeyId = process.env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY;
const s3SessionToken = process.env.APPHUB_BUNDLE_STORAGE_SESSION_TOKEN;

export type ExampleBundleArtifactUpload = {
  slug: string;
  fingerprint: string;
  version?: string | null;
  data: Buffer;
  checksum?: string | null;
  filename?: string | null;
  contentType?: string | null;
};

export type ExampleBundleArtifactSaveResult = {
  storageKind: ExampleBundleStorageKind;
  storageKey: string;
  storageUrl: string | null;
  checksum: string;
  size: number;
  contentType: string | null;
};

export type ExampleBundleDownloadInfo = {
  storage: ExampleBundleStorageKind;
  url: string;
  expiresAt: number;
  kind: 'local' | 'external';
};

export async function saveExampleBundleArtifact(
  input: ExampleBundleArtifactUpload,
  options?: { force?: boolean }
): Promise<ExampleBundleArtifactSaveResult> {
  const slugSegment = ensureSegment(input.slug, 'bundle');
  const fingerprintSegment = ensureSegment(input.fingerprint, 'fingerprint');
  const filename = sanitizeFilename(input.filename, slugSegment, fingerprintSegment);
  const checksum = computeChecksum(input.data);
  const size = input.data.byteLength;
  const contentType = normalizeContentType(input.contentType);
  const backend = getBackend();
  const expectedChecksum = input.checksum?.trim().toLowerCase();
  if (expectedChecksum && expectedChecksum !== checksum) {
    throw new Error('Example bundle artifact checksum mismatch');
  }

  if (backend === 's3') {
    const key = buildS3Key(slugSegment, fingerprintSegment, filename);
    const client = getS3Client();
    if (!s3Bucket) {
      throw new Error('APPHUB_BUNDLE_STORAGE_BUCKET must be configured for s3 backend');
    }
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: input.data,
        ContentType: contentType ?? DEFAULT_CONTENT_TYPE,
        ContentLength: size,
        ChecksumSHA256: Buffer.from(checksum, 'hex').toString('base64')
      })
    );
    return {
      storageKind: 's3',
      storageKey: key,
      storageUrl: buildS3Url(key),
      checksum,
      size,
      contentType
    } satisfies ExampleBundleArtifactSaveResult;
  }

  await ensureLocalRootExists();
  const { relativePath, absolutePath, absoluteDir } = buildLocalPaths(slugSegment, fingerprintSegment, filename);
  await fs.mkdir(absoluteDir, { recursive: true });
  const force = Boolean(options?.force);

  try {
    const stats = await fs.stat(absolutePath);
    const existingChecksum = await computeFileChecksum(absolutePath);
    if (existingChecksum === checksum) {
      return {
        storageKind: 'local',
        storageKey: relativePath,
        storageUrl: buildLocalUrl(relativePath),
        checksum,
        size: stats.size,
        contentType
      } satisfies ExampleBundleArtifactSaveResult;
    }
    if (!force) {
      throw new Error('Example bundle artifact already exists with different checksum');
    }
    await fs.rm(absolutePath, { force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw err;
    }
  }

  await fs.writeFile(absolutePath, input.data);

  return {
    storageKind: 'local',
    storageKey: relativePath,
    storageUrl: buildLocalUrl(relativePath),
    checksum,
    size,
    contentType
  } satisfies ExampleBundleArtifactSaveResult;
}

export async function createExampleBundleDownloadUrl(
  artifact: ExampleBundleArtifactRecord,
  options?: { expiresInMs?: number; filename?: string | null }
): Promise<ExampleBundleDownloadInfo> {
  const expiresIn = ensurePositiveTtl(options?.expiresInMs);
  const expiresAt = Date.now() + expiresIn;
  if (artifact.storageKind === 's3') {
    const client = getS3Client();
    if (!s3Bucket) {
      throw new Error('S3 bucket is not configured');
    }
    const command = new GetObjectCommand({
      Bucket: s3Bucket,
      Key: artifact.storageKey,
      ResponseContentDisposition: options?.filename
        ? `attachment; filename="${sanitizeDownloadFilename(options.filename, artifact)}"`
        : undefined,
      ResponseContentType: artifact.contentType ?? undefined
    });
    const expiresSeconds = Math.max(1, Math.floor(expiresIn / 1000));
    const signedUrl = await getSignedUrl(client, command, { expiresIn: expiresSeconds });
    return {
      storage: 's3',
      url: signedUrl,
      expiresAt,
      kind: 'external'
    } satisfies ExampleBundleDownloadInfo;
  }

  if (artifact.storageKind !== 'local') {
    throw new Error(`Unsupported storage kind: ${artifact.storageKind}`);
  }
  const downloadPath = buildDownloadPath(artifact.slug, artifact.fingerprint);
  const token = signToken(artifact.slug, artifact.fingerprint, artifact.storageKey, expiresAt);
  const params = new URLSearchParams();
  params.set('expires', String(expiresAt));
  params.set('token', token);
  if (options?.filename) {
    params.set('filename', sanitizeDownloadFilename(options.filename, artifact));
  }
  const url = `${downloadPath}?${params.toString()}`;
  return {
    storage: 'local',
    url,
    expiresAt,
    kind: 'local'
  } satisfies ExampleBundleDownloadInfo;
}

export function verifyLocalExampleBundleDownload(
  artifact: ExampleBundleArtifactRecord,
  token: string,
  expires: number
): boolean {
  if (artifact.storageKind !== 'local') {
    return false;
  }
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    return false;
  }
  const expected = signToken(artifact.slug, artifact.fingerprint, artifact.storageKey, expires);
  return timingSafeCompare(expected, token);
}

export async function openLocalExampleBundleArtifact(
  artifact: ExampleBundleArtifactRecord
): Promise<Readable> {
  if (artifact.storageKind !== 'local') {
    throw new Error('Artifact is not stored locally');
  }
  const absolutePath = resolveLocalAbsolutePath(artifact.storageKey);
  return createReadStream(absolutePath);
}

export async function ensureLocalExampleBundleArtifactExists(
  artifact: ExampleBundleArtifactRecord
): Promise<void> {
  if (artifact.storageKind !== 'local') {
    throw new Error('Artifact is not stored locally');
  }
  const absolutePath = resolveLocalAbsolutePath(artifact.storageKey);
  await fs.access(absolutePath);
}

function getBackend(): ExampleBundleStorageKind {
  if (!configuredBackend) {
    const raw = (process.env.APPHUB_BUNDLE_STORAGE_BACKEND ?? 'local').trim().toLowerCase();
    configuredBackend = raw === 's3' ? 's3' : 'local';
  }
  return configuredBackend;
}

function getLocalRoot(): string {
  if (!localRootDir) {
    const configured = process.env.APPHUB_BUNDLE_STORAGE_ROOT;
    const defaultDir = path.resolve(__dirname, '..', '..', 'data', 'example-bundles', 'artifacts');
    localRootDir = configured ? path.resolve(configured) : defaultDir;
  }
  return localRootDir;
}

async function ensureLocalRootExists(): Promise<void> {
  await fs.mkdir(getLocalRoot(), { recursive: true });
}

function getSigningSecret(): Buffer {
  if (!signingSecret) {
    const raw = process.env.APPHUB_BUNDLE_STORAGE_SIGNING_SECRET;
    signingSecret = raw && raw.trim().length > 0 ? Buffer.from(raw.trim(), 'utf8') : randomBytes(32);
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
  const fallbackSanitized = sanitizeSegmentValue(fallback);
  if (fallbackSanitized.length > 0) {
    return fallbackSanitized;
  }
  throw new Error('Example bundle segment could not be sanitized');
}

function sanitizeFilename(
  input: string | null | undefined,
  slugSegment: string,
  fingerprintSegment: string
): string {
  if (!input) {
    return `${slugSegment}-${fingerprintSegment}.tgz`;
  }
  const base = path.basename(input);
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  const safeStem = sanitizeSegmentValue(stem) || `${slugSegment}-${fingerprintSegment}`;
  const extValid = /^\.[a-zA-Z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : '.tgz';
  return `${safeStem}${extValid}`;
}

function sanitizeDownloadFilename(
  input: string,
  artifact: ExampleBundleArtifactRecord
): string {
  const base = sanitizeSegmentValue(path.basename(input)) || artifact.filename || 'bundle';
  const ext = artifact.filename ? path.extname(artifact.filename) : '.tgz';
  const extValid = /^\.[a-zA-Z0-9]{1,10}$/.test(ext) ? ext.toLowerCase() : '.tgz';
  return `${base}${extValid}`;
}

function computeChecksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return computeChecksum(data);
}

function normalizeContentType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildS3Key(slugSegment: string, fingerprintSegment: string, filename: string): string {
  const prefix = s3Prefix.length > 0 ? `${s3Prefix}/` : '';
  return `${prefix}${slugSegment}/${fingerprintSegment}/${filename}`;
}

function buildS3Url(key: string): string {
  if (!s3Bucket) {
    return `s3://${key}`;
  }
  return `s3://${s3Bucket}/${key}`;
}

function buildLocalUrl(relativePath: string): string {
  return `local://${relativePath}`;
}

function ensurePositiveTtl(expiresInMs?: number): number {
  const candidate = typeof expiresInMs === 'number' && Number.isFinite(expiresInMs)
    ? expiresInMs
    : DEFAULT_DOWNLOAD_TTL_MS;
  return candidate > 1_000 ? candidate : DEFAULT_DOWNLOAD_TTL_MS;
}

function buildDownloadPath(slug: string, fingerprint: string): string {
  const encodedSlug = encodeURIComponent(slug);
  const encodedFingerprint = encodeURIComponent(fingerprint);
  return `${DOWNLOAD_ROUTE_BASE}/${encodedSlug}/fingerprints/${encodedFingerprint}/download`;
}

function createSignaturePayload(
  slug: string,
  fingerprint: string,
  storageKey: string,
  expires: number
): Buffer {
  return Buffer.from(`${SIGNATURE_VERSION}\n${slug}\n${fingerprint}\n${storageKey}\n${expires}`, 'utf8');
}

function signToken(slug: string, fingerprint: string, storageKey: string, expires: number): string {
  const hmac = createHmac('sha256', getSigningSecret());
  hmac.update(createSignaturePayload(slug, fingerprint, storageKey, expires));
  return hmac.digest('hex');
}

function buildLocalPaths(
  slugSegment: string,
  fingerprintSegment: string,
  filename: string
): { relativePath: string; absolutePath: string; absoluteDir: string } {
  const relativeDir = path.posix.join(slugSegment, fingerprintSegment);
  const relativePath = path.posix.join(relativeDir, filename);
  const root = getLocalRoot();
  const absoluteDir = path.resolve(root, relativeDir.split('/').join(path.sep));
  const absolutePath = path.resolve(root, relativePath.split('/').join(path.sep));
  const validation = path.relative(root, absolutePath);
  if (validation.startsWith('..')) {
    throw new Error('Resolved artifact path escapes storage root');
  }
  return { relativePath, absolutePath, absoluteDir };
}

function resolveLocalAbsolutePath(storageKey: string): string {
  const root = getLocalRoot();
  const absolutePath = path.resolve(root, storageKey.split('/').join(path.sep));
  const validation = path.relative(root, absolutePath);
  if (validation.startsWith('..')) {
    throw new Error('Resolved artifact path escapes storage root');
  }
  return absolutePath;
}

function timingSafeCompare(expectedHex: string, providedHex: string): boolean {
  if (!expectedHex || !providedHex || expectedHex.length !== providedHex.length) {
    return false;
  }
  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const provided = Buffer.from(providedHex, 'hex');
    if (expected.length === 0 || expected.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

function getS3Client(): S3Client {
  if (!s3Client) {
    const config: ConstructorParameters<typeof S3Client>[0] = {
      region: s3Region,
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle || Boolean(s3Endpoint)
    };
    if (s3AccessKeyId && s3SecretAccessKey) {
      config.credentials = {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        sessionToken: s3SessionToken
      };
    }
    s3Client = new S3Client(config);
  }
  return s3Client;
}
