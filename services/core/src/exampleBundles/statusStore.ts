import type {
  ExampleBundlerProgressStage,
  PackagedExampleBundle
} from '@apphub/example-bundler';
import {
  getExampleBundleStatus as fetchExampleBundleStatusRecord,
  listExampleBundleStatuses as fetchAllExampleBundleStatusRecords,
  recordExampleBundleCompletion,
  upsertExampleBundleStatus,
  clearExampleBundleStatus as removeExampleBundleStatus
} from '../db/exampleBundles';
import type {
  ExampleBundleArtifactRecord,
  ExampleBundleState,
  ExampleBundleStatusRecord
} from '../db';
import {
  createExampleBundleDownloadUrl,
  saveExampleBundleArtifact,
  type ExampleBundleArtifactUpload,
  type ExampleBundleDownloadInfo
} from './bundleStorage';

export type ExampleBundleStateKind = ExampleBundleState;

export type ExampleBundleStatus = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleStateKind;
  jobId: string | null;
  version: string | null;
  checksum: string | null;
  filename: string | null;
  cached: boolean | null;
  storageKind: string | null;
  storageKey: string | null;
  storageUrl: string | null;
  contentType: string | null;
  size: number | null;
  artifactId: string | null;
  artifactUploadedAt: string | null;
  downloadUrl: string | null;
  downloadUrlExpiresAt: string | null;
  error: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

const DEFAULT_FAILURE_MESSAGE = 'example bundle packaging failed';

export async function recordProgress(
  slug: string,
  fingerprint: string,
  stage: ExampleBundlerProgressStage,
  options: {
    jobId?: string;
    error?: string | null;
    message?: string | null;
  } = {}
): Promise<ExampleBundleStatus> {
  const normalizedSlug = normalizeSlug(slug);
  const normalizedFingerprint = normalizeFingerprint(fingerprint);
  const existing = await fetchExampleBundleStatusRecord(normalizedSlug);
  const nextState = determineState(stage);

  if (
    existing &&
    (existing.state === 'completed' || existing.state === 'failed') &&
    nextState !== existing.state
  ) {
    return buildStatusView(existing);
  }

  const errorMessage = stage === 'failed' ? options.error ?? DEFAULT_FAILURE_MESSAGE : null;
  const message = options.message ?? existing?.message ?? null;
  const statusRecord = await upsertExampleBundleStatus({
    slug: normalizedSlug,
    fingerprint: normalizedFingerprint,
    stage,
    state: nextState,
    jobId: options.jobId ?? existing?.jobId ?? null,
    version: existing?.version ?? null,
    checksum: existing?.checksum ?? null,
    filename: existing?.filename ?? null,
    cached: existing?.cached ?? null,
    error: errorMessage,
    message,
    artifactId: existing?.artifactId ?? null,
    completedAt: existing?.completedAt ?? null
  });

  return buildStatusView(statusRecord);
}

export async function recordCompletion(
  result: PackagedExampleBundle,
  options: { jobId?: string } = {}
): Promise<ExampleBundleStatus> {
  const normalizedSlug = normalizeSlug(result.slug);
  const normalizedFingerprint = normalizeFingerprint(result.fingerprint);

  const artifactInput: ExampleBundleArtifactUpload = {
    slug: normalizedSlug,
    fingerprint: normalizedFingerprint,
    version: result.version,
    data: result.buffer,
    checksum: result.checksum,
    filename: result.filename,
    contentType: result.contentType
  } satisfies ExampleBundleArtifactUpload;

  const artifactSave = await saveExampleBundleArtifact(artifactInput, { force: true });

  const statusRecord = await recordExampleBundleCompletion(
    {
      slug: normalizedSlug,
      fingerprint: normalizedFingerprint,
      stage: 'completed',
      state: 'completed',
      jobId: options.jobId ?? null,
      version: result.version,
      checksum: artifactSave.checksum,
      filename: result.filename,
      cached: result.cached,
      error: null,
      message: null
    },
    {
      slug: normalizedSlug,
      fingerprint: normalizedFingerprint,
      version: result.version,
      checksum: artifactSave.checksum,
      filename: result.filename,
      storageKind: artifactSave.storageKind,
      storageKey: artifactSave.storageKey,
      storageUrl: artifactSave.storageUrl,
      contentType: artifactSave.contentType,
      size: artifactSave.size,
      jobId: options.jobId ?? null
    }
  );

  return buildStatusView(statusRecord);
}

export async function listStatuses(): Promise<ExampleBundleStatus[]> {
  const records = await fetchAllExampleBundleStatusRecords();
  return Promise.all(records.map((record) => buildStatusView(record)));
}

export async function getStatus(slug: string): Promise<ExampleBundleStatus | null> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return null;
  }
  const record = await fetchExampleBundleStatusRecord(normalizedSlug);
  if (!record) {
    return null;
  }
  return buildStatusView(record);
}

export async function clearStatus(slug: string): Promise<void> {
  const normalizedSlug = normalizeSlug(slug);
  if (!normalizedSlug) {
    return;
  }
  await removeExampleBundleStatus(normalizedSlug);
}

function determineState(stage: ExampleBundlerProgressStage): ExampleBundleState {
  if (stage === 'failed') {
    return 'failed';
  }
  if (stage === 'completed') {
    return 'completed';
  }
  if (stage === 'queued') {
    return 'queued';
  }
  return 'running';
}

async function buildStatusView(record: ExampleBundleStatusRecord): Promise<ExampleBundleStatus> {
  const artifact = record.artifact ?? null;
  let download: ExampleBundleDownloadInfo | null = null;
  if (artifact) {
    try {
      download = await createExampleBundleDownloadUrl(artifact, {
        filename: record.filename ?? artifact.filename ?? null
      });
    } catch (err) {
      console.warn('[example-bundles] Failed to create download URL', err);
      download = null;
    }
  }
  return mapStatusRecord(record, artifact, download);
}

function mapStatusRecord(
  record: ExampleBundleStatusRecord,
  artifact: ExampleBundleArtifactRecord | null,
  download: ExampleBundleDownloadInfo | null
): ExampleBundleStatus {
  return {
    slug: record.slug,
    fingerprint: record.fingerprint,
    stage: record.stage,
    state: record.state,
    jobId: record.jobId,
    version: record.version ?? null,
    checksum: record.checksum ?? null,
    filename: record.filename ?? null,
    cached: record.cached ?? null,
    storageKind: artifact?.storageKind ?? null,
    storageKey: artifact?.storageKey ?? null,
    storageUrl: artifact?.storageUrl ?? null,
    contentType: artifact?.contentType ?? null,
    size: artifact?.size ?? null,
    artifactId: record.artifactId,
    artifactUploadedAt: artifact?.uploadedAt ?? null,
    downloadUrl: download?.url ?? null,
    downloadUrlExpiresAt: download ? new Date(download.expiresAt).toISOString() : null,
    error: record.error ?? null,
    message: record.message ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    completedAt: record.completedAt
  } satisfies ExampleBundleStatus;
}

function normalizeSlug(value: string): string {
  return value ? value.trim().toLowerCase() : '';
}

function normalizeFingerprint(value: string): string {
  return value ? value.trim() : '';
}
