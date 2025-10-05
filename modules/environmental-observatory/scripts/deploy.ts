import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { materializeObservatoryConfig } from '../src/deployment/config';

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

  await materializeObservatoryConfig({
    repoRoot: moduleDir,
    env: process.env,
    logger
  });

  await runCommand(
    'npm',
    ['run', 'module:publish', '--', '--module', moduleDir, '--register-jobs', '--skip-build'],
    { cwd: repoRoot }
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[observatory-deploy] Failed to publish module:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
