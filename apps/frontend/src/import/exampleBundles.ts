import type { ExampleBundlerProgressStage } from '@apphub/example-bundler';

export type ExampleBundleState = 'queued' | 'running' | 'completed' | 'failed';

export type ExampleBundleStatus = {
  slug: string;
  fingerprint: string;
  stage: ExampleBundlerProgressStage;
  state: ExampleBundleState;
  jobId?: string;
  version?: string;
  checksum?: string;
  filename?: string;
  cached?: boolean;
  error?: string | null;
  message?: string | null;
  updatedAt: string;
  createdAt: string;
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
    error: status.error ?? null,
    message: status.message ?? null
  };
}
