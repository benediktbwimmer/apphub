import type { ExampleBundlerProgressStage } from '@apphub/example-bundler';

export type ExampleBundleState = 'queued' | 'running' | 'completed' | 'failed';

export type ExampleBundleStatus = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId: string | null;
  version: string | null;
  checksum: string | null;
  filename: string | null;
  cached: boolean | null;
  storageKind: 'local' | 's3' | null;
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
  updatedAt: string;
  createdAt: string;
  completedAt: string | null;
};

export type ExampleBundleStatusResponse = {
  data: {
    statuses: ExampleBundleStatus[];
  };
};

export type ExampleBundleProgressEvent = {
  type: 'example.bundle.progress';
  data: ExampleBundleStatus;
};

export function normalizeBundleStatus(status: ExampleBundleStatus): ExampleBundleStatus {
  return {
    ...status,
    stage: status.stage,
    state: status.state,
    jobId: status.jobId ?? null,
    version: status.version ?? null,
    checksum: status.checksum ?? null,
    filename: status.filename ?? null,
    cached: status.cached ?? null,
    storageKind: status.storageKind ?? null,
    storageKey: status.storageKey ?? null,
    storageUrl: status.storageUrl ?? null,
    contentType: status.contentType ?? null,
    size: status.size ?? null,
    artifactId: status.artifactId ?? null,
    artifactUploadedAt: status.artifactUploadedAt ?? null,
    downloadUrl: status.downloadUrl ?? null,
    downloadUrlExpiresAt: status.downloadUrlExpiresAt ?? null,
    error: status.error ?? null,
    message: status.message ?? null,
    completedAt: status.completedAt ?? null
  };
}
