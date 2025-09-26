import type { JsonValue, JobBundleRecord, JobBundleVersionRecord } from '../db';
import {
  publishJobBundleVersion,
  getJobBundleBySlug,
  getJobBundleVersion,
  listJobBundleVersions,
  updateJobBundleVersion,
  listJobBundles
} from '../db/jobBundles';
import {
  saveJobBundleArtifact,
  createBundleDownloadUrl,
  type BundleArtifactUpload,
  type BundleDownloadInfo
} from './bundleStorage';
import { emitApphubEvent } from '../events';

export type PublishActorContext = {
  subject?: string | null;
  kind?: string | null;
  tokenHash?: string | null;
};

export type BundlePublishRequest = {
  slug: string;
  version: string;
  manifest: JsonValue;
  capabilityFlags?: string[] | null;
  immutable?: boolean;
  metadata?: JsonValue | null;
  description?: string | null;
  displayName?: string | null;
  force?: boolean;
  artifact: Omit<BundleArtifactUpload, 'slug' | 'version' | 'data'> & {
    data: Buffer;
    checksum?: string | null;
  };
};

export type BundlePublishResult = {
  bundle: JobBundleRecord;
  version: JobBundleVersionRecord;
  download: BundleDownloadInfo;
};

function normalizeCapabilityFlags(flags?: string[] | null): string[] {
  if (!flags) {
    return [];
  }
  const set = new Set<string>();
  for (const flag of flags) {
    if (typeof flag !== 'string') {
      continue;
    }
    const trimmed = flag.trim();
    if (trimmed.length === 0) {
      continue;
    }
    set.add(trimmed);
  }
  return Array.from(set).sort();
}

export async function publishBundleVersion(
  request: BundlePublishRequest,
  actor: PublishActorContext = {}
): Promise<BundlePublishResult> {
  const capabilityFlags = normalizeCapabilityFlags(request.capabilityFlags);

  const artifactSaveResult = await saveJobBundleArtifact({
    slug: request.slug,
    version: request.version,
    data: request.artifact.data,
    filename: request.artifact.filename ?? null,
    contentType: request.artifact.contentType ?? null
  }, {
    force: request.force
  });

  if (request.artifact.checksum) {
    const expected = request.artifact.checksum.trim().toLowerCase();
    if (expected && expected !== artifactSaveResult.checksum) {
      throw new Error('Artifact checksum mismatch');
    }
  }

  const { bundle, version } = await publishJobBundleVersion({
    slug: request.slug,
    version: request.version,
    manifest: request.manifest,
    capabilityFlags,
    immutable: request.immutable ?? false,
    metadata: request.metadata ?? null,
    description: request.description ?? null,
    displayName: request.displayName ?? null,
    checksum: artifactSaveResult.checksum,
    artifactStorage: artifactSaveResult.storage,
    artifactPath: artifactSaveResult.artifactPath,
    artifactSize: artifactSaveResult.size,
    artifactContentType: artifactSaveResult.contentType,
    artifactData: request.artifact.data,
    publishedBy: actor.subject ?? null,
    publishedByKind: actor.kind ?? null,
    publishedByTokenHash: actor.tokenHash ?? null,
    force: request.force ?? false
  });

  const download = await createBundleDownloadUrl(version, {
    filename: request.artifact.filename ?? null
  });

  const eventType = version.replacedAt ? 'job.bundle.updated' : 'job.bundle.published';
  emitApphubEvent({ type: eventType, data: { bundle, version } });

  return { bundle, version, download } satisfies BundlePublishResult;
}

export async function getBundle(slug: string): Promise<JobBundleRecord | null> {
  return getJobBundleBySlug(slug, { includeVersions: false });
}

export async function listBundles(): Promise<JobBundleRecord[]> {
  return listJobBundles();
}

export async function getBundleWithVersions(slug: string): Promise<JobBundleRecord | null> {
  return getJobBundleBySlug(slug, { includeVersions: true });
}

export async function getBundleVersionWithDownload(
  slug: string,
  version: string,
  options?: { filename?: string | null }
): Promise<{ bundle: JobBundleRecord; version: JobBundleVersionRecord; download: BundleDownloadInfo } | null> {
  const bundle = await getJobBundleBySlug(slug, { includeVersions: false });
  if (!bundle) {
    return null;
  }
  const record = await getJobBundleVersion(slug, version);
  if (!record) {
    return null;
  }
  const download = await createBundleDownloadUrl(record, {
    filename: options?.filename ?? null
  });
  return { bundle, version: record, download };
}

export async function listBundleVersions(slug: string): Promise<JobBundleVersionRecord[]> {
  return listJobBundleVersions(slug);
}

export async function updateBundleVersion(
  slug: string,
  version: string,
  updates: Parameters<typeof updateJobBundleVersion>[2]
): Promise<JobBundleVersionRecord | null> {
  const updated = await updateJobBundleVersion(slug, version, updates);
  if (!updated) {
    return null;
  }
  const bundle = await getJobBundleBySlug(slug, { includeVersions: false });
  if (bundle) {
    const eventType = updated.status === 'deprecated' ? 'job.bundle.deprecated' : 'job.bundle.updated';
    emitApphubEvent({ type: eventType, data: { bundle, version: updated } });
  }
  return updated;
}
