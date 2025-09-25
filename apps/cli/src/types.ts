import type {
  JsonValue,
  JobBundleManifest,
  BundleConfig,
  NormalizedBundleConfig,
  PackageResult
} from '@apphub/example-bundler';

export type {
  JsonValue,
  JobBundleManifest,
  BundleConfig,
  NormalizedBundleConfig,
  PackageResult
};

export type JobResult = {
  status?: 'succeeded' | 'failed' | 'canceled' | 'expired';
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
};
