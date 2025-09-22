import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import type {
  JobDefinitionRecord,
  JobRunRecord,
  JsonValue,
  SecretReference
} from '../../db/types';
import type { JobResult } from '../runtime';
import type { AcquiredBundle } from '../bundleCache';
import type { SandboxChildMessage, SandboxParentMessage } from './messages';

const DEFAULT_MAX_SANDBOX_LOGS = Number(process.env.APPHUB_JOB_BUNDLE_SANDBOX_MAX_LOGS ?? 200);

export class SandboxTimeoutError extends Error {
  readonly elapsedMs: number;
  constructor(message: string, elapsedMs: number) {
    super(message);
    this.name = 'SandboxTimeoutError';
    this.elapsedMs = elapsedMs;
  }
}

export class SandboxCrashError extends Error {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  constructor(message: string, code: number | null, signal: NodeJS.Signals | null) {
    super(message);
    this.name = 'SandboxCrashError';
    this.code = code;
    this.signal = signal;
  }
}

export type SandboxLogEntry = {
  level: 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
};

export type SandboxExecutionResult = {
  taskId: string;
  result: JobResult;
  durationMs: number;
  resourceUsage?: NodeJS.ResourceUsage;
  logs: SandboxLogEntry[];
  truncatedLogCount: number;
};

export type SandboxExecutionOptions = {
  bundle: AcquiredBundle;
  jobDefinition: JobDefinitionRecord;
  run: JobRunRecord;
  parameters: JsonValue;
  timeoutMs?: number | null;
  exportName?: string | null;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: {
    parameters?: JsonValue;
    logsUrl?: string | null;
    metrics?: JsonValue | null;
    context?: JsonValue | null;
    timeoutMs?: number | null;
  }) => Promise<JobRunRecord>;
  resolveSecret: (reference: SecretReference) => string | null | Promise<string | null>;
};

function sanitizeForIpc<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (err) {
    throw new Error(
      `Failed to serialize sandbox payload: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function buildChildScriptPath(): string {
  const compiled = path.resolve(__dirname, 'childRunner.js');
  if (existsSync(compiled)) {
    return compiled;
  }
  const source = path.resolve(__dirname, 'childRunner.ts');
  return source;
}

function pipeStream(
  child: ChildProcess,
  record: (entry: SandboxLogEntry) => void,
  logger: SandboxExecutionOptions['logger']
): void {
  if (child.stdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (!message) {
        return;
      }
      logger('Sandbox stdout', { message });
      record({ level: 'info', message: `stdout: ${message}` });
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim();
      if (!message) {
        return;
      }
      logger('Sandbox stderr', { message });
      record({ level: 'error', message: `stderr: ${message}` });
    });
  }
}

export class SandboxRunner {
  constructor(private readonly maxLogs = Math.max(1, DEFAULT_MAX_SANDBOX_LOGS)) {}

  async execute(options: SandboxExecutionOptions): Promise<SandboxExecutionResult> {
    const taskId = randomUUID();
    const hostRootPrefix = process.env.APPHUB_HOST_ROOT ?? process.env.HOST_ROOT_PATH ?? null;
    const bundleCapabilities = Array.isArray(options.bundle.manifest.capabilities)
      ? options.bundle.manifest.capabilities
      : [];
    const shouldPrefixHostPaths = Boolean(hostRootPrefix && bundleCapabilities.includes('fs'));
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      APPHUB_SANDBOX_TASK_ID: taskId
    };
    if (shouldPrefixHostPaths && hostRootPrefix) {
      childEnv.APPHUB_SANDBOX_HOST_ROOT_PREFIX = hostRootPrefix;
    }
    const child = fork(buildChildScriptPath(), [], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: childEnv,
      execArgv: process.execArgv
    });

    const logs: SandboxLogEntry[] = [];
    let truncatedLogs = 0;

    const recordLog = (entry: SandboxLogEntry) => {
      if (logs.length < this.maxLogs) {
        logs.push(entry);
      } else {
        truncatedLogs += 1;
      }
    };

    pipeStream(child, recordLog, options.logger);

    const terminateChild = (force: boolean) => {
      if (child.killed) {
        return;
      }
      try {
        child.disconnect();
      } catch {
        // ignore disconnect failures
      }
      try {
        if (force) {
          child.kill('SIGKILL');
          return;
        }
        const graceful = child.kill('SIGTERM');
        if (!graceful) {
          child.kill('SIGKILL');
          return;
        }
        const watchdog = setTimeout(() => {
          if (!child.killed) {
            try {
              child.kill('SIGKILL');
            } catch {
              // ignore forced kill errors
            }
          }
        }, 1000);
        if (typeof watchdog.unref === 'function') {
          watchdog.unref();
        }
      } catch {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore forced kill errors
          }
        }
      }
    };

    let timeoutHandle: NodeJS.Timeout | null = null;
    let timedOut = false;
    const startedAt = Date.now();

    const effectiveTimeout = options.timeoutMs ?? null;
    if (effectiveTimeout && effectiveTimeout > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        options.logger('Sandbox execution timed out', { taskId, timeoutMs: effectiveTimeout });
        child.kill('SIGKILL');
      }, effectiveTimeout);
    }

    const outcome = await new Promise<SandboxExecutionResult>((resolve, reject) => {
      let settled = false;

      const cleanup = (forceKill: boolean) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        terminateChild(forceKill);
        child.removeAllListeners('message');
        child.removeAllListeners('exit');
        child.removeAllListeners('error');
        if (child.stdout) child.stdout.removeAllListeners('data');
        if (child.stderr) child.stderr.removeAllListeners('data');
      };

      const resolveOutcome = (value: SandboxExecutionResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup(false);
        resolve(value);
      };

      const rejectOutcome = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup(true);
        reject(error);
      };

      child.on('error', (err) => {
        options.logger('Sandbox process error', { taskId, error: err.message });
        rejectOutcome(err);
      });

      child.on('exit', (code, signal) => {
        if (settled) {
          return;
        }
        if (timedOut) {
          const elapsed = Date.now() - startedAt;
          rejectOutcome(new SandboxTimeoutError('Sandbox execution exceeded timeout', elapsed));
          return;
        }
        if (code === 0) {
          // result should have already resolved via message handler
          return;
        }
        const err = new SandboxCrashError(
          `Sandbox process exited unexpectedly with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
          code,
          signal
        );
        rejectOutcome(err);
      });

      const sendMessage = (message: SandboxParentMessage) => {
        child.send(message);
      };

      const handleChildMessage = (raw: SandboxChildMessage) => {
        if (settled) {
          return;
        }
        switch (raw.type) {
          case 'log': {
            const entry: SandboxLogEntry = {
              level: raw.level,
              message: raw.message,
              meta: raw.meta
            };
            options.logger('Sandbox log message', {
              taskId,
              level: raw.level,
              message: raw.message,
              meta: raw.meta
            });
            recordLog(entry);
            break;
          }
          case 'update-request': {
            void options
              .update(raw.updates)
              .then((run) => {
                sendMessage({
                  type: 'update-response',
                  requestId: raw.requestId,
                  ok: true,
                  run: sanitizeForIpc(run)
                });
              })
              .catch((err) => {
                sendMessage({
                  type: 'update-response',
                  requestId: raw.requestId,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err)
                });
              });
            break;
          }
          case 'resolve-secret-request': {
            Promise.resolve()
              .then(() => options.resolveSecret(raw.reference))
              .then((value) => {
                sendMessage({
                  type: 'resolve-secret-response',
                  requestId: raw.requestId,
                  ok: true,
                  value: value ?? null
                });
              })
              .catch((err) => {
                sendMessage({
                  type: 'resolve-secret-response',
                  requestId: raw.requestId,
                  ok: false,
                  error: err instanceof Error ? err.message : String(err)
                });
              });
            break;
          }
          case 'result': {
            const jobResult = raw.result ?? {};
            const durationMs = raw.durationMs ?? Date.now() - startedAt;
            const resourceUsage = raw.resourceUsage;
            const output: SandboxExecutionResult = {
              taskId,
              result: jobResult,
              durationMs,
              resourceUsage,
              logs: logs.slice(0, this.maxLogs),
              truncatedLogCount: truncatedLogs
            };
            resolveOutcome(output);
            break;
          }
          case 'error': {
            const err = new Error(raw.error.message);
            if (raw.error.stack) {
              err.stack = raw.error.stack;
            }
            options.logger('Sandbox reported error', {
              taskId,
              message: err.message
            });
            rejectOutcome(err);
            break;
          }
          default:
            break;
        }
      };

      child.on('message', handleChildMessage);

      const startPayload: SandboxParentMessage = {
        type: 'start',
        payload: {
          taskId,
          bundle: {
            slug: options.bundle.slug,
            version: options.bundle.version,
            checksum: options.bundle.checksum,
            directory: options.bundle.directory,
            entryFile: options.bundle.entryFile,
            manifest: options.bundle.manifest,
            exportName: options.exportName ?? null
          },
          job: {
            definition: sanitizeForIpc(options.jobDefinition),
            run: sanitizeForIpc(options.run),
            parameters: sanitizeForIpc(options.parameters ?? null),
            timeoutMs: options.timeoutMs ?? null
          }
        }
      };

      try {
        sendMessage(startPayload);
      } catch (err) {
        rejectOutcome(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return outcome;
  }
}

export const sandboxRunner = new SandboxRunner();
