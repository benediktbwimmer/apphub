import { Buffer } from 'node:buffer';
import {
  type BuildRecord,
  type JobBundleRecord,
  type JobBundleVersionRecord,
  type JobDefinitionRecord,
  type JobRunRecord,
  type LaunchRecord,
  type RepositoryRecordWithRelevance,
  type ServiceRecord,
  type WorkflowDefinitionRecord,
  type WorkflowRunRecord,
  type WorkflowRunMetrics,
  type WorkflowRunStats,
  type WorkflowRunStepRecord
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

export function serializeService(service: ServiceRecord) {
  return {
    id: service.id,
    slug: service.slug,
    displayName: service.displayName,
    kind: service.kind,
    baseUrl: service.baseUrl,
    status: service.status,
    statusMessage: service.statusMessage,
    capabilities: service.capabilities,
    metadata: service.metadata,
    openapi: extractOpenApiMetadata(service.metadata),
    lastHealthyAt: service.lastHealthyAt,
    createdAt: service.createdAt,
    updatedAt: service.updatedAt
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
    previewTiles
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
    schedule: {
      nextRunAt: workflow.scheduleNextRunAt,
      lastWindow: workflow.scheduleLastMaterializedWindow,
      catchupCursor: workflow.scheduleCatchupCursor
    },
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt
  };
}

export function serializeWorkflowRun(run: WorkflowRunRecord) {
  return {
    id: run.id,
    workflowDefinitionId: run.workflowDefinitionId,
    status: run.status,
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
    updatedAt: run.updatedAt
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
