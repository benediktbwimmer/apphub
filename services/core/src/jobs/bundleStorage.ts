import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import type { JobBundleStorageKind, JobBundleVersionRecord } from '../db';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useConnection } from '../db/utils';

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
const s3AccessKeyId = process.env.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ?? process.env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID;
const s3SecretAccessKey = process.env.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ?? process.env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY;
const s3SessionToken = process.env.APPHUB_JOB_BUNDLE_S3_SESSION_TOKEN ?? process.env.APPHUB_BUNDLE_STORAGE_SESSION_TOKEN;

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

async function computeFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => {
      const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      hash.update(bufferChunk);
    });
    stream.on('error', (err) => reject(err));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export async function saveJobBundleArtifact(
  input: BundleArtifactUpload,
  options?: { force?: boolean }
): Promise<BundleArtifactSaveResult> {
  const backend = getBackend();
  const slugSegment = ensureSegment(input.slug, 'bundle');
  const versionSegment = ensureSegment(input.version, 'v');
  const filename = sanitizeFilename(input.filename, versionSegment);
  const checksum = computeChecksum(input.data);
  const size = input.data.byteLength;
  const contentType = input.contentType?.trim() && input.contentType.trim().length > 0
    ? input.contentType.trim()
    : null;
  const force = Boolean(options?.force);

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
    const existing = await fs.stat(absolutePath);
    const existingChecksum = await computeFileChecksum(absolutePath);
    if (existingChecksum === checksum) {
      return {
        storage: 'local',
        artifactPath: relativePath,
        checksum,
        size: existing.size,
        contentType
      } satisfies BundleArtifactSaveResult;
    }
    if (!force) {
      throw new Error('Artifact already exists for bundle version');
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

type ArtifactDataRow = {
  artifact_data: Buffer | null;
};

async function fetchBundleArtifactData(record: JobBundleVersionRecord): Promise<Buffer | null> {
  return useConnection(async (client) => {
    const { rows } = await client.query<ArtifactDataRow>(
      'SELECT artifact_data FROM job_bundle_versions WHERE id = $1',
      [record.id]
    );
    return rows[0]?.artifact_data ?? null;
  });
}

async function updateStoredBundleArtifact(record: JobBundleVersionRecord, data: Buffer): Promise<void> {
  await useConnection((client) =>
    client.query(
      `UPDATE job_bundle_versions
          SET artifact_data = $1,
              artifact_size = $2,
              updated_at = NOW()
        WHERE id = $3`,
      [data, data.byteLength, record.id]
    )
  );
}

async function writeLocalBundleArtifactFile(record: JobBundleVersionRecord, data: Buffer): Promise<string> {
  const absolute = resolveLocalArtifactAbsolutePath(record);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, data);
  return absolute;
}

async function hydrateLocalBundleArtifact(record: JobBundleVersionRecord): Promise<boolean> {
  if (record.artifactStorage !== 'local') {
    return false;
  }
  const data = await fetchBundleArtifactData(record);
  if (!data) {
    return false;
  }
  await writeLocalBundleArtifactFile(record, data);
  return true;
}

export async function writeLocalBundleArtifact(
  record: JobBundleVersionRecord,
  data: Buffer,
  options?: { persistToDatabase?: boolean }
): Promise<void> {
  if (record.artifactStorage !== 'local') {
    throw new Error('Cannot write local artifact for non-local storage');
  }
  await writeLocalBundleArtifactFile(record, data);
  if (options?.persistToDatabase === false) {
    return;
  }
  await updateStoredBundleArtifact(record, data);
  record.artifactSize = data.byteLength;
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
): Promise<NodeJS.ReadableStream> {
  if (record.artifactStorage !== 'local') {
    throw new Error('Bundle version is not stored locally');
  }
  const absolute = resolveLocalArtifactAbsolutePath(record);
  await ensureLocalBundleExists(record);
  try {
    return createReadStream(absolute);
  } catch (err) {
    const data = await fetchBundleArtifactData(record);
    if (!data) {
      throw err;
    }
    return Readable.from(data);
  }
}

export async function ensureLocalBundleExists(record: JobBundleVersionRecord): Promise<void> {
  if (record.artifactStorage !== 'local') {
    return;
  }
  const absolute = resolveLocalArtifactAbsolutePath(record);
  try {
    await fs.access(absolute);
    return;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw err;
    }
  }
  const hydrated = await hydrateLocalBundleArtifact(record);
  if (!hydrated) {
    throw new Error('Local bundle artifact is missing and no database copy is available');
  }
}

export function getDownloadRoute(slug: string, version: string): string {
  return buildDownloadPath(slug, version);
}
export function getLocalBundleArtifactPath(record: JobBundleVersionRecord): string {
  return resolveLocalArtifactAbsolutePath(record);
}

export async function readBundleArtifactBuffer(record: JobBundleVersionRecord): Promise<Buffer> {
  const inlineData = await fetchBundleArtifactData(record);
  if (inlineData) {
    return inlineData;
  }

  if (record.artifactStorage === 'local') {
    await ensureLocalBundleExists(record);
    const absolute = resolveLocalArtifactAbsolutePath(record);
    return fs.readFile(absolute);
  }

  if (record.artifactStorage === 's3') {
    const downloaded = await downloadS3ArtifactToBuffer(record);
    if (downloaded) {
      return downloaded;
    }
  }

  throw new Error(`Bundle artifact data not available for ${record.slug}@${record.version}`);
}

async function downloadS3ArtifactToBuffer(record: JobBundleVersionRecord): Promise<Buffer | null> {
  if (!s3Bucket) {
    return null;
  }
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: s3Bucket, Key: record.artifactPath });
  const response = await client.send(command);
  const body = response.Body;
  if (!body || typeof (body as any).pipe !== 'function') {
    return null;
  }
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (body as NodeJS.ReadableStream)
      .on('data', (chunk: Buffer | string | Uint8Array) => {
        if (typeof chunk === 'string') {
          chunks.push(Buffer.from(chunk));
        } else if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        } else {
          chunks.push(Buffer.from(chunk));
        }
      })
      .on('error', reject)
      .on('end', () => resolve());
  });
  return Buffer.concat(chunks);
}
