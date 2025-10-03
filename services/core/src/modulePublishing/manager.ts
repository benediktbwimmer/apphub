import path from 'node:path';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { emitApphubEvent } from '../events';
import {
  clearStatus,
  getStatus,
  listStatuses,
  recordCompletion,
  recordFailure,
  recordProgress,
  type ModulePublishStatus
} from './statusStore';
import type { ModulePublishStage } from './types';

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

export type PublishModuleOptions = {
  moduleId: string;
  workspacePath: string;
  workspaceName?: string | null;
  registerJobs?: boolean;
  skipBuild?: boolean;
  jobId?: string | null;
};

function emitProgressEvent(status: ModulePublishStatus): void {
  emitApphubEvent({ type: 'module.publish.progress', data: status });
}

function buildCommandArgs(options: PublishModuleOptions): string[] {
  const args = ['run', 'module:publish', '--', '--module', options.workspacePath];
  if (options.workspaceName) {
    args.push('--workspace', options.workspaceName);
  }
  if (options.skipBuild) {
    args.push('--skip-build');
  }
  if (options.registerJobs !== false) {
    args.push('--register-jobs');
  }
  return args;
}

async function runPublishProcess(child: ReturnType<typeof spawn>): Promise<{ exitCode: number; logs: string }> {
  return new Promise((resolve, reject) => {
    let logBuffer = '';
    const append = (chunk: Buffer) => {
      logBuffer += chunk.toString();
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      (error as Error & { logs?: string }).logs = logBuffer;
      reject(error);
    });
    child.on('close', (code) => {
      resolve({ exitCode: typeof code === 'number' ? code : 0, logs: logBuffer });
    });
  });
}

export async function publishModule(options: PublishModuleOptions): Promise<ModulePublishStatus> {
  const moduleId = options.moduleId.trim();
  if (!moduleId) {
    throw new Error('moduleId is required to publish a module');
  }

  const workspacePath = path.isAbsolute(options.workspacePath)
    ? options.workspacePath
    : path.resolve(repoRoot, options.workspacePath);

  const baseProgress = await recordProgress(moduleId, 'queued', {
    workspacePath,
    workspaceName: options.workspaceName ?? null,
    jobId: options.jobId ?? null,
    message: 'Module publish queued'
  });
  emitProgressEvent(baseProgress);

  const runningStatus = await recordProgress(moduleId, 'publishing', {
    workspacePath,
    workspaceName: options.workspaceName ?? null,
    jobId: options.jobId ?? null,
    message: 'Running npm run module:publish'
  });
  emitProgressEvent(runningStatus);

  const commandArgs = buildCommandArgs({
    ...options,
    workspacePath
  });

  const child = spawn('npm', commandArgs, {
    cwd: repoRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  let exitCode: number;
  try {
    const result = await runPublishProcess(child);
    exitCode = result.exitCode;
    logs = result.logs;
  } catch (err) {
    const error = err as Error & { logs?: string };
    logs = error.logs ?? logs;
    const failure = await recordFailure(moduleId, error.message, {
      workspacePath,
      workspaceName: options.workspaceName ?? null,
      jobId: options.jobId ?? null,
      logs
    });
    emitProgressEvent(failure);
    throw error;
  }

  if (exitCode !== 0) {
    const message = `module:publish exited with code ${exitCode}`;
    const failure = await recordFailure(moduleId, message, {
      workspacePath,
      workspaceName: options.workspaceName ?? null,
      jobId: options.jobId ?? null,
      logs
    });
    emitProgressEvent(failure);
    throw new Error(message);
  }

  const success = await recordCompletion(moduleId, {
    workspacePath,
    workspaceName: options.workspaceName ?? null,
    jobId: options.jobId ?? null,
    message: 'Module publish completed',
    logs
  });
  emitProgressEvent(success);
  return success;
}

export async function resetModuleStatus(moduleId: string): Promise<void> {
  await clearStatus(moduleId);
}

export async function getModulePublishStatus(moduleId: string): Promise<ModulePublishStatus | null> {
  return getStatus(moduleId);
}

export async function listModulePublishStatuses(): Promise<ModulePublishStatus[]> {
  return listStatuses();
}

export function stageFromStatus(status: ModulePublishStatus): ModulePublishStage {
  return status.stage;
}
