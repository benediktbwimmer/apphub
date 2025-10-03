import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import type { EventDrivenObservatoryConfig } from '@apphub/module-registry';
import {
  deployEnvironmentalObservatoryModule,
  type DeployObservatoryOptions,
  type DeployObservatoryResult
} from '../../modules/environmental-observatory/scripts/deploy';
import {
  MINIO_ENDPOINT,
  OBSERVATORY_OPERATOR_TOKEN,
  configureE2EEnvironment
} from './env';

const DEFAULT_S3_REGION = 'us-east-1';
const DEFAULT_ACCESS_KEY = 'apphub';
const DEFAULT_SECRET_KEY = 'apphub123';
const REQUIRED_BUCKETS = ['apphub-example-bundles', 'apphub-timestore', 'apphub-filestore'] as const;

type EnsureBucketsOptions = {
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
};

async function ensureBuckets(options: EnsureBucketsOptions = {}): Promise<void> {
  console.info('[observatory] Ensuring MinIO buckets exist');
  const client = new S3Client({
    endpoint: options.endpoint ?? MINIO_ENDPOINT,
    region: options.region ?? DEFAULT_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId ?? DEFAULT_ACCESS_KEY,
      secretAccessKey: options.secretAccessKey ?? DEFAULT_SECRET_KEY
    }
  });

  for (const bucket of REQUIRED_BUCKETS) {
    console.info('[observatory] Checking bucket', { bucket });
    let exists = false;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      exists = true;
    } catch {
      exists = false;
    }

    if (exists) {
      console.info('[observatory] Bucket present', { bucket });
      continue;
    }

    console.info('[observatory] Creating missing bucket', { bucket });
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

export type PrepareObservatoryOptions = {
  repoRoot?: string;
  skipGeneratorSchedule?: boolean;
};

export type ObservatoryContext = {
  config: EventDrivenObservatoryConfig;
  configPath: string;
  coreBaseUrl: string;
  coreToken: string;
};

export async function prepareObservatoryModule(
  options: PrepareObservatoryOptions = {}
): Promise<ObservatoryContext> {
  const restoreEnv = configureE2EEnvironment();
  try {
    console.info('[observatory] Preparing module deployment', { options });
    await ensureBuckets();

    const deployOptions: DeployObservatoryOptions = {
      repoRoot: options.repoRoot,
      skipGeneratorSchedule: options.skipGeneratorSchedule ?? true
    };

    console.info('[observatory] Deploying observatory module', deployOptions);

    const result: DeployObservatoryResult = await deployEnvironmentalObservatoryModule(deployOptions);

    if (!result.coreToken) {
      result.coreToken = OBSERVATORY_OPERATOR_TOKEN;
    }

    return {
      config: result.config,
      configPath: result.configPath,
      coreBaseUrl: result.coreBaseUrl,
      coreToken: result.coreToken
    } satisfies ObservatoryContext;
  } finally {
    console.info('[observatory] Restoring environment overrides');
    restoreEnv();
  }
}

export const prepareObservatoryExample = prepareObservatoryModule;
