import { Buffer } from 'node:buffer';
import {
  type BuildRecord,
  type JobBundleRecord,
  type JobBundleVersionRecord,
  type JobDefinitionRecord,
  type JobRunRecord,
  type JobRunWithDefinition,
  type LaunchRecord,
  type RepositoryRecordWithRelevance,
  type ServiceRecord,
  type ServiceHealthSnapshotRecord,
  type WorkflowDefinitionRecord,
  type WorkflowScheduleRecord,
  type WorkflowRunRecord,
  type WorkflowRunWithDefinition,
  type WorkflowRunMetrics,
  type WorkflowRunStats,
  type WorkflowRunStepRecord,
  type WorkflowEventTriggerRecord,
  type WorkflowTriggerDeliveryRecord,
  type WorkflowEventRecord,
  type WorkflowActivityEntry
} from '../../db/index';
import type { BundleDownloadInfo } from '../../jobs/bundleStorage';
import type { WorkflowJsonValue } from '../../workflows/zodSchemas';

export type JsonValue = WorkflowJsonValue;

const LOG_PREVIEW_LIMIT = 4000;

export function serializeBuild(build: BuildRecord | null) {
  if (!build) {
    return null;
  }

  const logs = build.logs ?? null;
  const preview = logs
    ? logs.length > LOG_PREVIEW_LIMIT
      ? logs.slice(-LOG_PREVIEW_LIMIT)
      : logs
    : null;
  const truncated = Boolean(logs && preview && preview.length < logs.length);

  return {
    id: build.id,
    repositoryId: build.repositoryId,
    status: build.status,
    imageTag: build.imageTag,
    errorMessage: build.errorMessage,
    commitSha: build.commitSha,
    gitBranch: build.gitBranch,
    gitRef: build.gitRef,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    startedAt: build.startedAt,
    completedAt: build.completedAt,
    durationMs: build.durationMs,
    logsPreview: preview,
    logsTruncated: truncated,
    hasLogs: Boolean(logs && logs.length > 0),
    logsSize: logs ? Buffer.byteLength(logs, 'utf8') : 0
  };
}

export function serializeLaunch(launch: LaunchRecord | null) {
  if (!launch) {
    return null;
  }

  return {
    id: launch.id,
    status: launch.status,
    buildId: launch.buildId,
    instanceUrl: launch.instanceUrl,
    resourceProfile: launch.resourceProfile,
    env: launch.env,
    command: launch.command,
    errorMessage: launch.errorMessage,
    createdAt: launch.createdAt,
    updatedAt: launch.updatedAt,
    startedAt: launch.startedAt,
    stoppedAt: launch.stoppedAt,
    expiresAt: launch.expiresAt,
    port: launch.port,
    internalPort: launch.internalPort,
    containerIp: launch.containerIp
  };
}

function extractOpenApiMetadata(metadata: JsonValue | null): JsonValue | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const metadataObject = metadata as Record<string, JsonValue>;
  const openapi = metadataObject.openapi;
  if (!openapi || typeof openapi !== 'object' || Array.isArray(openapi)) {
    return null;
  }
  return openapi;
}

export function serializeService(
  service: ServiceRecord,
  health?: ServiceHealthSnapshotRecord | null
) {
  return {
    id: service.id,
    slug: service.slug,
    displayName: service.displayName,
    kind: service.kind,
    baseUrl: service.baseUrl,
    source: service.source,
    status: service.status,
    statusMessage: service.statusMessage,
    capabilities: service.capabilities,
    metadata: service.metadata,
    openapi: extractOpenApiMetadata(service.metadata),
    lastHealthyAt: service.lastHealthyAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt,
    health: health
      ? {
          status: health.status,
          statusMessage: health.statusMessage,
          checkedAt: health.checkedAt,
          latencyMs: health.latencyMs,
          statusCode: health.statusCode,
          baseUrl: health.baseUrl,
          healthEndpoint: health.healthEndpoint
        }
      : null
  };
}

export function serializeRepository(record: RepositoryRecordWithRelevance) {
  const {
    id,
    name,
    description,
    repoUrl,
    dockerfilePath,
    updatedAt,
    tags,
    ingestStatus,
    ingestError,
    ingestAttempts,
    latestBuild,
    latestLaunch,
    previewTiles,
    metadataStrategy
  } = record;
  return {
    id,
    name,
    description,
    repoUrl,
    dockerfilePath,
    updatedAt,
    tags: tags.map((tag) => ({ key: tag.key, value: tag.value })),
    ingestStatus,
    ingestError,
    ingestAttempts,
    latestBuild: serializeBuild(latestBuild),
    latestLaunch: serializeLaunch(latestLaunch),
    previewTiles: previewTiles.map((tile) => ({
      id: tile.id,
      kind: tile.kind,
      title: tile.title,
      description: tile.description,
      src: tile.src,
      embedUrl: tile.embedUrl,
      posterUrl: tile.posterUrl,
      width: tile.width,
      height: tile.height,
      sortOrder: tile.sortOrder,
      source: tile.source
    })),
    launchEnvTemplates: record.launchEnvTemplates,
    metadataStrategy,
    relevance: record.relevance ?? null
  };
}

export function serializeJobDefinition(job: JobDefinitionRecord) {
  let registryRef: string | null = null;
  if (job.metadata && typeof job.metadata === 'object' && !Array.isArray(job.metadata)) {
    const candidate = (job.metadata as Record<string, JsonValue | undefined>).registryRef;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      registryRef = candidate.trim();
    }
  }
  return {
    id: job.id,
    slug: job.slug,
    name: job.name,
    version: job.version,
    type: job.type,
    runtime: job.runtime,
    entryPoint: job.entryPoint,
    registryRef,
    parametersSchema: job.parametersSchema,
    defaultParameters: job.defaultParameters,
    outputSchema: job.outputSchema,
    timeoutMs: job.timeoutMs,
    retryPolicy: job.retryPolicy,
    metadata: job.metadata,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

export function serializeJobRun(run: JobRunRecord) {
  return {
    id: run.id,
    jobDefinitionId: run.jobDefinitionId,
    status: run.status,
    parameters: run.parameters,
    result: run.result,
    errorMessage: run.errorMessage,
    logsUrl: run.logsUrl,
    metrics: run.metrics,
    context: run.context,
    timeoutMs: run.timeoutMs,
    attempt: run.attempt,
    maxAttempts: run.maxAttempts,
    durationMs: run.durationMs,
    scheduledAt: run.scheduledAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
}

export function serializeJobRunWithDefinition(entry: JobRunWithDefinition) {
  return {
    run: serializeJobRun(entry.run),
    job: {
      id: entry.job.id,
      slug: entry.job.slug,
      name: entry.job.name,
      version: entry.job.version,
      type: entry.job.type,
      runtime: entry.job.runtime
    }
  };
}

export function serializeJobBundle(
  bundle: JobBundleRecord,
  options?: { includeVersions?: boolean; includeManifest?: boolean }
) {
  const payload: Record<string, unknown> = {
    id: bundle.id,
    slug: bundle.slug,
    displayName: bundle.displayName,
    description: bundle.description,
    latestVersion: bundle.latestVersion,
    createdAt: bundle.createdAt,
    updatedAt: bundle.updatedAt
  };

  if (options?.includeVersions && bundle.versions) {
    payload.versions = bundle.versions.map((version) =>
      serializeJobBundleVersion(version, { includeManifest: options.includeManifest })
    );
  }

  return payload;
}

export function serializeJobBundleVersion(
  version: JobBundleVersionRecord,
  options?: { includeManifest?: boolean; download?: BundleDownloadInfo | null }
) {
  const downloadInfo = options?.download ?? null;
  return {
    id: version.id,
    bundleId: version.bundleId,
    slug: version.slug,
    version: version.version,
    checksum: version.checksum,
    capabilityFlags: version.capabilityFlags,
    immutable: version.immutable,
    status: version.status,
    artifact: {
      storage: version.artifactStorage,
      contentType: version.artifactContentType,
      size: version.artifactSize
    },
    manifest: options?.includeManifest ? version.manifest : undefined,
    metadata: version.metadata,
    publishedBy: version.publishedBy
      ? {
          subject: version.publishedBy,
          kind: version.publishedByKind,
          tokenHash: version.publishedByTokenHash
        }
      : null,
    publishedAt: version.publishedAt,
    deprecatedAt: version.deprecatedAt,
    replacedAt: version.replacedAt,
    replacedBy: version.replacedBy,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    download: downloadInfo
      ? {
          url: downloadInfo.url,
          expiresAt: new Date(downloadInfo.expiresAt).toISOString(),
          storage: downloadInfo.storage,
          kind: downloadInfo.kind
        }
      : undefined
  };
}

export function serializeWorkflowSchedule(schedule: WorkflowScheduleRecord) {
  return {
    id: schedule.id,
    workflowDefinitionId: schedule.workflowDefinitionId,
    name: schedule.name,
    description: schedule.description,
    cron: schedule.cron,
    timezone: schedule.timezone,
    parameters: schedule.parameters,
    startWindow: schedule.startWindow,
    endWindow: schedule.endWindow,
    catchUp: schedule.catchUp,
    nextRunAt: schedule.nextRunAt,
    lastWindow: schedule.lastMaterializedWindow,
    catchupCursor: schedule.catchupCursor,
    isActive: schedule.isActive,
    createdAt: schedule.createdAt,
    updatedAt: schedule.updatedAt
  };
}

export function serializeWorkflowDefinition(workflow: WorkflowDefinitionRecord) {
  return {
    id: workflow.id,
    slug: workflow.slug,
    name: workflow.name,
    version: workflow.version,
    description: workflow.description,
    steps: workflow.steps,
    triggers: workflow.triggers,
    parametersSchema: workflow.parametersSchema,
    defaultParameters: workflow.defaultParameters,
    outputSchema: workflow.outputSchema,
    metadata: workflow.metadata,
    dag: workflow.dag,
    schedules: workflow.schedules.map(serializeWorkflowSchedule),
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt
  };
}

export function serializeWorkflowRun(run: WorkflowRunRecord) {
  return {
    id: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    status: run.status,
    runKey: run.runKey,
    parameters: run.parameters,
    context: run.context,
    output: run.output,
    errorMessage: run.errorMessage,
    currentStepId: run.currentStepId,
    currentStepIndex: run.currentStepIndex,
    metrics: run.metrics,
    triggeredBy: run.triggeredBy,
    trigger: run.trigger,
    partitionKey: run.partitionKey,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    retrySummary: {
      pendingSteps: run.retrySummary.pendingSteps,
      nextAttemptAt: run.retrySummary.nextAttemptAt,
      overdueSteps: run.retrySummary.overdueSteps
    },
    health: run.retrySummary.pendingSteps > 0 ? 'degraded' : 'healthy'
  };
}

export function serializeWorkflowRunWithDefinition(entry: WorkflowRunWithDefinition) {
  return {
    run: serializeWorkflowRun(entry.run),
    workflow: {
      id: entry.workflow.id,
      slug: entry.workflow.slug,
      name: entry.workflow.name,
      version: entry.workflow.version
    }
  };
}

export function serializeWorkflowRunStep(step: WorkflowRunStepRecord) {
  return {
    id: step.id,
    workflowRunId: step.workflowRunId,
    stepId: step.stepId,
    status: step.status,
    attempt: step.attempt,
    jobRunId: step.jobRunId,
    input: step.input,
    output: step.output,
    errorMessage: step.errorMessage,
    logsUrl: step.logsUrl,
    metrics: step.metrics,
    context: step.context,
    producedAssets: step.producedAssets,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    parentStepId: step.parentStepId,
    fanoutIndex: step.fanoutIndex,
    templateStepId: step.templateStepId,
    lastHeartbeatAt: step.lastHeartbeatAt,
    retryCount: step.retryCount,
    failureReason: step.failureReason,
    nextAttemptAt: step.nextAttemptAt,
    retryState: step.retryState,
    retryAttempts: step.retryAttempts,
    retryMetadata: step.retryMetadata,
    resolutionError: step.resolutionError,
    createdAt: step.createdAt,
    updatedAt: step.updatedAt
  };
}

export function serializeWorkflowRunStats(stats: WorkflowRunStats) {
  return {
    workflowId: stats.workflowId,
    slug: stats.slug,
    range: {
      from: stats.range.from.toISOString(),
      to: stats.range.to.toISOString()
    },
    totalRuns: stats.totalRuns,
    statusCounts: { ...stats.statusCounts },
    successRate: stats.successRate,
    failureRate: stats.failureRate,
    averageDurationMs: stats.averageDurationMs,
    failureCategories: stats.failureCategories.map((category) => ({
      category: category.category,
      count: category.count
    }))
  };
}

export function serializeWorkflowRunMetrics(metrics: WorkflowRunMetrics) {
  return {
    workflowId: metrics.workflowId,
    slug: metrics.slug,
    range: {
      from: metrics.range.from.toISOString(),
      to: metrics.range.to.toISOString()
    },
    bucketInterval: metrics.bucketInterval,
    series: metrics.series.map((point) => ({
      bucketStart: point.bucketStart,
      bucketEnd: point.bucketEnd,
      totalRuns: point.totalRuns,
      statusCounts: { ...point.statusCounts },
      averageDurationMs: point.averageDurationMs,
      rollingSuccessCount: point.rollingSuccessCount
    }))
  };
}

export function serializeWorkflowEventTrigger(trigger: WorkflowEventTriggerRecord) {
  return {
    id: trigger.id,
    workflowDefinitionId: trigger.workflowDefinitionId,
    version: trigger.version,
    status: trigger.status,
    name: trigger.name,
    description: trigger.description,
    eventType: trigger.eventType,
    eventSource: trigger.eventSource,
    predicates: trigger.predicates,
    parameterTemplate: trigger.parameterTemplate,
    runKeyTemplate: trigger.runKeyTemplate,
    throttleWindowMs: trigger.throttleWindowMs,
    throttleCount: trigger.throttleCount,
    maxConcurrency: trigger.maxConcurrency,
    idempotencyKeyExpression: trigger.idempotencyKeyExpression,
    metadata: trigger.metadata,
    createdAt: trigger.createdAt,
    updatedAt: trigger.updatedAt,
    createdBy: trigger.createdBy,
    updatedBy: trigger.updatedBy
  };
}

export function serializeWorkflowTriggerDelivery(delivery: WorkflowTriggerDeliveryRecord) {
  return {
    id: delivery.id,
    triggerId: delivery.triggerId,
    workflowDefinitionId: delivery.workflowDefinitionId,
    eventId: delivery.eventId,
    status: delivery.status,
    attempts: delivery.attempts,
    lastError: delivery.lastError,
    workflowRunId: delivery.workflowRunId,
    dedupeKey: delivery.dedupeKey,
    nextAttemptAt: delivery.nextAttemptAt,
    throttledUntil: delivery.throttledUntil,
    retryState: delivery.retryState,
    retryAttempts: delivery.retryAttempts,
    retryMetadata: delivery.retryMetadata,
    createdAt: delivery.createdAt,
    updatedAt: delivery.updatedAt
  };
}

export function serializeWorkflowActivityEntry(entry: WorkflowActivityEntry) {
  return {
    kind: entry.kind,
    id: entry.id,
    status: entry.status,
    occurredAt: entry.occurredAt,
    workflow: entry.workflow,
    run: entry.run ? serializeWorkflowRun(entry.run) : null,
    delivery: entry.delivery ? serializeWorkflowTriggerDelivery(entry.delivery) : null,
    linkedRun: entry.linkedRun ? serializeWorkflowRun(entry.linkedRun) : null,
    trigger: entry.trigger
      ? {
          id: entry.trigger.id,
          name: entry.trigger.name,
          eventType: entry.trigger.eventType,
          eventSource: entry.trigger.eventSource,
          status: entry.trigger.status
        }
      : null
  };
}

export function serializeWorkflowEvent(event: WorkflowEventRecord) {
  return {
    id: event.id,
    type: event.type,
    source: event.source,
    occurredAt: event.occurredAt,
    receivedAt: event.receivedAt,
    payload: event.payload,
    correlationId: event.correlationId,
    ttlMs: event.ttlMs,
    metadata: event.metadata
  };
}

export type SerializedRepository = ReturnType<typeof serializeRepository>;
export type SerializedBuild = ReturnType<typeof serializeBuild>;
export type SerializedLaunch = ReturnType<typeof serializeLaunch>;
export type SerializedService = ReturnType<typeof serializeService>;
export type SerializedWorkflowDefinition = ReturnType<typeof serializeWorkflowDefinition>;
export type SerializedWorkflowRun = ReturnType<typeof serializeWorkflowRun>;
export type SerializedWorkflowRunStep = ReturnType<typeof serializeWorkflowRunStep>;
export type SerializedWorkflowRunStats = ReturnType<typeof serializeWorkflowRunStats>;
export type SerializedWorkflowRunMetrics = ReturnType<typeof serializeWorkflowRunMetrics>;
export type SerializedJobBundle = ReturnType<typeof serializeJobBundle>;
export type SerializedJobBundleVersion = ReturnType<typeof serializeJobBundleVersion>;
export type SerializedWorkflowEventTrigger = ReturnType<typeof serializeWorkflowEventTrigger>;
export type SerializedWorkflowTriggerDelivery = ReturnType<typeof serializeWorkflowTriggerDelivery>;
export type SerializedWorkflowActivityEntry = ReturnType<typeof serializeWorkflowActivityEntry>;
export type SerializedWorkflowEventRecord = ReturnType<typeof serializeWorkflowEvent>;
