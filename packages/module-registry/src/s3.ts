import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
  type CreateBucketCommandInput,
  type S3ServiceException
} from '@aws-sdk/client-s3';

export type S3BucketOptions = {
  bucket: string;
  endpoint?: string | null;
  region?: string | null;
  forcePathStyle?: boolean | null;
  accessKeyId?: string | null;
  secretAccessKey?: string | null;
  sessionToken?: string | null;
};

function extractS3ErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { Code?: string }).Code;
  if (typeof code === 'string' && code.length > 0) {
    return code;
  }
  const lowerCode = (error as { code?: string }).code;
  if (typeof lowerCode === 'string' && lowerCode.length > 0) {
    return lowerCode;
  }
  const name = (error as { name?: string }).name;
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  return undefined;
}

function isMissingBucketError(error: unknown): boolean {
  const status = (error as S3ServiceException | undefined)?.$metadata?.httpStatusCode;
  if (status === 404) {
    return true;
  }
  const code = extractS3ErrorCode(error);
  if (!code) {
    return false;
  }
  const normalized = code.toLowerCase();
  return normalized === 'nosuchbucket' || normalized === 'notfound';
}

function isBucketAlreadyOwnedError(error: unknown): boolean {
  const status = (error as S3ServiceException | undefined)?.$metadata?.httpStatusCode;
  if (status === 409) {
    return true;
  }
  const code = extractS3ErrorCode(error);
  if (!code) {
    return false;
  }
  const normalized = code.toLowerCase();
  return normalized === 'bucketalreadyownedbyyou' || normalized === 'bucketalreadyexists';
}

export async function ensureS3Bucket(
  options: S3BucketOptions,
  logger?: { debug?: (meta: Record<string, unknown>) => void }
): Promise<void> {
  const bucket = options.bucket.trim();
  if (!bucket) {
    return;
  }

  const region = (options.region ?? process.env.AWS_REGION ?? 'us-east-1').trim();
  const endpoint = options.endpoint ?? process.env.AWS_S3_ENDPOINT ?? undefined;
  const accessKeyId = options.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID ?? undefined;
  const secretAccessKey = options.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY ?? undefined;
  const sessionToken = options.sessionToken ?? process.env.AWS_SESSION_TOKEN ?? undefined;
  const forcePathStyle = options.forcePathStyle ?? true;

  const client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials:
      accessKeyId && secretAccessKey
        ? {
            accessKeyId,
            secretAccessKey,
            sessionToken: sessionToken ?? undefined
          }
        : undefined
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger?.debug?.({ bucket, region, endpoint });
    return;
  } catch (error) {
    if (!isMissingBucketError(error)) {
      client.destroy();
      throw error;
    }
  }

  try {
    const createInput: CreateBucketCommandInput = { Bucket: bucket };
    if (region && region.toLowerCase() !== 'us-east-1') {
      createInput.CreateBucketConfiguration = {
        LocationConstraint: region as BucketLocationConstraint
      };
    }
    await client.send(new CreateBucketCommand(createInput));
    logger?.debug?.({ bucket, region, endpoint });
  } catch (error) {
    if (!isBucketAlreadyOwnedError(error)) {
      throw error;
    }
    logger?.debug?.({ bucket, region, endpoint });
  } finally {
    client.destroy();
  }
}
