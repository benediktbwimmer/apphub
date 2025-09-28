import {
  completeJobRun,
  createJobRun,
  getJobDefinitionById,
  getJobDefinitionBySlug,
  getJobRunById,
  startJobRun,
  updateJobRun
} from '../db/jobs';
import { getJobBundleVersion } from '../db/jobBundles';
import {
  type JobDefinitionRecord,
  type JobRunCompletionInput,
  type JobRunCreateInput,
  type JobRunRecord,
  type JobRunStatus,
  type JsonValue,
  type SecretReference
} from '../db/types';
import { resolveSecret } from '../secrets';
import { logger } from '../observability/logger';
import { normalizeMeta } from '../observability/meta';
import { bundleCache, type AcquiredBundle } from './bundleCache';
import {
  sandboxRunner,
  SandboxTimeoutError,
  SandboxCrashError,
  type SandboxExecutionResult
} from './sandbox/runner';
import { pythonSandboxRunner } from './sandbox/pythonRunner';
import { shouldAllowLegacyFallback, shouldUseJobBundle } from '../config/jobBundles';
import { attemptBundleRecovery, type BundleBinding } from './bundleRecovery';
import { parseBundleEntryPoint } from './bundleBinding';

const handlers = new Map<string, JobHandler>();

export const WORKFLOW_BUNDLE_CONTEXT_KEY = '__workflowBundle';

type BundleResolutionReason = 'not-found' | 'acquire-failed';

class BundleResolutionError extends Error {
  readonly reason: BundleResolutionReason;
  readonly details?: unknown;

  constructor(message: string, reason: BundleResolutionReason, details?: unknown) {
    super(message);
    this.name = 'BundleResolutionError';
    this.reason = reason;
    this.details = details;
  }
}

function isBundleResolutionError(err: unknown): err is BundleResolutionError {
  return err instanceof BundleResolutionError;
}

export type JobRunContext = {
  definition: JobDefinitionRecord;
  run: JobRunRecord;
  parameters: JsonValue;
  update(updates: {
    parameters?: JsonValue;
    logsUrl?: string | null;
    metrics?: JsonValue | null;
    context?: JsonValue | null;
    timeoutMs?: number | null;
  }): Promise<JobRunRecord>;
  heartbeat(): Promise<JobRunRecord>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  resolveSecret(reference: SecretReference): string | null;
};

export type JobResult = {
  status?: Extract<JobRunStatus, 'succeeded' | 'failed' | 'canceled' | 'expired'>;
  result?: JsonValue | null;
  errorMessage?: string | null;
  logsUrl?: string | null;
  metrics?: JsonValue | null;
  context?: JsonValue | null;
};

export type JobHandler = (context: JobRunContext) => Promise<JobResult | void> | JobResult | void;

function log(slug: string, message: string, meta?: Record<string, unknown>) {
  const payload = normalizeMeta({ jobSlug: slug, ...(meta ?? {}) }) ?? { jobSlug: slug };
  logger.info(message, payload);
}

export function registerJobHandler(slug: string, handler: JobHandler): void {
  handlers.set(slug, handler);
}

export function getJobHandler(slug: string): JobHandler | undefined {
  return handlers.get(slug);
}

export async function ensureJobDefinitionExists(slug: string): Promise<JobDefinitionRecord> {
  const definition = await getJobDefinitionBySlug(slug);
  if (!definition) {
    throw new Error(`Job definition not found for slug ${slug}`);
  }
  return definition;
}

export async function createJobRunForSlug(
  slug: string,
  input: JobRunCreateInput = {}
): Promise<JobRunRecord> {
  const definition = await ensureJobDefinitionExists(slug);
  return createJobRun(definition.id, input);
}

function resolveBundleBinding(definition: JobDefinitionRecord): BundleBinding | null {
  if (definition.runtime !== 'node' && definition.runtime !== 'python') {
    return null;
  }
  return parseBundleEntryPoint(definition.entryPoint);
}

function parseWorkflowBundleOverride(contextValue: JsonValue | null): BundleBinding | null {
  if (!contextValue || typeof contextValue !== 'object' || Array.isArray(contextValue)) {
    return null;
  }
  const record = contextValue as Record<string, unknown>;
  const rawBinding = record[WORKFLOW_BUNDLE_CONTEXT_KEY];
  if (!rawBinding || typeof rawBinding !== 'object' || Array.isArray(rawBinding)) {
    return null;
  }
  const bindingRecord = rawBinding as Record<string, unknown>;
  const slugValue = bindingRecord.slug;
  const versionValue = bindingRecord.version;
  const slug = typeof slugValue === 'string' ? slugValue.trim().toLowerCase() : '';
  const version = typeof versionValue === 'string' ? versionValue.trim() : '';
  if (!slug || !version) {
    return null;
  }
  const exportNameValue = bindingRecord.exportName;
  const exportName =
    typeof exportNameValue === 'string' && exportNameValue.trim().length > 0
      ? exportNameValue.trim()
      : null;
  return {
    slug,
    version,
    exportName
  } satisfies BundleBinding;
}

export async function executeJobRun(runId: string): Promise<JobRunRecord | null> {
  let currentRun = await getJobRunById(runId);
  if (!currentRun) {
    return null;
  }
  let latestRun = currentRun;

  const definition = await getJobDefinitionById(currentRun.jobDefinitionId);
  if (!definition) {
    await completeJobRun(runId, 'failed', {
      errorMessage: 'Job definition missing for run'
    });
    return getJobRunById(runId);
  }

  const staticHandler = handlers.get(definition.slug);
  let bundleBinding = resolveBundleBinding(definition);
  const workflowBundleOverride = parseWorkflowBundleOverride(currentRun.context);
  if (workflowBundleOverride) {
    bundleBinding = workflowBundleOverride;
  }

  if (!staticHandler && !bundleBinding) {
    await completeJobRun(runId, 'failed', {
      errorMessage: `No handler registered for job ${definition.slug}`
    });
    return getJobRunById(runId);
  }

  if (currentRun.status === 'pending') {
    const started = await startJobRun(runId, { startedAt: new Date().toISOString() });
    if (started) {
      currentRun = started;
      latestRun = started;
    }
  }

  if (currentRun.status !== 'running') {
    return currentRun;
  }

  const applyLatestRun = (record: JobRunRecord) => {
    currentRun = record;
    latestRun = record;
    return record;
  };

  const context: JobRunContext = {
    definition,
    run: latestRun,
    parameters: latestRun.parameters,
    async update(updates) {
      const heartbeatAt = new Date().toISOString();
      const updated = await updateJobRun(runId, { ...updates, heartbeatAt });
      if (updated) {
        const latest = applyLatestRun(updated);
        context.run = latest;
        context.parameters = latest.parameters;
        return latest;
      }
      context.run = latestRun;
      context.parameters = latestRun.parameters;
      return latestRun;
    },
    async heartbeat() {
      const heartbeatAt = new Date().toISOString();
      const updated = await updateJobRun(runId, { heartbeatAt });
      if (updated) {
        const latest = applyLatestRun(updated);
        context.run = latest;
        context.parameters = latest.parameters;
        return latest;
      }
      context.run = latestRun;
      context.parameters = latestRun.parameters;
      return latestRun;
    },
    logger(message, meta) {
      log(definition.slug, message, meta);
    },
    resolveSecret(reference) {
      const result = resolveSecret(reference, {
        actor: `job-run:${runId}`,
        actorType: 'job',
        metadata: {
          jobSlug: definition.slug,
          jobRunId: runId
        }
      });
      return result.value;
    }
  };

  let sandboxTelemetry: SandboxExecutionResult | null = null;

  try {
    let handlerResult: JobResult | undefined;
    const preferBundle =
      Boolean(bundleBinding) && (!staticHandler || shouldUseJobBundle(definition.slug));
    const allowFallback = Boolean(staticHandler) && shouldAllowLegacyFallback(definition.slug);
    let attemptedBundle = false;

    if (preferBundle && bundleBinding) {
      try {
        attemptedBundle = true;
        const dynamic = await executeDynamicHandler({
          binding: bundleBinding,
          context,
          definition,
          run: latestRun
        });
        sandboxTelemetry = dynamic.telemetry;
        handlerResult = dynamic.result;
      } catch (err) {
        if (allowFallback && isBundleResolutionError(err)) {
          context.logger('Job bundle unavailable, falling back to legacy handler', {
            bundleSlug: bundleBinding.slug,
            bundleVersion: bundleBinding.version,
            reason: err.reason,
            error: err.message
          });
          const fallbackMetricsAddition = {
            bundleFallback: true
          } satisfies Record<string, JsonValue>;
          const fallbackContextAddition = {
            bundleFallback: {
              slug: bundleBinding.slug,
              version: bundleBinding.version,
              reason: err.reason,
              message: err.message
            }
          } satisfies Record<string, JsonValue>;
          await context.update({
            metrics: mergeJsonObjects(context.run.metrics, fallbackMetricsAddition),
            context: mergeJsonObjects(context.run.context, fallbackContextAddition)
          });
        } else {
          throw err;
        }
      }
    }

    if (!handlerResult) {
      if (staticHandler) {
        const maybeResult = await staticHandler(context);
        handlerResult = maybeResult ?? undefined;
      } else if (bundleBinding && !attemptedBundle) {
        attemptedBundle = true;
        const dynamic = await executeDynamicHandler({
          binding: bundleBinding,
          context,
          definition,
          run: latestRun
        });
        sandboxTelemetry = dynamic.telemetry;
        handlerResult = dynamic.result;
      }
    }

    const finalResult: JobResult = handlerResult ?? {};
    const status = finalResult.status ?? 'succeeded';

    let mergedMetrics = finalResult.metrics ?? null;
    let mergedContext = finalResult.context ?? null;

    if (sandboxTelemetry) {
      mergedMetrics = mergeJsonObjects(mergedMetrics, buildSandboxMetrics(sandboxTelemetry));
      mergedContext = mergeJsonObjects(mergedContext, buildSandboxContext(sandboxTelemetry));
    }

    const completion: JobRunCompletionInput = {
      result: finalResult.result ?? null,
      errorMessage: finalResult.errorMessage ?? null,
      logsUrl: finalResult.logsUrl ?? null,
      metrics: mergedMetrics,
      context: mergedContext
    } satisfies JobRunCompletionInput;

    const completed = await completeJobRun(runId, status, completion);
    return completed ?? currentRun;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Job execution failed';
    const errorContext: Record<string, JsonValue> = {
      error: errorMessage
    };
    if (err instanceof Error && err.stack) {
      errorContext.stack = err.stack;
    }

    let status: JobRunStatus = 'failed';

    if (!staticHandler) {
      if (bundleBinding) {
        errorContext.bundle = {
          slug: bundleBinding.slug,
          version: bundleBinding.version,
          exportName: bundleBinding.exportName ?? null
        } satisfies Record<string, JsonValue>;
      }
      if (err instanceof SandboxTimeoutError) {
        status = 'expired';
        errorContext.timeoutMs = err.elapsedMs;
      } else if (err instanceof SandboxCrashError) {
        errorContext.exitCode = err.code ?? null;
        errorContext.signal = err.signal ?? null;
      }
      if (sandboxTelemetry) {
        errorContext.sandboxLogs = sanitizeSandboxLogs(sandboxTelemetry.logs);
        errorContext.sandboxTruncatedLogCount = sandboxTelemetry.truncatedLogCount;
        errorContext.sandboxTaskId = sandboxTelemetry.taskId;
      }
    }

    context.logger('Job handler threw error', {
      error: errorMessage,
      handlerType: staticHandler ? 'static' : 'sandbox',
      errorName: err instanceof Error ? err.name : 'unknown'
    });

    const completed = await completeJobRun(runId, status, {
      errorMessage,
      context: errorContext
    });
    return completed ?? currentRun;
  }
}

type DynamicExecutionOutcome = {
  result: JobResult;
  telemetry: SandboxExecutionResult;
};

type DynamicExecutionParams = {
  binding: BundleBinding;
  context: JobRunContext;
  definition: JobDefinitionRecord;
  run: JobRunRecord;
};

async function executeDynamicHandler(params: DynamicExecutionParams): Promise<DynamicExecutionOutcome> {
  const { binding, context, definition, run } = params;
  let effectiveBinding: BundleBinding = { ...binding };
  context.logger('Resolving job bundle', {
    bundleSlug: effectiveBinding.slug,
    bundleVersion: effectiveBinding.version
  });

  let record = await getJobBundleVersion(effectiveBinding.slug, effectiveBinding.version);
  if (!record) {
    const recovered = await attemptBundleRecovery({
      binding: effectiveBinding,
      definition,
      bundleRecord: null,
      logger: context.logger
    });
    if (!recovered) {
      throw new BundleResolutionError(
        `Job bundle ${binding.slug}@${binding.version} not found`,
        'not-found'
      );
    }
    effectiveBinding = recovered.binding;
    record = recovered.record;
  }

  let acquired: AcquiredBundle;
  try {
    acquired = await bundleCache.acquire(record);
  } catch (err) {
    const recovered = await attemptBundleRecovery({
      binding: effectiveBinding,
      definition,
      bundleRecord: record,
      logger: context.logger
    });
    if (!recovered) {
      throw new BundleResolutionError(
        `Failed to acquire job bundle ${effectiveBinding.slug}@${effectiveBinding.version}`,
        'acquire-failed',
        err instanceof Error ? { message: err.message } : err
      );
    }
    effectiveBinding = recovered.binding;
    record = recovered.record;
    acquired = await bundleCache.acquire(record);
  }
  context.logger('Acquired job bundle', {
    bundleSlug: effectiveBinding.slug,
    bundleVersion: effectiveBinding.version,
    checksum: record.checksum,
    cacheDirectory: acquired.directory
  });

  try {
    const timeoutMs = run.timeoutMs ?? definition.timeoutMs ?? null;
    const runtimeKind = resolveJobRuntime(definition);
    if (runtimeKind === 'docker') {
      throw new Error('Docker runtime execution is not yet available for bundle jobs');
    }
    const runner = runtimeKind === 'python' ? pythonSandboxRunner : sandboxRunner;
    const telemetry = await runner.execute({
      bundle: acquired,
      jobDefinition: definition,
      run,
      parameters: context.parameters,
      timeoutMs,
      exportName: effectiveBinding.exportName ?? null,
      logger: (message, meta) =>
        context.logger(message, {
          ...(meta ?? {}),
          bundleSlug: effectiveBinding.slug,
          bundleVersion: effectiveBinding.version,
          runtime: runtimeKind
        }),
      update: context.update,
      resolveSecret: context.resolveSecret
    });

    context.logger('Sandbox execution finished', {
      bundleSlug: effectiveBinding.slug,
      bundleVersion: effectiveBinding.version,
      runtime: runtimeKind,
      sandboxTaskId: telemetry.taskId,
      durationMs: telemetry.durationMs,
      truncatedLogCount: telemetry.truncatedLogCount
    });

    return {
      result: telemetry.result ?? {},
      telemetry
    } satisfies DynamicExecutionOutcome;
  } finally {
    await acquired.release();
  }
}

function buildSandboxMetrics(telemetry: SandboxExecutionResult): Record<string, JsonValue> {
  const usage = normalizeResourceUsage(telemetry.resourceUsage);
  const sandboxMetrics: Record<string, JsonValue> = {
    taskId: telemetry.taskId,
    durationMs: telemetry.durationMs,
    truncatedLogCount: telemetry.truncatedLogCount
  };
  if (usage) {
    sandboxMetrics.resourceUsage = usage;
  }
  return {
    sandbox: sandboxMetrics
  } satisfies Record<string, JsonValue>;
}

function buildSandboxContext(telemetry: SandboxExecutionResult): Record<string, JsonValue> {
  const logs = sanitizeSandboxLogs(telemetry.logs);
  return {
    sandbox: {
      taskId: telemetry.taskId,
      logs,
      truncatedLogCount: telemetry.truncatedLogCount
    }
  } satisfies Record<string, JsonValue>;
}

function sanitizeSandboxLogs(logs: SandboxExecutionResult['logs']): JsonValue[] {
  return logs.map((entry) => ({
    level: entry.level,
    message: entry.message,
    meta: normalizeMeta(entry.meta ?? undefined) ?? null
  })) as JsonValue[];
}

function mergeJsonObjects(
  base: JsonValue | null | undefined,
  addition: Record<string, JsonValue>
): JsonValue {
  const entries = Object.entries(addition).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return base ?? null;
  }
  const additionObject = Object.fromEntries(entries) as Record<string, JsonValue>;
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return additionObject;
  }
  return {
    ...(base as Record<string, JsonValue>),
    ...additionObject
  } satisfies JsonValue;
}

function normalizeResourceUsage(usage?: NodeJS.ResourceUsage): JsonValue | null {
  if (!usage) {
    return null;
  }
  const extended = usage as NodeJS.ResourceUsage & {
    ipcMessagesSent?: number;
    ipcMessagesReceived?: number;
  };
  const normalized: Record<string, JsonValue> = {
    userCpuMicros: usage.userCPUTime,
    systemCpuMicros: usage.systemCPUTime,
    maxRssKb: usage.maxRSS,
    sharedMemoryKb: usage.sharedMemorySize,
    unsharedDataKb: usage.unsharedDataSize,
    unsharedStackKb: usage.unsharedStackSize,
    minorPageFaults: usage.minorPageFault,
    majorPageFaults: usage.majorPageFault,
    signals: usage.signalsCount,
    voluntaryContextSwitches: usage.voluntaryContextSwitches,
    involuntaryContextSwitches: usage.involuntaryContextSwitches
  };
  if (typeof extended.ipcMessagesSent === 'number') {
    normalized.ipcMessagesSent = extended.ipcMessagesSent;
  }
  if (typeof extended.ipcMessagesReceived === 'number') {
    normalized.ipcMessagesReceived = extended.ipcMessagesReceived;
  }
  return normalized;
}

type JobRuntimeKind = 'node' | 'python' | 'docker';

function resolveJobRuntime(definition: JobDefinitionRecord): JobRuntimeKind {
  if (definition.runtime === 'python') {
    return 'python';
  }
  if (definition.runtime === 'node') {
    return 'node';
  }
  if (definition.runtime === 'docker') {
    return 'docker';
  }
  const metadata = definition.metadata;
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const record = metadata as Record<string, unknown>;
    const rawRuntime = record.runtime;
    if (typeof rawRuntime === 'string') {
      const normalized = rawRuntime.trim().toLowerCase();
      if (normalized.startsWith('python')) {
        return 'python';
      }
      if (normalized.startsWith('docker')) {
        return 'docker';
      }
      if (normalized.startsWith('node')) {
        return 'node';
      }
    } else if (rawRuntime && typeof rawRuntime === 'object' && !Array.isArray(rawRuntime)) {
      const runtimeRecord = rawRuntime as Record<string, unknown>;
      const type = runtimeRecord.type;
      if (typeof type === 'string') {
        const normalized = type.trim().toLowerCase();
        if (normalized.startsWith('python')) {
          return 'python';
        }
        if (normalized.startsWith('docker')) {
          return 'docker';
        }
        if (normalized.startsWith('node')) {
          return 'node';
        }
      }
    }
  }

  return 'node';
}
