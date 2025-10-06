import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { materializeObservatoryConfig } from '../src/deployment/config';

const DEFAULT_CORE_URL = 'http://core-api:4000';

function resolveCoreAuth(): { coreUrl: string; coreToken: string } {
  const coreUrl = (process.env.OBSERVATORY_CORE_BASE_URL ?? process.env.APPHUB_CORE_URL ?? DEFAULT_CORE_URL).trim();
  const token =
    process.env.OBSERVATORY_CORE_TOKEN ??
    process.env.APPHUB_CORE_TOKEN ??
    process.env.APPHUB_DEMO_SERVICE_TOKEN ??
    process.env.APPHUB_DEMO_ADMIN_TOKEN ??
    '';

  if (!token.trim()) {
    throw new Error('OBSERVATORY_CORE_TOKEN or APPHUB_CORE_TOKEN must be set to publish the module.');
  }

  return { coreUrl, coreToken: token.trim() };
}

type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
};

const logger: Logger = {
  debug(message, meta) {
    if (process.env.LOG_LEVEL === 'debug') {
      // eslint-disable-next-line no-console
      console.debug('[observatory-deploy]', message, meta ?? {});
    }
  },
  error(message, meta) {
    // eslint-disable-next-line no-console
    console.error('[observatory-deploy]', message, meta ?? {});
  }
};

function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      env: process.env
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const moduleDir = path.resolve(scriptDir, '..');
  const repoRoot = path.resolve(scriptDir, '..', '..', '..');

  await prepareFilesystem(process.env);

  await materializeObservatoryConfig({
    repoRoot: moduleDir,
    env: process.env,
    logger
  });

  const { coreUrl, coreToken } = resolveCoreAuth();

  if (process.env.OBSERVATORY_SKIP_BUILD !== '1') {
    await runCommand('npm', ['run', 'build', '--workspace', '@apphub/observatory-module'], {
      cwd: repoRoot
    });
  }

  if (process.env.OBSERVATORY_BUILD_CLI !== '0') {
    await runCommand('npm', ['run', 'build', '--workspace', '@apphub/cli'], { cwd: repoRoot });
  }

  await runCommand(
    'node',
    [
      path.join(repoRoot, 'apps/cli/dist/index.js'),
      'module',
      'deploy',
      '--module',
      moduleDir,
      '--core-url',
      coreUrl,
      '--core-token',
      coreToken
    ],
    { cwd: repoRoot }
  );
}

async function prepareFilesystem(env: NodeJS.ProcessEnv): Promise<void> {
  const directories = new Set<string>();

  const addDir = (value: string | undefined, opts: { treatAsFile?: boolean } = {}) => {
    const candidate = value?.trim();
    if (!candidate) {
      return;
    }
    if (/^[a-z]+:\/\/|^azure:\/\//i.test(candidate)) {
      return;
    }
    const target = opts.treatAsFile ? path.dirname(candidate) : candidate;
    directories.add(path.resolve(target));
  };

  addDir(env.APPHUB_SCRATCH_ROOT);
  addDir(env.OBSERVATORY_DATA_ROOT);
  addDir(env.TIMESTORE_STORAGE_ROOT);
  addDir(env.TIMESTORE_QUERY_CACHE_DIR);
  addDir(env.TIMESTORE_STAGING_DIRECTORY);
  addDir(env.OBSERVATORY_CONFIG_OUTPUT, { treatAsFile: true });

  for (const dir of directories) {
    await mkdir(dir, { recursive: true });
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[observatory-deploy] Failed to publish module:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

