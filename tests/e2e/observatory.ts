import { S3Client, HeadBucketCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import type { EventDrivenObservatoryConfig } from '@apphub/examples';
import {
  deployEnvironmentalObservatoryExample,
  type DeployObservatoryOptions,
  type DeployObservatoryResult
} from '../../examples/environmental-observatory-event-driven/scripts/deploy';

const DEFAULT_S3_ENDPOINT = 'http://127.0.0.1:9000';
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
  const client = new S3Client({
    endpoint: options.endpoint ?? DEFAULT_S3_ENDPOINT,
    region: options.region ?? DEFAULT_S3_REGION,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKeyId ?? DEFAULT_ACCESS_KEY,
      secretAccessKey: options.secretAccessKey ?? DEFAULT_SECRET_KEY
    }
  });

  for (const bucket of REQUIRED_BUCKETS) {
    let exists = false;
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      exists = true;
    } catch {
      exists = false;
    }

    if (exists) {
      continue;
    }

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

export async function prepareObservatoryExample(
  options: PrepareObservatoryOptions = {}
): Promise<ObservatoryContext> {
  await ensureBuckets();

  const deployOptions: DeployObservatoryOptions = {
    repoRoot: options.repoRoot,
    skipGeneratorSchedule: options.skipGeneratorSchedule ?? true
  };

  const result: DeployObservatoryResult = await deployEnvironmentalObservatoryExample(deployOptions);

  return {
    config: result.config,
    configPath: result.configPath,
    coreBaseUrl: result.coreBaseUrl,
    coreToken: result.coreToken
  };
}
