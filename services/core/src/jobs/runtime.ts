import {
  completeJobRun as defaultCompleteJobRun,
  createJobRun,
  getJobDefinitionById as defaultGetJobDefinitionById,
  getJobDefinitionBySlug,
  getJobRunById as defaultGetJobRunById,
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
  type SecretReference,
  type ModuleTargetBinding
} from '../db/types';
import { resolveSecret } from '../secrets';
import { logger } from '../observability/logger';
import { normalizeMeta } from '../observability/meta';
import { bundleCache, type AcquiredBundle } from './bundleCache';
import {
  sandboxRunner,
  SandboxTimeoutError,
  SandboxCrashError,
  SandboxExecutionFailure,
  type SandboxExecutionResult
} from './sandbox/runner';
import { pythonSandboxRunner } from './sandbox/pythonRunner';
import { dockerJobRunner } from './docker/runner';
import { shouldAllowLegacyFallback, shouldUseJobBundle } from '../config/jobBundles';
import { attemptBundleRecovery, type BundleBinding } from './bundleRecovery';
import { parseBundleEntryPoint } from './bundleBinding';
import { safeParseDockerJobMetadata } from './dockerMetadata';
import { isDockerRuntimeEnabled } from '../config/dockerRuntime';
import { resolveJobRuntime, type JobRuntimeKind } from './runtimeKind';
import { mergeJsonObjects, asJsonObject } from './jsonMerge';
import { getWorkflowEventContext, type WorkflowEventContext } from '../workflowEventContext';
import { ModuleRuntimeLoader } from '../moduleRuntime';
import { getModuleTargetRuntimeConfig } from '../db/modules';
import {
  createJobContext,
  type ModuleLogger,
  type ModuleCapabilityOverrides,
  type ModuleTargetDefinition
} from '@apphub/module-sdk';

export { getWorkflowEventContext } from '../workflowEventContext';

const handlers = new Map<string, JobHandler>();
const moduleLoader = new ModuleRuntimeLoader();

export const WORKFLOW_BUNDLE_CONTEXT_KEY = '__workflowBundle';

const jobsDbAdapter = {
  getJobRunById: defaultGetJobRunById,
  getJobDefinitionById: defaultGetJobDefinitionById,
  completeJobRun: defaultCompleteJobRun
};

export function __setJobsDbForTesting(overrides: Partial<typeof jobsDbAdapter>): void {
  Object.assign(jobsDbAdapter, overrides);
}

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

function coerceJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value as JsonValue;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? (value as JsonValue) : undefined;
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const entry of value) {
      const converted = coerceJsonValue(entry);
      if (converted !== undefined) {
        result.push(converted);
      }
    }
    return result;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record);
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of entries) {
      const converted = coerceJsonValue(entryValue);
      if (converted !== undefined) {
        result[key] = converted;
      }
    }
    return result;
  }
  return undefined;
}

function extractErrorProperties(error: unknown): Record<string, JsonValue> | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const properties: Record<string, JsonValue> = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue;
    }
    try {
      const record = error as unknown as Record<string, unknown>;
      const entry = record[key];
      const converted = coerceJsonValue(entry);
      if (converted !== undefined) {
        properties[key] = converted;
      }
    } catch {
      // ignore property access failures
    }
  }
  return Object.keys(properties).length > 0 ? properties : null;
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
  const moduleBinding = input.moduleBinding === undefined ? definition.moduleBinding ?? null : input.moduleBinding;

  let resolvedContext = input.context ?? null;
  if (moduleBinding) {
    const runtimeConfig = await getModuleTargetRuntimeConfig({ binding: moduleBinding });
    if (runtimeConfig) {
      const moduleRuntimeContext = {
        settings: runtimeConfig.settings ?? null,
        secrets: runtimeConfig.secrets ?? null
      } satisfies Record<string, JsonValue>;
      resolvedContext = mergeJsonObjects(resolvedContext, { moduleRuntime: moduleRuntimeContext });
    }
  }

  return createJobRun(definition.id, {
    ...input,
    moduleBinding,
    context: resolvedContext ?? null
  });
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
  let currentRun = await jobsDbAdapter.getJobRunById(runId);
  if (!currentRun) {
    return null;
  }
  let latestRun = currentRun;

  const definition = await jobsDbAdapter.getJobDefinitionById(currentRun.jobDefinitionId);
  if (!definition) {
    await jobsDbAdapter.completeJobRun(runId, 'failed', {
      errorMessage: 'Job definition missing for run'
    });
    return jobsDbAdapter.getJobRunById(runId);
  }

  const staticHandler = handlers.get(definition.slug);
  let bundleBinding = resolveBundleBinding(definition);
  const workflowBundleOverride = parseWorkflowBundleOverride(currentRun.context);
  if (workflowBundleOverride) {
    bundleBinding = workflowBundleOverride;
  }

  const runtimeKind = resolveJobRuntime(definition);
  const workflowEventContext = getWorkflowEventContext();

  if (!staticHandler && !bundleBinding && runtimeKind !== 'docker' && runtimeKind !== 'module') {
    await jobsDbAdapter.completeJobRun(runId, 'failed', {
      errorMessage: `No handler registered for job ${definition.slug}`
    });
    return jobsDbAdapter.getJobRunById(runId);
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
      try {
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
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error('Job run update failed', {
          jobRunId: runId,
          error: message,
          stack: err instanceof Error ? err.stack ?? null : null
        });
        throw err;
      }
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

  if (runtimeKind === 'docker') {
    if (!isDockerRuntimeEnabled()) {
      context.logger('Docker runtime disabled, failing job run', {
        jobRunId: runId,
        jobSlug: definition.slug
      });
      const completed = await jobsDbAdapter.completeJobRun(runId, 'failed', {
        errorMessage: 'Docker runtime is disabled',
        context: {
          docker: {
            enabled: false
          }
        } satisfies Record<string, JsonValue>
      });
      return completed ?? currentRun;
    }

    const metadataValue = definition.metadata ?? {};
    const parsedMetadata = safeParseDockerJobMetadata(metadataValue);
    if (!parsedMetadata.success) {
      const flattened = parsedMetadata.error.flatten();
      context.logger('Docker metadata validation failed', {
        jobRunId: runId,
        formErrors: flattened.formErrors,
        fieldErrors: flattened.fieldErrors
      });
      const validationErrors: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(flattened.fieldErrors)) {
        if (Array.isArray(value) && value.length > 0) {
          validationErrors[key] = [...value];
        }
      }
      const formErrors = [...flattened.formErrors];
      const errorContext = {
        docker: {
          validationErrors,
          formErrors
        }
      } satisfies Record<string, JsonValue>;
      const completed = await jobsDbAdapter.completeJobRun(runId, 'failed', {
        errorMessage: 'Docker job metadata is invalid',
        context: errorContext
      });
      return completed ?? currentRun;
    }

    const timeoutMs = latestRun.timeoutMs ?? definition.timeoutMs ?? null;

    try {
      const execution = await dockerJobRunner.execute({
        definition,
        run: latestRun,
        metadata: parsedMetadata.data.docker,
        parameters: context.parameters,
        timeoutMs,
        logger: context.logger,
        update: context.update,
        resolveSecret: context.resolveSecret,
        workflowEventContext
      });

      const metricsRecord = asJsonObject(execution.jobResult.metrics);
      const contextRecord = asJsonObject(execution.jobResult.context);
      const mergedMetrics = mergeJsonObjects(latestRun.metrics, metricsRecord);
      const mergedContext = mergeJsonObjects(latestRun.context, contextRecord);

      const finalStatus = execution.jobResult.status ?? 'succeeded';
      const completion: JobRunCompletionInput = {
        result: execution.jobResult.result ?? null,
        errorMessage: execution.jobResult.errorMessage ?? null,
        logsUrl: execution.jobResult.logsUrl ?? null,
        metrics: mergedMetrics,
        context: mergedContext,
        durationMs: Math.round(execution.telemetry.durationMs),
        completedAt: execution.telemetry.completedAt
      } satisfies JobRunCompletionInput;

      const completed = await jobsDbAdapter.completeJobRun(runId, finalStatus, completion);
      return completed ?? currentRun;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Docker execution failed';
      const derivedProperties = extractErrorProperties(err);
      context.logger('Docker runner threw error', {
        jobRunId: runId,
        error: message,
        errorName: err instanceof Error ? err.name : 'unknown',
        stack: err instanceof Error ? err.stack ?? null : null,
        ...(derivedProperties ? { errorProperties: derivedProperties } : {})
      });
      const errorContext: Record<string, JsonValue> = {
        docker: {
          error: message
        }
      };
      if (err instanceof Error && typeof err.stack === 'string') {
        errorContext.stack = err.stack;
      }
      if (err instanceof Error && typeof err.name === 'string' && err.name.length > 0) {
        errorContext.errorName = err.name;
      }
      if (derivedProperties) {
        errorContext.properties = derivedProperties;
      }
      const completed = await jobsDbAdapter.completeJobRun(runId, 'failed', {
        errorMessage: message,
        context: errorContext
      });
      return completed ?? currentRun;
    }
  }

  let sandboxTelemetry: SandboxExecutionResult | null = null;

  try {
    let handlerResult: JobResult | undefined;
    if (runtimeKind === 'module') {
      const binding = resolveModuleBinding(latestRun, definition);
      if (!binding) {
        throw new Error(`Module binding missing for job ${definition.slug}`);
      }
      handlerResult = await executeModuleJob({
        binding,
        context,
        definition,
        run: latestRun
      });
    } else {
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
            run: latestRun,
            workflowEventContext
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
            run: latestRun,
            workflowEventContext
          });
          sandboxTelemetry = dynamic.telemetry;
          handlerResult = dynamic.result;
        }
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

    const completed = await jobsDbAdapter.completeJobRun(runId, status, completion);
    return completed ?? currentRun;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Job execution failed';
    const sandboxFailure = err instanceof SandboxExecutionFailure ? err : null;
    const errorName = err instanceof Error && typeof err.name === 'string' && err.name.length > 0 ? err.name : 'unknown';

    const errorContext: Record<string, JsonValue> = {
      error: errorMessage,
      errorName
    };
    if (err instanceof Error && err.stack) {
      errorContext.stack = err.stack;
    }

    const combinedProperties: Record<string, JsonValue> = {};
    if (sandboxFailure?.properties) {
      Object.assign(combinedProperties, sandboxFailure.properties);
    }
    const derivedProperties = extractErrorProperties(err);
    if (derivedProperties) {
      Object.assign(combinedProperties, derivedProperties);
    }
    if (Object.keys(combinedProperties).length > 0) {
      errorContext.properties = combinedProperties;
    }

    let failureReason: string | null = null;
    const propertyCode = combinedProperties.code;
    if (typeof propertyCode === 'string' && propertyCode.trim().length > 0) {
      failureReason = propertyCode.trim();
    }

    if (failureReason === 'asset_missing') {
      const metadataValue = combinedProperties.metadata;
      const recoveryPayload: Record<string, JsonValue> = {
        code: 'asset_missing'
      };

      if (metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)) {
        const metadataRecord = metadataValue as Record<string, JsonValue>;

        const assetId = metadataRecord.assetId;
        if (typeof assetId === 'string' && assetId.trim().length > 0) {
          recoveryPayload.assetId = assetId.trim();
        }

        const partitionKey = metadataRecord.partitionKey;
        if (typeof partitionKey === 'string' && partitionKey.trim().length > 0) {
          recoveryPayload.partitionKey = partitionKey.trim();
        }

        const resourceValue = metadataRecord.resource;
        if (typeof resourceValue === 'string' && resourceValue.trim().length > 0) {
          recoveryPayload.resource = resourceValue.trim();
        }

        const capabilityValue = metadataRecord.capability;
        if (typeof capabilityValue === 'string' && capabilityValue.trim().length > 0) {
          recoveryPayload.capability = capabilityValue.trim();
        }

        recoveryPayload.metadata = metadataRecord;
      }

      errorContext.assetRecovery = recoveryPayload;
    }

    let status: JobRunStatus = 'failed';

    const encounteredSandboxError =
      !staticHandler ||
      sandboxFailure !== null ||
      err instanceof SandboxTimeoutError ||
      err instanceof SandboxCrashError;

    if (encounteredSandboxError && bundleBinding) {
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

    if (sandboxFailure) {
      errorContext.sandboxLogs = sanitizeSandboxLogs(sandboxFailure.logs);
      errorContext.sandboxTruncatedLogCount = sandboxFailure.truncatedLogCount;
      errorContext.sandboxTaskId = sandboxFailure.taskId;
    } else if (sandboxTelemetry) {
      errorContext.sandboxLogs = sanitizeSandboxLogs(sandboxTelemetry.logs);
      errorContext.sandboxTruncatedLogCount = sandboxTelemetry.truncatedLogCount;
      errorContext.sandboxTaskId = sandboxTelemetry.taskId;
    }

    const logMeta: Record<string, unknown> = {
      error: errorMessage,
      handlerType: staticHandler ? 'static' : 'sandbox',
      errorName,
      stack: err instanceof Error ? err.stack ?? null : null
    };
    if (sandboxFailure) {
      logMeta.sandboxTaskId = sandboxFailure.taskId;
      logMeta.sandboxTruncatedLogCount = sandboxFailure.truncatedLogCount;
    } else if (sandboxTelemetry) {
      logMeta.sandboxTaskId = sandboxTelemetry.taskId;
      logMeta.sandboxTruncatedLogCount = sandboxTelemetry.truncatedLogCount;
    }
    if (Object.keys(combinedProperties).length > 0) {
      logMeta.errorProperties = combinedProperties;
    }

    context.logger('Job handler threw error', logMeta);

    const completionPayload: JobRunCompletionInput = {
      errorMessage,
      context: errorContext
    };

    if (failureReason) {
      completionPayload.failureReason = failureReason;
    }

    const completed = await jobsDbAdapter.completeJobRun(runId, status, completionPayload);
    return completed ?? currentRun;
  }
}

type ModuleExecutionParams = {
  binding: ModuleTargetBinding;
  context: JobRunContext;
  definition: JobDefinitionRecord;
  run: JobRunRecord;
};

function resolveModuleBinding(run: JobRunRecord, definition: JobDefinitionRecord): ModuleTargetBinding | null {
  return run.moduleBinding ?? definition.moduleBinding ?? null;
}

type ModuleRuntimeInputs = {
  settings?: unknown;
  secrets?: unknown;
};

function extractModuleRuntimeValues(value: JsonValue | null | undefined): ModuleRuntimeInputs | null {
  const object = asJsonObject(value);
  if (!object) {
    return null;
  }

  const moduleNode = object.module ?? object.moduleRuntime ?? object.moduleContext;
  if (moduleNode && typeof moduleNode === 'object' && !Array.isArray(moduleNode)) {
    const moduleRecord = moduleNode as Record<string, JsonValue>;
    const settings = moduleRecord.settings as unknown;
    const secrets = moduleRecord.secrets as unknown;
    if (settings !== undefined || secrets !== undefined) {
      return { settings, secrets };
    }
  }

  if (object.moduleSettings !== undefined || object.moduleSecrets !== undefined) {
    return {
      settings: object.moduleSettings as unknown,
      secrets: object.moduleSecrets as unknown
    };
  }

  return null;
}

function resolveModuleRuntimeInputs(
  definition: JobDefinitionRecord,
  run: JobRunRecord
): ModuleRuntimeInputs {
  return (
    extractModuleRuntimeValues(run.context) ??
    extractModuleRuntimeValues(definition.metadata) ??
    {}
  );
}

function createModuleJobLogger(
  context: JobRunContext,
  info: {
    moduleId: string;
    moduleVersion: string;
    targetName: string;
    targetVersion: string;
    jobSlug: string;
  }
): ModuleLogger {
  const emit = (level: string, message: string, meta?: Record<string, unknown>) => {
    context.logger(message, {
      level,
      module: info,
      ...(meta ?? {})
    });
  };
  return {
    debug(message, meta) {
      emit('debug', message, meta as Record<string, unknown> | undefined);
    },
    info(message, meta) {
      emit('info', message, meta as Record<string, unknown> | undefined);
    },
    warn(message, meta) {
      emit('warn', message, meta as Record<string, unknown> | undefined);
    },
    error(message, meta) {
      if (message instanceof Error) {
        const errorMeta: Record<string, unknown> = {
          errorName: message.name,
          stack: message.stack,
          ...(meta ?? {})
        };
        emit('error', message.message, errorMeta);
      } else {
        emit('error', message, meta as Record<string, unknown> | undefined);
      }
    }
  } satisfies ModuleLogger;
}

async function executeModuleJob(params: ModuleExecutionParams): Promise<JobResult> {
  const { binding, context } = params;
  const loaded = await moduleLoader.getTarget(binding);
  if (loaded.target.kind !== 'job') {
    throw new Error(
      `Module target ${binding.targetName}@${binding.targetVersion} is not a job handler`
    );
  }

  const jobTarget = loaded.target as ModuleTargetDefinition<unknown, unknown> & {
    handler: (...args: unknown[]) => unknown;
  };

  const moduleDefinition = loaded.module.definition;
  const moduleRuntimeInputs = resolveModuleRuntimeInputs(params.definition, params.run);
  const capabilityOverrides: ModuleCapabilityOverrides[] | undefined = jobTarget.capabilityOverrides
    ? [jobTarget.capabilityOverrides]
    : undefined;

  const moduleLogger = createModuleJobLogger(context, {
    moduleId: binding.moduleId,
    moduleVersion: binding.moduleVersion,
    targetName: jobTarget.name,
    targetVersion: jobTarget.version ?? binding.targetVersion,
    jobSlug: params.definition.slug
  });

  const moduleContext = createJobContext({
    module: moduleDefinition.metadata,
    job: {
      name: jobTarget.name,
      version: jobTarget.version ?? binding.targetVersion
    },
    settingsDescriptor: moduleDefinition.settings,
    secretsDescriptor: moduleDefinition.secrets,
    capabilityConfig: moduleDefinition.capabilities,
    capabilityOverrides,
    parametersDescriptor: jobTarget.kind === 'job' ? jobTarget.parameters : undefined,
    parameters: context.parameters,
    settings: moduleRuntimeInputs.settings,
    secrets: moduleRuntimeInputs.secrets,
    logger: moduleLogger
  });

  const output = await jobTarget.handler(moduleContext as any);
  return normalizeModuleJobResult(output);
}
function normalizeModuleJobResult(output: unknown): JobResult {
  if (output === undefined || output === null) {
    return {};
  }

  if (typeof output === 'object' && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    let recognized = false;
    const result: JobResult = {};

    if (typeof record.status === 'string') {
      const status = record.status as JobResult['status'];
      if (status === 'succeeded' || status === 'failed' || status === 'canceled' || status === 'expired') {
        result.status = status;
        recognized = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(record, 'result')) {
      const jsonResult = coerceJsonValue(record.result);
      if (jsonResult !== undefined) {
        result.result = jsonResult;
        recognized = true;
      } else if (record.result === null) {
        result.result = null;
        recognized = true;
      }
    }

    if (typeof record.errorMessage === 'string') {
      result.errorMessage = record.errorMessage;
      recognized = true;
    }

    if (typeof record.logsUrl === 'string') {
      result.logsUrl = record.logsUrl;
      recognized = true;
    }

    if (Object.prototype.hasOwnProperty.call(record, 'metrics')) {
      const metricsValue = coerceJsonValue(record.metrics);
      if (metricsValue !== undefined) {
        result.metrics = metricsValue;
        recognized = true;
      }
    }

    if (Object.prototype.hasOwnProperty.call(record, 'context')) {
      const contextValue = coerceJsonValue(record.context);
      if (contextValue !== undefined) {
        result.context = contextValue;
        recognized = true;
      }
    }

    if (!recognized) {
      const jsonValue = coerceJsonValue(record);
      if (jsonValue !== undefined) {
        result.result = jsonValue;
      }
    }

    return result;
  }

  const jsonValue = coerceJsonValue(output);
  return jsonValue === undefined ? {} : { result: jsonValue } satisfies JobResult;
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
  workflowEventContext: WorkflowEventContext | null;
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
      resolveSecret: context.resolveSecret,
      workflowEventContext: params.workflowEventContext
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
