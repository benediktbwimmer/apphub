import { spawn } from 'node:child_process';

export type DockerResult = { exitCode: number | null; stdout: string; stderr: string };

export const DEFAULT_LAUNCH_INTERNAL_PORT = 3000;

function parsePortValue(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function parseEnvPort(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  return parsePortValue(value);
}

export function runDockerCommand(args: string[]): Promise<DockerResult> {
  return new Promise((resolve) => {
    const child = spawn('docker', args, { env: process.env });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });

    child.on('error', (err) => {
      const message = (err as Error).message ?? 'process error';
      resolve({ exitCode: null, stdout, stderr: `${stderr}\n${message}` });
    });
  });
}

function extractPortFromExposedPorts(data: unknown): number | null {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const entries = Object.keys(data as Record<string, unknown>);
  if (entries.length === 0) {
    return null;
  }

  const numericPorts = entries
    .map((key) => {
      const match = key.match(/^(\d+)(?:\/|$)/);
      return match?.[1] ? parsePortValue(match[1]) : null;
    })
    .filter((value): value is number => value !== null);

  if (numericPorts.length === 0) {
    return null;
  }

  return Math.min(...numericPorts);
}

async function detectImageExposedPort(imageTag: string): Promise<number | null> {
  const inspect = await runDockerCommand(['image', 'inspect', '--format', '{{json .Config.ExposedPorts}}', imageTag]);
  if (inspect.exitCode !== 0) {
    return null;
  }

  const output = inspect.stdout.trim();
  if (!output || output === 'null') {
    return null;
  }

  try {
    const parsed = JSON.parse(output) as unknown;
    return extractPortFromExposedPorts(parsed);
  } catch {
    return null;
  }
}

export async function resolveLaunchInternalPort(imageTag: string): Promise<number> {
  const override = parseEnvPort(process.env.LAUNCH_INTERNAL_PORT);
  if (override) {
    return override;
  }

  const detected = await detectImageExposedPort(imageTag);
  if (detected) {
    return detected;
  }

  return DEFAULT_LAUNCH_INTERNAL_PORT;
}
