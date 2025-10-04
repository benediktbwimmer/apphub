import { ensureS3Bucket, type S3BucketOptions } from '@apphub/module-registry';
import type { ModuleDeploymentLogger } from './types';

export async function ensureBuckets(
  buckets: S3BucketOptions[],
  logger: ModuleDeploymentLogger
): Promise<number> {
  let count = 0;
  for (const bucket of buckets) {
    try {
      await ensureS3Bucket(bucket);
      logger.info('Ensured S3 bucket', {
        bucket: bucket.bucket,
        endpoint: bucket.endpoint ?? null
      });
      count += 1;
    } catch (error) {
      logger.error('Failed to ensure S3 bucket', {
        bucket: bucket.bucket,
        endpoint: bucket.endpoint ?? null,
        error
      });
      throw error;
    }
  }
  return count;
}
