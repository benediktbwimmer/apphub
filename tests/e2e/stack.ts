import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_COMPOSE_FILE = path.join(REPO_ROOT, 'docker', 'e2e-stack.compose.yml');
const DEFAULT_PROJECT = 'apphub-e2e-stack';

type RunCommandOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

async function runCommand(
  command: string[],
  options: RunCommandOptions = {}
): Promise<{ stdout: string; stderr: string }> {
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
    ]);
  }

  await waitForPort({ host: '127.0.0.1', port: 5432, label: 'postgres' });
  await waitForPort({ host: '127.0.0.1', port: 6379, label: 'redis' });
  await waitForPort({ host: '127.0.0.1', port: 9000, label: 'minio' });

  return {
    projectName,
    composeFile,
    stop: async () => {
      await runCommand([
        'docker',
        'compose',
        '-p',
        projectName,
        '-f',
        composeFile,
        'down',
        '-v'
      ]);
    }
  } satisfies ExternalStackHandle;
}
