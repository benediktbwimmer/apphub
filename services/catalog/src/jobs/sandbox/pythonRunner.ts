import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

import type {
  SandboxExecutionOptions,
  SandboxExecutionResult,
  SandboxLogEntry
} from './runner';
import { SandboxCrashError, SandboxExecutionFailure, SandboxTimeoutError } from './runner';
import type { SandboxChildMessage, SandboxParentMessage } from './messages';
import {
  serializeWorkflowEventContext,
  WORKFLOW_EVENT_CONTEXT_ENV
} from '../../workflowEventContext';

const DEFAULT_MAX_SANDBOX_LOGS = Number(process.env.APPHUB_JOB_BUNDLE_SANDBOX_MAX_LOGS ?? 200);

function sanitizeForIpc<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (err) {
    throw new Error(
      `Failed to serialize sandbox payload: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function resolvePythonHarnessPath(): string {
  const local = path.resolve(__dirname, 'pythonChild.py');
  if (existsSync(local)) {
    return local;
  }
  return path.resolve(__dirname, '../../../src/jobs/sandbox/pythonChild.py');
}

function normalizePythonResourceUsage(raw: unknown): NodeJS.ResourceUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const data = raw as Record<string, unknown>;
  const getNumber = (key: string): number | undefined => {
    const value = data[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    return undefined;
  };

  const userSeconds = getNumber('ru_utime');
  const systemSeconds = getNumber('ru_stime');
  const usage: NodeJS.ResourceUsage = {
    userCPUTime: userSeconds !== undefined ? Math.round(userSeconds * 1_000_000) : 0,
    systemCPUTime: systemSeconds !== undefined ? Math.round(systemSeconds * 1_000_000) : 0,
    maxRSS: getNumber('ru_maxrss') ?? 0,
    sharedMemorySize: getNumber('ru_ixrss') ?? 0,
    unsharedDataSize: getNumber('ru_idrss') ?? 0,
    unsharedStackSize: getNumber('ru_isrss') ?? 0,
    minorPageFault: getNumber('ru_minflt') ?? 0,
    majorPageFault: getNumber('ru_majflt') ?? 0,
    signalsCount: getNumber('ru_nsignals') ?? 0,
    voluntaryContextSwitches: getNumber('ru_nvcsw') ?? 0,
    involuntaryContextSwitches: getNumber('ru_nivcsw') ?? 0,
    fsRead: getNumber('ru_inblock') ?? 0,
    fsWrite: getNumber('ru_oublock') ?? 0,
    ipcReceived: getNumber('ru_msgrcv') ?? 0,
    ipcSent: getNumber('ru_msgsnd') ?? 0,
    swappedOut: getNumber('ru_nswap') ?? 0
  } satisfies NodeJS.ResourceUsage;

  return usage;
}

function recordStderr(
  child: ChildProcessWithoutNullStreams,
  record: (entry: SandboxLogEntry) => void,
  logger: SandboxExecutionOptions['logger']
): void {
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    const message = chunk.trim();
    if (!message) {
      return;
    }
    logger('Python sandbox stderr', { message });
    record({ level: 'error', message: `stderr: ${message}` });
  });
}

export class PythonSandboxRunner {
  constructor(private readonly maxLogs = Math.max(1, DEFAULT_MAX_SANDBOX_LOGS)) {}

  async execute(options: SandboxExecutionOptions): Promise<SandboxExecutionResult> {
    const taskId = randomUUID();
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      APPHUB_SANDBOX_TASK_ID: taskId
    };
    if (options.workflowEventContext) {
      childEnv[WORKFLOW_EVENT_CONTEXT_ENV] = serializeWorkflowEventContext(
        options.workflowEventContext
      );
    }

    const harness = resolvePythonHarnessPath();
    const child = spawn('python3', [harness], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv
    }) as ChildProcessWithoutNullStreams;

    const logs: SandboxLogEntry[] = [];
    let truncatedLogs = 0;

    const recordLog = (entry: SandboxLogEntry) => {
      if (logs.length < this.maxLogs) {
        logs.push(entry);
      } else {
        truncatedLogs += 1;
      }
    };

    recordStderr(child, recordLog, options.logger);

    const terminateChild = (force: boolean) => {
      if (child.killed) {
        return;
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

    const sendMessage = (message: SandboxParentMessage) => {
      if (!child.stdin) {
        throw new Error('Python sandbox stdin is not available');
      }
      child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    return await new Promise<SandboxExecutionResult>((resolve, reject) => {
      let settled = false;
      let stdoutBuffer = '';

      const cleanup = (forceKill: boolean) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
        terminateChild(forceKill);
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
        options.logger('Python sandbox process error', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack ?? null : null
        });
        rejectOutcome(err);
      });

      child.on('exit', (code, signal) => {
        if (settled) {
          return;
        }
        if (timedOut) {
          const elapsed = Date.now() - startedAt;
          rejectOutcome(new SandboxTimeoutError('Python sandbox execution exceeded timeout', elapsed));
          return;
        }
        if (code === 0) {
          return;
        }
        const err = new SandboxCrashError(
          `Python sandbox exited unexpectedly with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
          code,
          signal
        );
        rejectOutcome(err);
      });

      const handleChildMessage = (raw: SandboxChildMessage & { resourceUsage?: unknown }) => {
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
            options.logger('Python sandbox log message', {
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
            const resourceUsage = normalizePythonResourceUsage(raw.resourceUsage);
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
            if (raw.error.name) {
              err.name = raw.error.name;
            }
            if (raw.error.stack) {
              err.stack = raw.error.stack;
            }
            if (raw.error.properties) {
              Object.assign(err as unknown as Record<string, unknown>, raw.error.properties);
            }
            options.logger('Python sandbox reported error', {
              taskId,
              message: err.message,
              stack: raw.error.stack ?? null,
              errorName: raw.error.name ?? null,
              properties: raw.error.properties ?? null
            });
            recordLog({
              level: 'error',
              message: raw.error.message,
              meta: {
                taskId,
                stack: raw.error.stack ?? null,
                errorName: raw.error.name ?? null,
                properties: raw.error.properties ?? null
              }
            });
            const failure = new SandboxExecutionFailure(err, {
              taskId,
              logs: logs.slice(0, this.maxLogs),
              truncatedLogCount: truncatedLogs,
              properties: raw.error.properties
            });
            rejectOutcome(failure);
            break;
          }
          default:
            break;
        }
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        let index = stdoutBuffer.indexOf('\n');
        while (index >= 0) {
          const line = stdoutBuffer.slice(0, index).trim();
          stdoutBuffer = stdoutBuffer.slice(index + 1);
          if (line) {
            try {
              const parsed = JSON.parse(line) as SandboxChildMessage & { resourceUsage?: unknown };
              handleChildMessage(parsed);
            } catch (err) {
              options.logger('Failed to parse Python sandbox message', {
                taskId,
                error: err instanceof Error ? err.message : String(err),
                line
              });
              recordLog({ level: 'error', message: `parse-error: ${line}` });
            }
          }
          index = stdoutBuffer.indexOf('\n');
        }
      });

      const effectiveTimeout = options.timeoutMs ?? null;
      if (effectiveTimeout && effectiveTimeout > 0) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          options.logger('Python sandbox execution timed out', { taskId, timeoutMs: effectiveTimeout });
          terminateChild(true);
        }, effectiveTimeout);
      }

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
          },
          workflowEventContext: sanitizeForIpc(options.workflowEventContext ?? null)
        }
      };

      try {
        sendMessage(startPayload);
      } catch (err) {
        rejectOutcome(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

export const pythonSandboxRunner = new PythonSandboxRunner();
