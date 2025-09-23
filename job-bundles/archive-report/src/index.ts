import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync, constants as zlibConstants } from 'node:zlib';

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

type ArtifactDescriptor = {
  relativePath: string;
  path?: string;
  mediaType?: string;
  description?: string;
  sizeBytes?: number;
};

type ReportAssetPayload = {
  assetId?: string;
  outputDir?: string;
  reportTitle?: string;
  generatedAt?: string;
  artifacts?: ArtifactDescriptor[];
};

type ArchiveParameters = {
  reportDir?: unknown;
  archiveDir?: unknown;
  archiveName?: unknown;
  asset?: unknown;
};

function ensureString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function sanitizeArchiveName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return `report-${Date.now()}.tar.gz`;
  }
  const normalized = trimmed.replace(/[^a-zA-Z0-9_.-]+/g, '-');
  if (normalized.toLowerCase().endsWith('.tar.gz')) {
    return normalized;
  }
  return `${normalized}.tar.gz`;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

function writeString(target: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  const max = Math.min(bytes.length, length);
  bytes.copy(target, offset, 0, max);
}

function writeOctal(target: Buffer, offset: number, length: number, value: number): void {
  const octal = value.toString(8);
  const padded = octal.padStart(length - 1, '0');
  writeString(target, offset, length - 1, padded);
  target[offset + length - 1] = 0;
}

async function buildTarBuffer(baseDir: string, files: Array<{ relativePath: string; absolutePath: string }>): Promise<Buffer> {
  const blocks: Buffer[] = [];

  for (const file of files) {
    const content = await fs.readFile(file.absolutePath);
    const header = Buffer.alloc(512, 0);

    const name = file.relativePath.replace(/^\/+/, '');
    if (Buffer.byteLength(name, 'utf8') > 100) {
      throw new Error(`File name too long for tar header: ${name}`);
    }

    writeString(header, 0, 100, name);
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, content.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    writeString(header, 156, 1, '0');
    writeString(header, 257, 6, 'ustar');
    header[263] = 0;
    header[264] = 0;

    // Compute checksum (field initially filled with spaces)
    for (let i = 148; i < 156; i += 1) {
      header[i] = 0x20;
    }
    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    writeOctal(header, 148, 8, checksum);

    blocks.push(header);
    blocks.push(content);

    const remainder = content.length % 512;
    if (remainder !== 0) {
      blocks.push(Buffer.alloc(512 - remainder, 0));
    }
  }

  blocks.push(Buffer.alloc(512, 0));
  blocks.push(Buffer.alloc(512, 0));

  return Buffer.concat(blocks);
}

async function createTarGz(options: {
  baseDir: string;
  files: Array<{ relativePath: string; absolutePath: string }>;
  targetPath: string;
}): Promise<void> {
  const tarBuffer = await buildTarBuffer(options.baseDir, options.files);
  const gzBuffer = gzipSync(tarBuffer, { level: zlibConstants.Z_BEST_COMPRESSION });
  await fs.writeFile(options.targetPath, gzBuffer);
}

function parseAsset(value: unknown): ReportAssetPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('asset parameter must be an object');
  }
  const record = value as Record<string, unknown>;
  const outputDirRaw = record.outputDir;
  if (typeof outputDirRaw !== 'string' || outputDirRaw.trim().length === 0) {
    throw new Error('asset.outputDir is required');
  }
  const payload: ReportAssetPayload = {
    assetId: typeof record.assetId === 'string' ? record.assetId.trim() : undefined,
    outputDir: outputDirRaw.trim(),
    reportTitle: typeof record.reportTitle === 'string' ? record.reportTitle : undefined,
    generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : undefined,
    artifacts: []
  };

  const rawArtifacts = record.artifacts;
  if (Array.isArray(rawArtifacts)) {
    payload.artifacts = rawArtifacts
      .map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          return null;
        }
        const artifactRecord = entry as Record<string, unknown>;
        const relativePathRaw = artifactRecord.relativePath;
        if (typeof relativePathRaw !== 'string' || relativePathRaw.trim().length === 0) {
          return null;
        }
        const descriptor: ArtifactDescriptor = {
          relativePath: relativePathRaw.trim()
        };
        if (typeof artifactRecord.mediaType === 'string') {
          descriptor.mediaType = artifactRecord.mediaType;
        }
        if (typeof artifactRecord.description === 'string') {
          descriptor.description = artifactRecord.description;
        }
        if (typeof artifactRecord.sizeBytes === 'number') {
          descriptor.sizeBytes = artifactRecord.sizeBytes;
        }
        if (typeof artifactRecord.path === 'string' && artifactRecord.path.trim().length > 0) {
          descriptor.path = artifactRecord.path.trim();
        }
        return descriptor;
      })
      .filter((entry): entry is ArtifactDescriptor => Boolean(entry));
  }

  return payload;
}

function normalizeParameters(raw: unknown): {
  reportDir: string;
  archiveDir: string;
  archiveName: string;
  asset: ReportAssetPayload;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('job parameters must be an object');
  }
  const params = raw as ArchiveParameters;
  const asset = parseAsset(params.asset);

  const reportDir = params.reportDir
    ? ensureString(params.reportDir, 'reportDir')
    : asset.outputDir ?? '';
  if (!reportDir) {
    throw new Error('Either reportDir parameter or asset.outputDir must be provided');
  }

  const archiveDir = params.archiveDir
    ? ensureString(params.archiveDir, 'archiveDir')
    : path.join(reportDir, '..', 'archives');

  const archiveName = params.archiveName
    ? sanitizeArchiveName(ensureString(params.archiveName, 'archiveName'))
    : sanitizeArchiveName(`report-${Date.now()}`);

  return {
    reportDir: path.resolve(reportDir),
    archiveDir: path.resolve(archiveDir),
    archiveName,
    asset
  };
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  let parameters: ReturnType<typeof normalizeParameters>;
  try {
    parameters = normalizeParameters(context.parameters);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid parameters';
    return { status: 'failed', errorMessage: message } satisfies JobRunResult;
  }

  const { reportDir, archiveDir, archiveName, asset } = parameters;
  const artifacts = asset.artifacts ?? [];
  if (artifacts.length === 0) {
    return { status: 'failed', errorMessage: 'asset.artifacts must include at least one entry' };
  }

  const archivePath = path.resolve(archiveDir, archiveName);

  const resolvedArtifacts: Array<{ relativePath: string; absolutePath: string; mediaType?: string; description?: string }> = [];

  for (const artifact of artifacts) {
    const absolutePath = artifact.path
      ? path.resolve(artifact.path)
      : path.resolve(reportDir, artifact.relativePath);
    const exists = await pathExists(absolutePath);
    if (!exists) {
      return {
        status: 'failed',
        errorMessage: `Artifact not found: ${absolutePath}`
      } satisfies JobRunResult;
    }
    resolvedArtifacts.push({
      relativePath: artifact.relativePath,
      absolutePath,
      mediaType: artifact.mediaType,
      description: artifact.description
    });
  }

  await fs.mkdir(archiveDir, { recursive: true });

  const tarInputs = resolvedArtifacts.map((entry) => {
    const relative = path.relative(reportDir, entry.absolutePath);
    return {
      relativePath: relative || path.basename(entry.absolutePath),
      absolutePath: entry.absolutePath
    };
  });

  try {
    await createTarGz({
      baseDir: reportDir,
      files: tarInputs,
      targetPath: archivePath
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create archive';
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  }

  const stats = await fs.stat(archivePath);
  const producedAt = new Date().toISOString();

  const payload = {
    archivePath,
    archiveDir,
    archiveName,
    sourceAssetId: asset.assetId ?? 'directory.insights.report',
    sourceOutputDir: reportDir,
    reportTitle: asset.reportTitle ?? null,
    generatedAt: producedAt,
    artifactCount: resolvedArtifacts.length,
    artifacts: resolvedArtifacts.map((entry) => ({
      relativePath: entry.relativePath,
      mediaType: entry.mediaType ?? null,
      description: entry.description ?? null
    }))
  };

  context.logger('archive-report:archive-complete', {
    archivePath,
    archiveDir,
    bytes: stats.size,
    artifactCount: resolvedArtifacts.length
  });

  return {
    status: 'succeeded',
    result: {
      archivePath,
      bytesWritten: stats.size,
      artifactCount: resolvedArtifacts.length,
      assets: [
        {
          assetId: 'directory.insights.archive',
          payload,
          producedAt
        }
      ]
    }
  } satisfies JobRunResult;
}

export default handler;
