import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_COMPOSE_FILE = path.join(REPO_ROOT, 'docker', 'observatory-e2e.compose.yml');
const DEFAULT_PROJECT = 'apphub-observatory-e2e';
const DEFAULT_OPERATOR_TOKEN = 'apphub-e2e-operator';

export type ComposeEnvironment = NodeJS.ProcessEnv;

export interface StackHandle {
  project: string;
  composeFile: string;
  environment: ComposeEnvironment;
  stop: () => Promise<void>;
  collectLogs: () => Promise<string>;
}

export interface StartStackOptions {
  project?: string;
  composeFile?: string;
  operatorToken?: string;
  skipUp?: boolean;
}

async function runDockerCompose(
  args: string[],
  options: {
    composeFile: string;
    project: string;
    env: ComposeEnvironment;
  }
): Promise<{ stdout: string; stderr: string }> {
  const fullArgs = ['compose', '-p', options.project, '-f', options.composeFile, ...args];
  const child = spawn('docker', fullArgs, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...options.env
    },
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

  const [code] = await once(child, 'close');
  if (code !== 0) {
    const message = stderr || stdout;
    throw new Error(`docker compose ${args.join(' ')} failed (exit ${code})\n${message}`);
  }

  return { stdout, stderr };
}

export async function waitForPort(
  port: number,
  options: {
    host?: string;
    label?: string;
    timeoutMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<void> {
  const host = options.host ?? '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? 120_000;
  const pollInterval = options.pollIntervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  const label = options.label ?? `${host}:${port}`;

  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port });
      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };
      socket.once('connect', () => {
        cleanup();
        resolve(true);
      });
      socket.once('error', () => {
        cleanup();
        resolve(false);
      });
      socket.setTimeout(2_000, () => {
        cleanup();
        resolve(false);
      });
    });

    if (connected) {
      return;
    }

    await sleep(pollInterval);
  }

  throw new Error(`Timed out waiting for ${label}`);
}

export async function startStack(options: StartStackOptions = {}): Promise<StackHandle> {
  const composeFile = options.composeFile ?? DEFAULT_COMPOSE_FILE;
  const project = options.project ?? DEFAULT_PROJECT;
  const operatorToken = options.operatorToken ?? process.env.APPHUB_E2E_OPERATOR_TOKEN ?? DEFAULT_OPERATOR_TOKEN;

  const environment: ComposeEnvironment = {
    APPHUB_E2E_REPO_ROOT: REPO_ROOT,
    APPHUB_E2E_OPERATOR_TOKEN: operatorToken
  };

  if (options.skipUp !== true) {
    await runDockerCompose(['up', '--build', '-d', '--remove-orphans'], {
      composeFile,
      project,
      env: environment
    });
  }

  // Wait for core dependencies to accept connections.
  const minioPort = Number(process.env.APPHUB_E2E_MINIO_PORT ?? '9400');
  await waitForPort(minioPort, { label: 'minio' });

  await waitForPort(Number(process.env.APPHUB_E2E_CORE_PORT ?? '4400'), { label: 'core-api' }).catch(async (error) => {
    // On failure, collect logs before propagating to help debugging.
    const logs = await collectComposeLogs({ composeFile, project, env: environment }).catch(() => '');
    if (logs) {
      error.message += `\n--- docker compose logs ---\n${logs}`;
    }
    throw error;
  });

  return {
    project,
    composeFile,
    environment,
    stop: async () => {
      await runDockerCompose(['down', '--volumes', '--remove-orphans'], {
        composeFile,
        project,
        env: environment
      });
    },
    collectLogs: async () => collectComposeLogs({ composeFile, project, env: environment })
  };
}

async function collectComposeLogs(params: {
  composeFile: string;
  project: string;
  env: ComposeEnvironment;
}): Promise<string> {
  const { stdout } = await runDockerCompose(['logs', '--no-color'], params);
  return stdout;
}
