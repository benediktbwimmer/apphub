import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { MINIO_PORT } from './env';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_COMPOSE_FILE = path.join(REPO_ROOT, 'docker', 'e2e-stack.compose.yml');
const DEFAULT_OPERATOR_TOKEN = 'apphub-e2e-operator';
const DEFAULT_REPO_ROOT_ENV = 'APPHUB_E2E_REPO_ROOT';
const DEFAULT_OPERATOR_TOKEN_ENV = 'APPHUB_E2E_OPERATOR_TOKEN';
const DEFAULT_PROJECT = 'apphub-e2e-stack';

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

async function runCommand(
  command: string[],
  options: RunCommandOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  console.info('[stack] Executing command', { command: command.join(' ') });
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.cwd ?? REPO_ROOT,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      reject(error);
    });
    child.once('close', (code) => {
      if (code === 0) {
        console.info('[stack] Command completed', { command: command.join(' '), code });
        resolve({ stdout, stderr });
      } else {
        const message = `Command failed (${command.join(' ')}): exit ${code}\n${stderr || stdout}`;
        reject(new Error(message));
      }
    });
  });
}

type PortTarget = {
  host: string;
  port: number;
  label: string;
};

async function waitForPort(target: PortTarget, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  console.info('[stack] Waiting for port', { target, timeoutMs });

  const attempt = async (): Promise<boolean> =>
    await new Promise<boolean>((resolve) => {
      const socket = net.connect(target.port, target.host);
      const onError = () => {
        socket.destroy();
        resolve(false);
      };
      socket.once('error', onError);
      socket.once('timeout', onError);
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.setTimeout(2_000);
    });

  while (Date.now() < deadline) {
    const ok = await attempt();
    if (ok) {
      console.info('[stack] Port ready', { target });
      return;
    }
    await sleep(1_000);
  }

  throw new Error(`Timed out waiting for ${target.label} on ${target.host}:${target.port}`);
}

export type ExternalStackHandle = {
  projectName: string;
  composeFile: string;
  stop: () => Promise<void>;
};

type StartStackOptions = {
  composeFile?: string;
  projectName?: string;
  skipContainers?: boolean;
};

export async function startExternalStack(options: StartStackOptions = {}): Promise<ExternalStackHandle> {
  const composeFile = options.composeFile ?? DEFAULT_COMPOSE_FILE;
  const projectName = options.projectName ?? DEFAULT_PROJECT;

  const envOverrides: NodeJS.ProcessEnv = {
    [DEFAULT_REPO_ROOT_ENV]: REPO_ROOT,
    [DEFAULT_OPERATOR_TOKEN_ENV]: process.env.APPHUB_E2E_OPERATOR_TOKEN ?? DEFAULT_OPERATOR_TOKEN
  };

  console.info('[stack] Starting external stack', {
    composeFile,
    projectName,
    skipContainers: options.skipContainers ?? false
  });
  if (!options.skipContainers) {
    await runCommand([
      'docker',
      'compose',
      '-p',
      projectName,
      '-f',
      composeFile,
      'up',
      '-d',
      '--remove-orphans'
    ], { env: envOverrides });
  }

  await waitForPort({ host: '127.0.0.1', port: MINIO_PORT, label: 'minio' });

  return {
    projectName,
    composeFile,
    stop: async () => {
      console.info('[stack] Stopping external stack', { projectName });
      await runCommand([
        'docker',
        'compose',
        '-p',
        projectName,
        '-f',
        composeFile,
        'down',
        '-v'
      ], { env: envOverrides });
    }
  } satisfies ExternalStackHandle;
}
