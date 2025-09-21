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
import { bundleCache } from './bundleCache';
import {
  sandboxRunner,
  SandboxTimeoutError,
  SandboxCrashError,
  type SandboxExecutionResult
} from './sandbox/runner';

const handlers = new Map<string, JobHandler>();

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

const BUNDLE_ENTRY_REGEX = /^bundle:([a-z0-9][a-z0-9._-]*)@([^#]+?)(?:#([a-zA-Z_$][\w$]*))?$/i;

type BundleBinding = {
  slug: string;
  version: string;
  exportName?: string | null;
};

function parseBundleEntryPoint(entryPoint: string | null | undefined): BundleBinding | null {
  if (!entryPoint || typeof entryPoint !== 'string') {
    return null;
  }
  const trimmed = entryPoint.trim();
  const matches = BUNDLE_ENTRY_REGEX.exec(trimmed);
  if (!matches) {
    return null;
  }
  const [, rawSlug, rawVersion, rawExport] = matches;
  const slug = rawSlug.toLowerCase();
  const version = rawVersion.trim();
  if (!version) {
    return null;
  }
  return {
    slug,
    version,
    exportName: rawExport ?? null
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
  const bundleBinding = staticHandler ? null : parseBundleEntryPoint(definition.entryPoint);

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

  const context: JobRunContext = {
    definition,
    run: latestRun,
    parameters: latestRun.parameters,
    async update(updates) {
      const updated = await updateJobRun(runId, updates);
      if (updated) {
        currentRun = updated;
        latestRun = updated;
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
    let handlerResult: JobResult | void;
    if (staticHandler) {
      handlerResult = await staticHandler(context);
    } else {
      const dynamic = await executeDynamicHandler({
        binding: bundleBinding!,
        context,
        definition,
        run: latestRun
      });
      sandboxTelemetry = dynamic.telemetry;
      handlerResult = dynamic.result;
    }

    const finalResult: JobResult = (handlerResult ?? {}) as JobResult;
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
        errorContext.sandboxLogs = sandboxTelemetry.logs;
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
  context.logger('Resolving job bundle', {
    bundleSlug: binding.slug,
    bundleVersion: binding.version
  });

  const record = await getJobBundleVersion(binding.slug, binding.version);
  if (!record) {
    throw new Error(`Job bundle ${binding.slug}@${binding.version} not found`);
  }

  const acquired = await bundleCache.acquire(record);
  context.logger('Acquired job bundle', {
    bundleSlug: binding.slug,
    bundleVersion: binding.version,
    checksum: record.checksum,
    cacheDirectory: acquired.directory
  });

  try {
    const timeoutMs = run.timeoutMs ?? definition.timeoutMs ?? null;
    const telemetry = await sandboxRunner.execute({
      bundle: acquired,
      jobDefinition: definition,
      run,
      parameters: context.parameters,
      timeoutMs,
      exportName: binding.exportName ?? null,
      logger: (message, meta) =>
        context.logger(message, {
          ...(meta ?? {}),
          bundleSlug: binding.slug,
          bundleVersion: binding.version
        }),
      update: context.update,
      resolveSecret: context.resolveSecret
    });

    context.logger('Sandbox execution finished', {
      bundleSlug: binding.slug,
      bundleVersion: binding.version,
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
  const logs = telemetry.logs.map((entry) => ({
    level: entry.level,
    message: entry.message,
    meta: entry.meta ?? null
  }));
  return {
    sandbox: {
      taskId: telemetry.taskId,
      logs,
      truncatedLogCount: telemetry.truncatedLogCount
    }
  } satisfies Record<string, JsonValue>;
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
  return {
    userCpuMicros: usage.userCPUTime,
    systemCpuMicros: usage.systemCPUTime,
    maxRssKb: usage.maxRSS,
    sharedMemoryKb: usage.sharedMemorySize,
    unsharedDataKb: usage.unsharedDataSize,
    unsharedStackKb: usage.unsharedStackSize,
    minorPageFaults: usage.minorPageFault,
    majorPageFaults: usage.majorPageFault,
    ipcMessagesSent: usage.ipcMessagesSent,
    ipcMessagesReceived: usage.ipcMessagesReceived,
    signals: usage.signalsCount,
    voluntaryContextSwitches: usage.voluntaryContextSwitches,
    involuntaryContextSwitches: usage.involuntaryContextSwitches
  } satisfies Record<string, JsonValue>;
}
