export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JobBundleManifest = {
  name: string;
  version: string;
  entry: string;
  description?: string;
  capabilities?: string[];
  metadata?: JsonValue;
  [key: string]: JsonValue | undefined;
};

export type BundleTestConfig = {
  sampleInputPath?: string;
};

export type BundleConfig = {
  slug: string;
  entry?: string;
  outDir?: string;
  manifestPath?: string;
  artifactDir?: string;
  files?: string[];
  tests?: BundleTestConfig;
};

export type NormalizedBundleConfig = Required<Omit<BundleConfig, 'tests' | 'files'>> & {
  files: string[];
  tests: BundleTestConfig;
};

export type PackageResult = {
  manifest: JobBundleManifest;
  config: NormalizedBundleConfig;
  tarballPath: string;
  checksum: string;
};

export type JobResult = {
  status?: 'succeeded' | 'failed' | 'canceled' | 'expired';
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
};
