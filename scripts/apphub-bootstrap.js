#!/usr/bin/env node
'use strict';

const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');
const {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand
} = require('@aws-sdk/client-s3');

function log(level, message, meta) {
  const payload = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  // eslint-disable-next-line no-console
  console[level](`[apphub-bootstrap] ${message}${payload}`);
}

function parseOptionalBoolean(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

async function ensureDirectories(env) {
  const directories = new Set();

  const addPath = (value, { treatAsFile = false } = {}) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    if (/^[a-z]+:\/\//i.test(trimmed)) {
      return;
    }
    const target = treatAsFile ? path.dirname(trimmed) : trimmed;
    directories.add(path.resolve(target));
  };

  addPath(env.APPHUB_SCRATCH_ROOT);
  addPath(env.OBSERVATORY_DATA_ROOT);
  addPath(env.TIMESTORE_STORAGE_ROOT);
  addPath(env.TIMESTORE_QUERY_CACHE_DIR);
  addPath(env.OBSERVATORY_CONFIG_OUTPUT, { treatAsFile: true });

  for (const dir of directories) {
    await mkdir(dir, { recursive: true });
    log('info', 'Ensured directory', { path: dir });
  }
}

function collectBucketSpecs(env) {
  const specs = new Map();

  const addSpec = (spec) => {
    if (!spec || !spec.bucket) {
      return;
    }
    const key = `${spec.bucket}::${spec.endpoint ?? ''}`;
    if (!specs.has(key)) {
      specs.set(key, spec);
      return;
    }
    const existing = specs.get(key);
    specs.set(key, {
      bucket: spec.bucket,
      endpoint: spec.endpoint ?? existing.endpoint ?? null,
      region: spec.region ?? existing.region ?? null,
      forcePathStyle: spec.forcePathStyle ?? existing.forcePathStyle ?? null,
      accessKeyId: spec.accessKeyId ?? existing.accessKeyId ?? null,
      secretAccessKey: spec.secretAccessKey ?? existing.secretAccessKey ?? null,
      sessionToken: spec.sessionToken ?? existing.sessionToken ?? null
    });
  };

  const awsRegion = env.AWS_REGION || 'us-east-1';
  const awsAccessKeyId = env.AWS_ACCESS_KEY_ID ?? null;
  const awsSecretAccessKey = env.AWS_SECRET_ACCESS_KEY ?? null;
  const awsSessionToken = env.AWS_SESSION_TOKEN ?? null;

  const candidates = [
    {
      bucket: env.APPHUB_BUNDLE_STORAGE_BUCKET,
      endpoint: env.APPHUB_BUNDLE_STORAGE_ENDPOINT,
      region: env.APPHUB_BUNDLE_STORAGE_REGION || awsRegion,
      forcePathStyle: parseOptionalBoolean(env.APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE),
      accessKeyId: env.APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID ?? awsAccessKeyId,
      secretAccessKey: env.APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY ?? awsSecretAccessKey,
      sessionToken: env.APPHUB_BUNDLE_STORAGE_SESSION_TOKEN ?? awsSessionToken
    },
    {
      bucket: env.APPHUB_JOB_BUNDLE_S3_BUCKET,
      endpoint: env.APPHUB_JOB_BUNDLE_S3_ENDPOINT,
      region: env.APPHUB_JOB_BUNDLE_S3_REGION || awsRegion,
      forcePathStyle: parseOptionalBoolean(env.APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID ?? awsAccessKeyId,
      secretAccessKey: env.APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY ?? awsSecretAccessKey,
      sessionToken: env.APPHUB_JOB_BUNDLE_S3_SESSION_TOKEN ?? awsSessionToken
    },
    {
      bucket: env.TIMESTORE_S3_BUCKET,
      endpoint: env.TIMESTORE_S3_ENDPOINT,
      region: env.TIMESTORE_S3_REGION || awsRegion,
      forcePathStyle: parseOptionalBoolean(env.TIMESTORE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.TIMESTORE_S3_ACCESS_KEY_ID ?? awsAccessKeyId,
      secretAccessKey: env.TIMESTORE_S3_SECRET_ACCESS_KEY ?? awsSecretAccessKey,
      sessionToken: env.TIMESTORE_S3_SESSION_TOKEN ?? awsSessionToken
    },
    {
      bucket: env.OBSERVATORY_FILESTORE_S3_BUCKET,
      endpoint: env.OBSERVATORY_FILESTORE_S3_ENDPOINT,
      region: env.OBSERVATORY_FILESTORE_S3_REGION || awsRegion,
      forcePathStyle: parseOptionalBoolean(env.OBSERVATORY_FILESTORE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.OBSERVATORY_FILESTORE_S3_ACCESS_KEY_ID ?? awsAccessKeyId,
      secretAccessKey: env.OBSERVATORY_FILESTORE_S3_SECRET_ACCESS_KEY ?? awsSecretAccessKey,
      sessionToken: env.OBSERVATORY_FILESTORE_S3_SESSION_TOKEN ?? awsSessionToken
    }
  ];

  const fallbackBucketRaw =
    typeof env.CLICKHOUSE_S3_DEFAULT_BUCKET === 'string' && env.CLICKHOUSE_S3_DEFAULT_BUCKET.trim().length > 0
      ? env.CLICKHOUSE_S3_DEFAULT_BUCKET.trim()
      : 'default';

  if (fallbackBucketRaw && fallbackBucketRaw.length > 0) {
    candidates.push({
      bucket: fallbackBucketRaw,
      endpoint: env.TIMESTORE_S3_ENDPOINT,
      region: env.TIMESTORE_S3_REGION || awsRegion,
      forcePathStyle: parseOptionalBoolean(env.TIMESTORE_S3_FORCE_PATH_STYLE),
      accessKeyId: env.TIMESTORE_S3_ACCESS_KEY_ID ?? awsAccessKeyId,
      secretAccessKey: env.TIMESTORE_S3_SECRET_ACCESS_KEY ?? awsSecretAccessKey,
      sessionToken: env.TIMESTORE_S3_SESSION_TOKEN ?? awsSessionToken
    });
  }

  for (const entry of candidates) {
    if (typeof entry.bucket === 'string' && entry.bucket.trim().length > 0) {
      addSpec({
        bucket: entry.bucket.trim(),
        endpoint: entry.endpoint?.trim() || null,
        region: entry.region?.trim() || awsRegion,
        forcePathStyle:
          typeof entry.forcePathStyle === 'boolean' ? entry.forcePathStyle : true,
        accessKeyId: entry.accessKeyId?.trim() || null,
        secretAccessKey: entry.secretAccessKey?.trim() || null,
        sessionToken: entry.sessionToken?.trim() || null
      });
    }
  }

  return Array.from(specs.values());
}

async function ensureBucket(spec) {
  const region = spec.region || 'us-east-1';
  const client = new S3Client({
    region,
    endpoint: spec.endpoint ?? undefined,
    forcePathStyle: spec.forcePathStyle !== false,
    credentials:
      spec.accessKeyId && spec.secretAccessKey
        ? {
            accessKeyId: spec.accessKeyId,
            secretAccessKey: spec.secretAccessKey,
            sessionToken: spec.sessionToken ?? undefined
          }
        : undefined
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: spec.bucket }));
    log('info', 'Bucket already exists', { bucket: spec.bucket, endpoint: spec.endpoint ?? null });
    return;
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = (error && (error.Code || error.code || error.name)) || '';
    const normalized = typeof code === 'string' ? code.toLowerCase() : '';
    if (status !== 404 && normalized !== 'nosuchbucket' && normalized !== 'notfound') {
      client.destroy();
      throw error;
    }
  }

  try {
    const input = { Bucket: spec.bucket };
    if (region.toLowerCase() !== 'us-east-1') {
      input.CreateBucketConfiguration = { LocationConstraint: region };
    }
    await client.send(new CreateBucketCommand(input));
    log('info', 'Created bucket', { bucket: spec.bucket, endpoint: spec.endpoint ?? null });
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    const code = (error && (error.Code || error.code || error.name)) || '';
    const normalized = typeof code === 'string' ? code.toLowerCase() : '';
    if (status === 409 || normalized === 'bucketalreadyownedbyyou' || normalized === 'bucketalreadyexists') {
      log('info', 'Bucket already owned', { bucket: spec.bucket, endpoint: spec.endpoint ?? null });
    } else {
      client.destroy();
      throw error;
    }
  } finally {
    client.destroy();
  }
}

function buildClickHouseUrl(env) {
  const host = (env.TIMESTORE_CLICKHOUSE_HOST ?? 'clickhouse').trim();
  const port = (env.TIMESTORE_CLICKHOUSE_HTTP_PORT ?? '8123').trim();
  const secure = String(env.TIMESTORE_CLICKHOUSE_SECURE ?? 'false').toLowerCase() === 'true';
  const protocol = secure ? 'https' : 'http';
  if (!host) {
    return null;
  }
  return `${protocol}://${host}:${port}/?database=default`;
}

async function ensureClickHouseDatabase(env) {
  const database = (env.TIMESTORE_CLICKHOUSE_DATABASE ?? 'apphub').trim();
  if (!database) {
    return;
  }
  const url = buildClickHouseUrl(env);
  if (!url) {
    log('warn', 'ClickHouse host not configured; skipping database creation');
    return;
  }

  const user = (env.TIMESTORE_CLICKHOUSE_USER ?? '').trim();
  const password = (env.TIMESTORE_CLICKHOUSE_PASSWORD ?? '').trim();

  const headers = {
    'Content-Type': 'text/plain'
  };
  if (user) {
    const credentials = `${user}:${password}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: `CREATE DATABASE IF NOT EXISTS ${database}`
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`ClickHouse responded with ${response.status}: ${text || 'unknown error'}`);
    }
    log('info', 'Ensured ClickHouse database', { database, url });
  } catch (error) {
    log('warn', 'Failed to ensure ClickHouse database', {
      database,
      url,
      error: error?.message ?? String(error)
    });
  }
}

async function main() {
  log('info', 'Starting AppHub bootstrap');
  await ensureDirectories(process.env);

  const bucketSpecs = collectBucketSpecs(process.env);
  for (const spec of bucketSpecs) {
    await ensureBucket(spec);
  }

  await ensureClickHouseDatabase(process.env);

  log('info', 'Bootstrap complete', { bucketsEnsured: bucketSpecs.map((spec) => spec.bucket) });
}

main().catch((error) => {
  log('error', 'Bootstrap failed', {
    message: error?.message ?? String(error),
    stack: error?.stack ?? null
  });
  process.exit(1);
});
