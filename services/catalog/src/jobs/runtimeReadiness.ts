import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';

import type { JobRuntime } from '../db/types';
import { logger } from '../observability/logger';
import { resolveNodeSandboxEntrypoint } from './sandbox/runner';
import { resolvePythonHarnessPath } from './sandbox/pythonRunner';
import { isDockerRuntimeEnabled } from '../config/dockerRuntime';

export type RuntimeReadiness = {
  runtime: JobRuntime;
  ready: boolean;
  reason: string | null;
  checkedAt: string;
  details: Record<string, unknown> | null;
};

const READINESS_CACHE_TTL_MS = 60_000;

let readinessCache: { expiresAt: number; result: RuntimeReadiness[] } | null = null;
let readinessInflight: Promise<RuntimeReadiness[]> | null = null;

function cloneStatus(status: RuntimeReadiness): RuntimeReadiness {
  return {
    runtime: status.runtime,
    ready: status.ready,
    reason: status.reason,
    checkedAt: status.checkedAt,
    details: status.details ? { ...status.details } : null
  } satisfies RuntimeReadiness;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function probePythonVersion(): Promise<{ version: string }> {
  return await new Promise<{ version: string }>((resolve, reject) => {
    const child = spawn('python3', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const cleanup = () => {
      try {
        child.removeAllListeners();
      } catch {
        // ignore listener cleanup errors
      }
    };
    const timeout = setTimeout(() => {
      cleanup();
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore forced kill errors
      }
      reject(new Error('python3 readiness check timed out after 5s'));
    }, 5_000);

    const clear = () => {
      clearTimeout(timeout);
      cleanup();
    };

    if (child.stdout) {
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });
    }
    if (child.stderr) {
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
    }

    child.once('error', (err) => {
      clear();
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    child.once('exit', (code, signal) => {
      clear();
      if (code === 0) {
        const text = `${stdout}${stderr}`.trim();
        resolve({ version: text || 'python3' });
        return;
      }
      const reason = signal
        ? `python3 --version terminated with signal ${signal}`
        : `python3 --version exited with code ${code}`;
      const message = stderr.trim() || stdout.trim();
      reject(new Error(message ? `${reason}: ${message}` : reason));
    });
  });
}

async function checkNodeRuntime(): Promise<RuntimeReadiness> {
  const entryPoint = resolveNodeSandboxEntrypoint();
  const exists = existsSync(entryPoint);
  return {
    runtime: 'node',
    ready: exists,
    reason: exists ? null : `Node sandbox entrypoint missing at ${entryPoint}`,
    checkedAt: nowIso(),
    details: { version: process.version }
  } satisfies RuntimeReadiness;
}

async function checkPythonRuntime(): Promise<RuntimeReadiness> {
  const harnessPath = resolvePythonHarnessPath();
  if (!existsSync(harnessPath)) {
    const message = `Python harness not found at ${harnessPath}`;
    logger.warn(message);
    return {
      runtime: 'python',
      ready: false,
      reason: message,
      checkedAt: nowIso(),
      details: null
    } satisfies RuntimeReadiness;
  }

  try {
    const probe = await probePythonVersion();
    return {
      runtime: 'python',
      ready: true,
      reason: null,
      checkedAt: nowIso(),
      details: { executable: 'python3', version: probe.version }
    } satisfies RuntimeReadiness;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('Python runtime readiness check failed', { message });
    return {
      runtime: 'python',
      ready: false,
      reason: message,
      checkedAt: nowIso(),
      details: null
    } satisfies RuntimeReadiness;
  }
}

async function checkDockerRuntime(): Promise<RuntimeReadiness> {
  const enabled = isDockerRuntimeEnabled();
  return {
    runtime: 'docker',
    ready: false,
    reason: enabled
      ? 'Docker job execution is not yet available in this build.'
      : 'Docker job runtime is disabled.',
    checkedAt: nowIso(),
    details: { enabled }
  } satisfies RuntimeReadiness;
}

async function computeRuntimeReadiness(): Promise<RuntimeReadiness[]> {
  const [nodeStatus, pythonStatus, dockerStatus] = await Promise.all([
    checkNodeRuntime(),
    checkPythonRuntime(),
    checkDockerRuntime()
  ]);
  return [nodeStatus, pythonStatus, dockerStatus];
}

export async function getRuntimeReadiness(forceRefresh = false): Promise<RuntimeReadiness[]> {
  const now = Date.now();
  if (!forceRefresh && readinessCache && readinessCache.expiresAt > now) {
    return readinessCache.result.map(cloneStatus);
  }
  if (!forceRefresh && readinessInflight) {
    return readinessInflight.then((result) => result.map(cloneStatus));
  }

  readinessInflight = computeRuntimeReadiness()
    .then((result) => {
      readinessCache = {
        expiresAt: Date.now() + READINESS_CACHE_TTL_MS,
        result: result.map(cloneStatus)
      };
      return readinessCache.result.map(cloneStatus);
    })
    .finally(() => {
      readinessInflight = null;
    });

  return readinessInflight;
}

export function clearRuntimeReadinessCache(): void {
  readinessCache = null;
}
