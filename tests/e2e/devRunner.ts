import { spawn } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OPERATOR_TOKEN = 'apphub-e2e-operator';

export type DevRunnerHandle = {
  stop: () => Promise<void>;
  pid: number;
};

type StartDevRunnerOptions = {
  env?: NodeJS.ProcessEnv;
  operatorToken?: string;
  logPrefix?: string;
};

function buildDevEnvironment(token: string, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const baseUrl = 'http://127.0.0.1';
  const redisUrl = 'redis://127.0.0.1:6379';
  const s3Endpoint = 'http://127.0.0.1:9000';

  const operatorTokens = [
    {
      subject: 'apphub-e2e',
      token,
      scopes: [
        'service-config:write',
        'job-bundles:write',
        'job-bundles:read',
        'workflows:write',
        'workflows:read',
        'workflows:run'
      ]
    }
  ];

  const defaults: NodeJS.ProcessEnv = {
    NODE_ENV: 'development',
    APPHUB_AUTH_DISABLED: '1',
    APPHUB_SESSION_SECRET: 'apphub-e2e-session',
    APPHUB_OPERATOR_TOKENS: JSON.stringify(operatorTokens),
    APPHUB_DEV_PGHOST: '127.0.0.1',
    APPHUB_DEV_PGPORT: '5432',
    APPHUB_DEV_PGUSER: 'apphub',
    APPHUB_DEV_PGPASSWORD: 'apphub',
    PGHOST: '127.0.0.1',
    PGPORT: '5432',
    PGUSER: 'apphub',
    PGPASSWORD: 'apphub',
    DATABASE_URL: 'postgres://apphub:apphub@127.0.0.1:5432/apphub',
    APPHUB_DEV_REDIS_URL: redisUrl,
    REDIS_URL: redisUrl,
    FILESTORE_REDIS_URL: redisUrl,
    METASTORE_REDIS_URL: redisUrl,
    TIMESTORE_REDIS_URL: redisUrl,
    APPHUB_FILESTORE_BASE_URL: `${baseUrl}:4300`,
    APPHUB_METASTORE_BASE_URL: `${baseUrl}:4100`,
    APPHUB_BUNDLE_STORAGE_BACKEND: 's3',
    APPHUB_BUNDLE_STORAGE_BUCKET: 'apphub-job-bundles',
    APPHUB_BUNDLE_STORAGE_ENDPOINT: s3Endpoint,
    APPHUB_BUNDLE_STORAGE_REGION: 'us-east-1',
    APPHUB_BUNDLE_STORAGE_FORCE_PATH_STYLE: 'true',
    APPHUB_BUNDLE_STORAGE_ACCESS_KEY_ID: 'apphub',
    APPHUB_BUNDLE_STORAGE_SECRET_ACCESS_KEY: 'apphub123',
    APPHUB_JOB_BUNDLE_STORAGE_BACKEND: 's3',
    APPHUB_JOB_BUNDLE_S3_BUCKET: 'apphub-job-bundles',
    APPHUB_JOB_BUNDLE_S3_ENDPOINT: s3Endpoint,
    APPHUB_JOB_BUNDLE_S3_REGION: 'us-east-1',
    APPHUB_JOB_BUNDLE_S3_FORCE_PATH_STYLE: 'true',
    APPHUB_JOB_BUNDLE_S3_ACCESS_KEY_ID: 'apphub',
    APPHUB_JOB_BUNDLE_S3_SECRET_ACCESS_KEY: 'apphub123',
    TIMESTORE_STORAGE_DRIVER: 's3',
    TIMESTORE_S3_BUCKET: 'apphub-timestore',
    TIMESTORE_S3_ENDPOINT: s3Endpoint,
    TIMESTORE_S3_REGION: 'us-east-1',
    TIMESTORE_S3_FORCE_PATH_STYLE: 'true',
    TIMESTORE_S3_ACCESS_KEY_ID: 'apphub',
    TIMESTORE_S3_SECRET_ACCESS_KEY: 'apphub123',
    OBSERVATORY_FILESTORE_BASE_URL: `${baseUrl}:4300`,
    OBSERVATORY_FILESTORE_TOKEN: '',
    OBSERVATORY_CORE_BASE_URL: `${baseUrl}:4000`,
    OBSERVATORY_CORE_TOKEN: token,
    OBSERVATORY_TIMESTORE_BASE_URL: `${baseUrl}:4200`,
    OBSERVATORY_TIMESTORE_DATASET_SLUG: 'observatory-timeseries',
    OBSERVATORY_TIMESTORE_DATASET_NAME: 'Observatory Time Series',
    OBSERVATORY_TIMESTORE_TABLE_NAME: 'observations',
    OBSERVATORY_DASHBOARD_LOOKBACK_MINUTES: '720',
    OBSERVATORY_INSTRUMENT_COUNT: '3',
    AWS_ACCESS_KEY_ID: 'apphub',
    AWS_SECRET_ACCESS_KEY: 'apphub123',
    AWS_REGION: 'us-east-1'
  };

  return {
    ...process.env,
    ...defaults,
    ...overrides
  };
}

export async function startDevRunner(options: StartDevRunnerOptions = {}): Promise<DevRunnerHandle> {
  const token = options.operatorToken ?? DEFAULT_OPERATOR_TOKEN;
  const env = buildDevEnvironment(token, options.env ?? {});
  const child = spawn('npm', ['run', 'dev'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const prefix = options.logPrefix ?? '[dev]';

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`${prefix} ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`${prefix} ${chunk}`);
  });

  let exited = false;
  child.once('exit', () => {
    exited = true;
  });

  return {
    pid: child.pid ?? -1,
    stop: async () => {
      if (exited) {
        return;
      }
      child.kill('SIGINT');
      await new Promise<void>((resolve) => {
        child.once('exit', () => {
          exited = true;
          resolve();
        });
      });
    }
  } satisfies DevRunnerHandle;
}
