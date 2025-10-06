import { setTimeout as delay } from 'node:timers/promises';

import {
  CapabilityRequestError,
  createJobHandler,
  createMetastoreCapability,
  enforceScratchOnlyWrites,
  selectCoreWorkflows,
  selectFilestore,
  selectMetastore,
  inheritModuleSecrets,
  inheritModuleSettings,
  type CoreWorkflowsCapability,
  type FilestoreCapability,
  type FilestoreDownloadStream,
  type JobContext,
  type MetastoreCapability
} from '@apphub/module-sdk';
import { z } from 'zod';

import { ensureResolvedBackendId, uploadTextFile } from '@apphub/module-sdk';
import { DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../runtime';
import {
  buildPlanSummary,
  calibrationReprocessPlanSchema,
  computePartitionStateCounts,
  createInitialPartitionStatus,
  normalizeMinuteKey,
  sanitizeIdentifier,
  type CalibrationPlanCalibration,
  type CalibrationPlanPartition,
  type CalibrationPlanRecordedCalibration,
  type CalibrationReprocessPlan
} from '../runtime/plans';
import { type ObservatoryModuleSecrets, type ObservatoryModuleSettings } from '../runtime/settings';

enforceScratchOnlyWrites();

const DEFAULT_JOB_SLUG = 'observatory-calibration-reprocessor';
const DEFAULT_IDEMPOTENCY_PREFIX = 'observatory-calibration-reprocessor';
const PLAN_WORKFLOW_SLUG = 'observatory-calibration-planner';
const PLAN_ASSET_ID = 'observatory.reprocess.plan';
const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 30_000;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

function toIntegerOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

const rawParametersSchema = z
  .object({
    planPath: z.string().optional(),
    plan_path: z.string().optional(),
    planNodeId: z.number().int().positive().optional(),
    plan_node_id: z.number().int().positive().optional(),
    planId: z.string().optional(),
    plan_id: z.string().optional(),
    mode: z.string().optional(),
    selectedPartitions: z.array(z.string()).optional(),
    selected_partitions: z.array(z.string()).optional(),
    pollIntervalMs: z.number().int().positive().optional(),
    poll_interval_ms: z.number().int().positive().optional(),
    ingestWorkflowSlug: z.string().optional(),
    ingest_workflow_slug: z.string().optional(),
    filestoreBackendId: z.number().int().positive().optional(),
    filestore_backend_id: z.number().int().positive().optional(),
    filestoreBackendKey: z.string().optional(),
    filestore_backend_key: z.string().optional(),
    metastoreNamespace: z.string().optional(),
    metastore_namespace: z.string().optional(),
    metastoreBaseUrl: z.string().optional(),
    metastore_base_url: z.string().optional(),
    principal: z.string().optional(),
    idempotencyKey: z.string().optional(),
    idempotency_key: z.string().optional()
  })
  .strip();

const parametersSchema = z
  .object({
    planPath: z.string().optional(),
    planNodeId: z.number().int().positive().optional(),
    planId: z.string().optional(),
    mode: z.enum(['all', 'selected']).default('all'),
    selectedPartitions: z.array(z.string()).default([]),
    pollIntervalMs: z.number().int().positive().optional(),
    ingestWorkflowSlug: z.string().optional(),
    filestoreBackendId: z.number().int().positive().optional(),
    filestoreBackendKey: z.string().optional(),
    metastoreNamespace: z.string().optional(),
    metastoreBaseUrl: z.string().optional(),
    principal: z.string().optional(),
    idempotencyKey: z.string().optional()
  })
  .strip();

export type CalibrationReprocessorParameters = z.infer<typeof parametersSchema>;

interface CalibrationReprocessorContext extends JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  CalibrationReprocessorParameters
> {}

interface PartitionExecution {
  calibration: CalibrationPlanCalibration;
  partition: CalibrationPlanPartition;
}

interface PartitionRunOutcome {
  calibrationId: string;
  partitionKey: string | null;
  minute: string;
  runId: string | null;
  status: 'succeeded' | 'failed';
  errorMessage?: string | null;
}

interface WorkflowRunRecord {
  id: string;
  status: string;
  runKey: string | null;
  partitionKey: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  triggeredBy: string | null;
}

interface CalibrationReprocessorResult {
  planId: string;
  planPath: string;
  planNodeId: number | null;
  processedPartitions: number;
  succeededPartitions: number;
  failedPartitions: number;
  mode: 'all' | 'selected';
  state: CalibrationReprocessPlan['state'];
  runs: Array<{
    partitionKey: string | null;
    minute: string;
    runId: string | null;
    status: 'succeeded' | 'failed';
    errorMessage: string | null;
  }>;
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: Record<string, unknown>;
  }>;
}

function normalizeRawParameters(raw: unknown): Record<string, unknown> {
  const parsed = rawParametersSchema.parse((raw ?? {}) as Record<string, unknown>);
  const selectedRaw = parsed.selectedPartitions ?? parsed.selected_partitions ?? [];
  const selected = Array.isArray(selectedRaw)
    ? selectedRaw
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ensureString(entry)))
        .filter((entry) => entry.length > 0)
    : [];
  const modeNormalized = parsed.mode ? parsed.mode.trim().toLowerCase() : undefined;
  return {
    planPath: parsed.planPath ?? parsed.plan_path,
    planNodeId: parsed.planNodeId ?? parsed.plan_node_id,
    planId: parsed.planId ?? parsed.plan_id,
    mode: modeNormalized,
    selectedPartitions: selected,
    pollIntervalMs: parsed.pollIntervalMs ?? parsed.poll_interval_ms,
    ingestWorkflowSlug: parsed.ingestWorkflowSlug ?? parsed.ingest_workflow_slug,
    filestoreBackendId: parsed.filestoreBackendId ?? parsed.filestore_backend_id,
    filestoreBackendKey: parsed.filestoreBackendKey ?? parsed.filestore_backend_key,
    metastoreNamespace: parsed.metastoreNamespace ?? parsed.metastore_namespace,
    metastoreBaseUrl: parsed.metastoreBaseUrl ?? parsed.metastore_base_url,
    principal: parsed.principal,
    idempotencyKey: parsed.idempotencyKey ?? parsed.idempotency_key
  } satisfies Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

async function streamToString(stream: FilestoreDownloadStream): Promise<string> {
  const candidate = stream as ReadableStream<Uint8Array> & {
    getReader?: () => ReadableStreamDefaultReader<Uint8Array>;
  };
  if (typeof candidate?.getReader === 'function') {
    const reader = candidate.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        chunks.push(value);
      }
    }
    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
  }

  const nodeStream = stream as NodeJS.ReadableStream;
  const buffers: Buffer[] = [];
  for await (const chunk of nodeStream) {
    buffers.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(buffers).toString('utf8');
}

function parseMode(value: unknown): 'all' | 'selected' {
  const normalized = ensureString(value).toLowerCase();
  return normalized === 'selected' ? 'selected' : 'all';
}

function buildSelectionSet(selected: string[]): {
  raw: Set<string>;
  minutes: Set<string>;
  instrumentMinutes: Set<string>;
} {
  const rawSet = new Set<string>();
  const minuteSet = new Set<string>();
  const instrumentMinuteSet = new Set<string>();
  for (const entry of selected) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    rawSet.add(trimmed);
    const minute = normalizeMinuteKey(trimmed);
    if (minute) {
      minuteSet.add(minute);
    }
    if (trimmed.includes(':')) {
      instrumentMinuteSet.add(trimmed);
    }
  }
  return { raw: rawSet, minutes: minuteSet, instrumentMinutes: instrumentMinuteSet };
}

function cloneParameters(
  parameters: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!parameters || typeof parameters !== 'object') {
    return {};
  }
  return JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>;
}

function updatePartitionStatus(
  partition: CalibrationPlanPartition,
  updates: Partial<CalibrationPlanPartition['status']>
): void {
  const merged = {
    ...partition.status,
    ...updates,
    updatedAt: new Date().toISOString()
  } satisfies CalibrationPlanPartition['status'];
  partition.status = merged;
}

function appendCalibrationContext(
  parameters: Record<string, unknown>,
  plan: CalibrationReprocessPlan,
  calibration: CalibrationPlanCalibration,
  partition: CalibrationPlanPartition
): Record<string, unknown> {
  parameters.calibrationPlanContext = {
    planId: plan.planId,
    calibrationId: calibration.target.calibrationId,
    instrumentId: calibration.target.instrumentId,
    targetEffectiveAt: calibration.target.effectiveAt,
    partitionKey: partition.partitionKey,
    minute: partition.minute
  };
  return parameters;
}

function refreshPlanSummaries(plan: CalibrationReprocessPlan): void {
  for (const calibration of plan.calibrations) {
    calibration.summary = {
      partitionCount: calibration.partitions.length,
      stateCounts: computePartitionStateCounts(calibration.partitions)
    };
  }
  plan.summary = buildPlanSummary(plan.calibrations);
}

function computeResultSummary(outcomes: PartitionRunOutcome[]): {
  processed: number;
  succeeded: number;
  failed: number;
} {
  let succeeded = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome.status === 'succeeded') {
      succeeded += 1;
    } else {
      failed += 1;
    }
  }
  return {
    processed: outcomes.length,
    succeeded,
    failed
  };
}

let planPersistChain: Promise<void> = Promise.resolve();

function queuePlanPersist(task: () => Promise<void>): Promise<void> {
  planPersistChain = planPersistChain.then(task, task);
  return planPersistChain;
}

async function enqueuePlanPersistence(
  plan: CalibrationReprocessPlan,
  filestore: FilestoreCapability,
  backendMountId: number,
  backendMountKey: string | null,
  planPath: string,
  principal: string | undefined,
  idempotencyKey: string
): Promise<void> {
  refreshPlanSummaries(plan);
  plan.updatedAt = new Date().toISOString();
  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  const node = await uploadTextFile({
    filestore,
    backendMountId,
    backendMountKey: backendMountKey ?? undefined,
    defaultBackendKey: DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
    path: planPath,
    content: serialized,
    contentType: 'application/json; charset=utf-8',
    principal,
    idempotencyKey
  });
  const resolvedNodeId = node.node?.id ?? node.nodeId;
  if (resolvedNodeId !== undefined && resolvedNodeId !== null) {
    plan.storage.nodeId = resolvedNodeId;
  } else if ('nodeId' in plan.storage) {
    delete (plan.storage as { nodeId?: number }).nodeId;
  }
}

async function upsertPlanMetastoreRecord(
  metastore: MetastoreCapability | null,
  plan: CalibrationReprocessPlan,
  summary: { processed: number; succeeded: number; failed: number },
  principal: string | undefined
): Promise<void> {
  if (!metastore || !plan.storage.metastore) {
    return;
  }
  await metastore.upsertRecord({
    key: plan.storage.metastore.recordKey,
    metadata: {
      planId: plan.planId,
      state: plan.state,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      partitionCount: plan.summary.partitionCount,
      instrumentCount: plan.summary.instrumentCount,
      calibrationCount: plan.summary.calibrationCount,
      processedPartitions: summary.processed,
      succeededPartitions: summary.succeeded,
      failedPartitions: summary.failed,
      downstreamWorkflows: plan.downstreamWorkflows,
      storage: plan.storage,
      calibrations: plan.calibrations.map((entry) => ({
        calibrationId: entry.target.calibrationId,
        instrumentId: entry.target.instrumentId,
        effectiveAt: entry.target.effectiveAt,
        metastoreVersion: entry.target.metastoreVersion ?? null,
        effectiveFromMinute: entry.effectiveFromMinute,
        partitionCount: entry.summary.partitionCount,
        stateCounts: entry.summary.stateCounts ?? null
      }))
    },
    principal
  });
}

async function enqueueWorkflowRun(
  capability: CoreWorkflowsCapability,
  input: {
    workflowSlug: string;
    partitionKey: string;
    parameters: Record<string, unknown>;
    runKey: string;
    triggeredBy: string;
    principal?: string;
    idempotencyKey?: string;
  }
): Promise<WorkflowRunRecord> {
  try {
    const response = await capability.enqueueWorkflowRun({
      workflowSlug: input.workflowSlug,
      partitionKey: input.partitionKey,
      parameters: input.parameters,
      runKey: input.runKey,
      triggeredBy: input.triggeredBy,
      principal: input.principal,
      idempotencyKey: input.idempotencyKey
    });
    const data = isRecord(response.data) ? response.data : response;
    const runId = ensureString(data.id ?? data.runId ?? '');
    if (!runId) {
      throw new Error('Run ID missing from workflow enqueue response');
    }
    return {
      id: runId,
      status: ensureString(data.status ?? 'pending') || 'pending',
      runKey: ensureString(data.runKey ?? '') || null,
      partitionKey: ensureString(data.partitionKey ?? input.partitionKey) || input.partitionKey,
      errorMessage: ensureString(data.errorMessage ?? '') || null,
      startedAt: ensureString(data.startedAt ?? '') || null,
      completedAt: ensureString(data.completedAt ?? '') || null,
      triggeredBy: ensureString(data.triggeredBy ?? input.triggeredBy) || input.triggeredBy
    } satisfies WorkflowRunRecord;
  } catch (error) {
    if (error instanceof CapabilityRequestError) {
      const message = error.responseBody ?? `status ${error.status}`;
      throw new Error(`Failed to enqueue workflow run: ${message}`);
    }
    throw error;
  }
}

async function fetchWorkflowRun(
  capability: CoreWorkflowsCapability,
  runId: string,
  principal?: string
): Promise<WorkflowRunRecord> {
  try {
    const response = await capability.getWorkflowRun({ runId, principal });
    const data = isRecord(response.data) ? response.data : response;
    return {
      id: ensureString(data.id ?? runId) || runId,
      status: ensureString(data.status ?? 'pending') || 'pending',
      runKey: ensureString(data.runKey ?? '') || null,
      partitionKey: ensureString(data.partitionKey ?? '') || null,
      errorMessage: ensureString(data.errorMessage ?? '') || null,
      startedAt: ensureString(data.startedAt ?? '') || null,
      completedAt: ensureString(data.completedAt ?? '') || null,
      triggeredBy: ensureString(data.triggeredBy ?? '') || null
    } satisfies WorkflowRunRecord;
  } catch (error) {
    if (error instanceof CapabilityRequestError) {
      const message = error.responseBody ?? `status ${error.status}`;
      throw new Error(`Failed to fetch workflow run: ${message}`);
    }
    throw error;
  }
}

function selectPartitions(
  plan: CalibrationReprocessPlan,
  mode: 'all' | 'selected',
  selected: string[],
  logger: CalibrationReprocessorContext['logger']
): PartitionExecution[] {
  const selections = buildSelectionSet(selected);
  const matches = new Set<string>();
  const executions: PartitionExecution[] = [];

  for (const calibration of plan.calibrations) {
    for (const partition of calibration.partitions) {
      if (mode === 'selected') {
        const minuteMatch = selections.minutes.has(partition.minute);
        const partitionKeyMatch = partition.partitionKey
          ? selections.raw.has(partition.partitionKey)
          : false;
        const instrumentMinuteMatch = selections.instrumentMinutes.has(
          `${calibration.target.instrumentId}:${partition.minute}`
        );
        if (!minuteMatch && !partitionKeyMatch && !instrumentMinuteMatch) {
          continue;
        }
        if (minuteMatch) {
          matches.add(partition.minute);
        }
        if (partitionKeyMatch && partition.partitionKey) {
          matches.add(partition.partitionKey);
        }
        if (instrumentMinuteMatch) {
          matches.add(`${calibration.target.instrumentId}:${partition.minute}`);
        }
      } else if (partition.status.state === 'succeeded') {
        continue;
      }

      executions.push({ calibration, partition });
    }
  }

  if (mode === 'selected') {
    const unmatched: string[] = [];
    for (const entry of selections.raw) {
      const minute = normalizeMinuteKey(entry);
      const instrumentMinute = entry.includes(':') ? entry : null;
      const matched =
        matches.has(entry) ||
        (minute ? matches.has(minute) : false) ||
        (instrumentMinute ? matches.has(instrumentMinute) : false);
      if (!matched) {
        unmatched.push(entry);
      }
    }
    if (unmatched.length > 0) {
      logger.warn('Some selected partitions were not found in the plan', { unmatched });
    }
  }

  return executions;
}

async function loadPlan(
  context: CalibrationReprocessorContext,
  filestore: FilestoreCapability,
  backendMountId: number,
  planNodeId: number | null,
  planPath: string | null,
  principal: string | undefined
): Promise<{ plan: CalibrationReprocessPlan; planPath: string; nodeId: number | null }>
{
  if (planNodeId) {
    const download = await filestore.downloadFile({ nodeId: planNodeId, principal });
    const content = await streamToString(download.stream);
    const plan = calibrationReprocessPlanSchema.parse(JSON.parse(content));
    const path = plan.storage.planPath ?? planPath ?? '';
    return { plan, planPath: path, nodeId: planNodeId };
  }

  if (!planPath) {
    throw new Error('planPath or planNodeId must be provided');
  }
  const normalizedPath = planPath.replace(/^\/+/, '').replace(/\/+$/g, '');
  const node = await filestore.getNodeByPath({ backendMountId, path: normalizedPath, principal });
  const download = await filestore.downloadFile({ nodeId: node.id, principal });
  const content = await streamToString(download.stream);
  const plan = calibrationReprocessPlanSchema.parse(JSON.parse(content));
  return { plan, planPath: normalizedPath, nodeId: node.id };
}

async function processPartition(
  context: CalibrationReprocessorContext,
  capability: CoreWorkflowsCapability,
  plan: CalibrationReprocessPlan,
  calibration: CalibrationPlanCalibration,
  partition: CalibrationPlanPartition,
  options: {
    workflowSlug: string;
    principal: string | undefined;
    idempotencyKeyPrefix: string;
    pollIntervalMs: number;
  }
): Promise<PartitionRunOutcome> {
  const partitionParameters = cloneParameters(partition.parameters);
  const partitionKeyFromParameters = ensureString(partitionParameters.partitionKey ?? partitionParameters.partition_key ?? '');
  const partitionKey = partitionKeyFromParameters || partition.minute;
  if (!partitionKey) {
    throw new Error(`Partition ${partition.partitionKey ?? partition.minute} is missing a partition key`);
  }
  partitionParameters.partitionKey = partitionKey;
  if (!partitionParameters.minute) {
    partitionParameters.minute = partition.minute;
  }
  appendCalibrationContext(partitionParameters, plan, calibration, partition);

  const runKey = sanitizeIdentifier(
    `${plan.planId}-${calibration.target.instrumentId}-${partition.minute}`,
    `${plan.planId}-${partition.minute}`
  );
  const idempotencyKey = `${options.idempotencyKeyPrefix}:${runKey}`;

  let queuedRun: WorkflowRunRecord;
  try {
    queuedRun = await enqueueWorkflowRun(capability, {
      workflowSlug: options.workflowSlug,
      partitionKey,
      parameters: partitionParameters,
      runKey,
      triggeredBy: `${DEFAULT_JOB_SLUG}:${plan.planId}`,
      principal: options.principal,
      idempotencyKey
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updatePartitionStatus(partition, {
      state: 'failed',
      runStatus: 'failed',
      runId: null,
      message,
      attempts: (partition.status.attempts ?? 0) + 1,
      lastErrorAt: new Date().toISOString()
    });
    return {
      calibrationId: calibration.target.calibrationId,
      partitionKey: partition.partitionKey ?? null,
      minute: partition.minute,
      runId: null,
      status: 'failed',
      errorMessage: message
    } satisfies PartitionRunOutcome;
  }

  updatePartitionStatus(partition, {
    state: 'queued',
    runStatus: queuedRun.status ?? 'pending',
    runId: queuedRun.id,
    runStartedAt: queuedRun.startedAt ?? null,
    runCompletedAt: queuedRun.completedAt ?? null,
    message: null,
    attempts: (partition.status.attempts ?? 0) + 1
  });

  let finalStatus: PartitionRunOutcome['status'] = 'failed';
  let finalError: string | null = null;

  while (true) {
    await delay(options.pollIntervalMs);
    let runRecord: WorkflowRunRecord;
    try {
      runRecord = await fetchWorkflowRun(capability, queuedRun.id, options.principal);
    } catch (error) {
      finalError = error instanceof Error ? error.message : String(error);
      context.logger.warn('Failed to poll workflow run status', {
        runId: queuedRun.id,
        error: finalError
      });
      continue;
    }

    if (runRecord.status === 'running' && partition.status.state !== 'running') {
      updatePartitionStatus(partition, {
        state: 'running',
        runStatus: 'running',
        runStartedAt: runRecord.startedAt ?? new Date().toISOString(),
        message: null
      });
    }

    if (['succeeded', 'failed', 'canceled', 'expired'].includes(runRecord.status)) {
      finalStatus = runRecord.status === 'succeeded' ? 'succeeded' : 'failed';
      finalError = runRecord.errorMessage;
      updatePartitionStatus(partition, {
        state: finalStatus,
        runStatus: runRecord.status,
        runCompletedAt: runRecord.completedAt ?? new Date().toISOString(),
        message: runRecord.errorMessage ?? null,
        lastErrorAt: runRecord.status === 'succeeded' ? null : new Date().toISOString()
      });
      break;
    }
  }

  return {
    calibrationId: calibration.target.calibrationId,
    partitionKey: partition.partitionKey ?? null,
    minute: partition.minute,
    runId: queuedRun.id,
    status: finalStatus,
    errorMessage: finalError
  } satisfies PartitionRunOutcome;
}

export const calibrationReprocessorJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  CalibrationReprocessorResult,
  CalibrationReprocessorParameters,
  ['filestore', 'coreWorkflows', 'metastore.calibrations']
>({
  name: 'observatory-calibration-reprocessor',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'coreWorkflows', 'metastore.calibrations'] as const,
  parameters: {
    resolve: (raw) => parametersSchema.parse(normalizeRawParameters(raw))
  },
  handler: async (
    context: CalibrationReprocessorContext
  ): Promise<CalibrationReprocessorResult> => {
    planPersistChain = Promise.resolve();

    const filestoreCapabilityCandidate = selectFilestore(context.capabilities);
    if (!filestoreCapabilityCandidate) {
      throw new Error('Filestore capability is required for the calibration reprocessor job');
    }
    const filestore: FilestoreCapability = filestoreCapabilityCandidate;

    const coreWorkflows = selectCoreWorkflows(context.capabilities);
    if (!coreWorkflows) {
      throw new Error('Core workflows capability is required for the calibration reprocessor job');
    }

    const ingestWorkflowSlug =
        context.parameters.ingestWorkflowSlug ?? context.settings.reprocess.ingestWorkflowSlug;
    if (!ingestWorkflowSlug) {
      throw new Error('ingestWorkflowSlug is required');
    }

    const principal =
      context.parameters.principal ?? context.settings.principals.calibrationReprocessor;

    const planIdParam = context.parameters.planId ?? null;
    let inferredPlanPath = context.parameters.planPath ?? null;
    let inferredPlanNodeId = context.parameters.planNodeId ?? null;

    if (planIdParam && (!inferredPlanPath || !inferredPlanNodeId)) {
      try {
        const plannerAsset = await coreWorkflows.getLatestAsset({
          workflowSlug: PLAN_WORKFLOW_SLUG,
          assetId: PLAN_ASSET_ID,
          partitionKey: planIdParam,
          principal
        });
        const payloadRecord = toRecord(plannerAsset?.payload);
        const storageRecord = toRecord(payloadRecord?.storage);
        inferredPlanPath = inferredPlanPath ?? toStringOrNull(storageRecord?.planPath ?? storageRecord?.plan_path);
        inferredPlanNodeId = inferredPlanNodeId ?? toIntegerOrNull(storageRecord?.nodeId ?? storageRecord?.node_id);
      } catch (error) {
        context.logger.warn('Failed to load calibration plan asset metadata', {
          planId: planIdParam,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const pollIntervalMsRaw = context.parameters.pollIntervalMs ?? context.settings.reprocess.pollIntervalMs;
    const pollIntervalMs = Math.min(
      Math.max(pollIntervalMsRaw ?? MIN_POLL_INTERVAL_MS, MIN_POLL_INTERVAL_MS),
      MAX_POLL_INTERVAL_MS
    );

    const backendParams = {
      filestoreBackendId: context.parameters.filestoreBackendId ?? context.settings.filestore.backendId,
      filestoreBackendKey:
        context.parameters.filestoreBackendKey ?? context.settings.filestore.backendKey ?? null
    } satisfies {
      filestoreBackendId?: number | null;
      filestoreBackendKey?: string | null;
    };

    const backendMountId = await ensureResolvedBackendId(filestore, backendParams);
    const backendMountKey = backendParams.filestoreBackendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY;

    const metastoreBaseUrlRaw = (context.parameters.metastoreBaseUrl ?? context.settings.metastore.baseUrl)?.trim() ?? '';
    const metastoreNamespace =
      context.parameters.metastoreNamespace ?? context.settings.reprocess.metastoreNamespace;
    const fallbackMetastore = selectMetastore(context.capabilities, 'calibrations');
    const metastoreCapability = metastoreBaseUrlRaw
      ? createMetastoreCapability({
          baseUrl: metastoreBaseUrlRaw,
          namespace: metastoreNamespace,
          token: () => context.secrets.metastoreToken ?? null
        })
      : fallbackMetastore ?? null;

    const planPathRaw = inferredPlanPath;
    const planNodeIdParam = inferredPlanNodeId;

    const { plan: loadedPlan, planPath, nodeId: resolvedPlanNodeId } = await loadPlan(
      context,
      filestore,
      backendMountId,
      planNodeIdParam,
      planPathRaw,
      principal
    );

    loadedPlan.storage.planPath = planPath;
    loadedPlan.storage.plansPrefix =
      loadedPlan.storage.plansPrefix ?? context.settings.filestore.plansPrefix;
    const existingNodeId = loadedPlan.storage.nodeId ?? undefined;
    const resolvedNodeId = resolvedPlanNodeId ?? existingNodeId;
    if (resolvedNodeId !== undefined && resolvedNodeId !== null) {
      loadedPlan.storage.nodeId = resolvedNodeId;
    } else if ('nodeId' in loadedPlan.storage) {
      delete (loadedPlan.storage as { nodeId?: number }).nodeId;
    }
    if (!loadedPlan.storage.metastore && metastoreNamespace) {
      loadedPlan.storage.metastore = {
        namespace: metastoreNamespace,
        recordKey: sanitizeIdentifier(loadedPlan.planId, loadedPlan.planId)
      };
    }

    const mode = parseMode(context.parameters.mode);
    const selectedPartitions = context.parameters.selectedPartitions ?? [];
    const executions = selectPartitions(loadedPlan, mode, selectedPartitions, context.logger);

    const idempotencyPrefix =
      context.parameters.idempotencyKey ?? `${DEFAULT_IDEMPOTENCY_PREFIX}:${loadedPlan.planId}`;

    if (executions.length === 0) {
      loadedPlan.state = 'completed';
      const summary = { processed: 0, succeeded: 0, failed: 0 };
      await queuePlanPersist(() =>
        enqueuePlanPersistence(
          loadedPlan,
          filestore,
          backendMountId,
          backendMountKey,
          planPath,
          principal,
          `${loadedPlan.planId}-noop`
        )
      );

      await upsertPlanMetastoreRecord(metastoreCapability, loadedPlan, summary, principal).catch(
        () => undefined
      );

    const result: CalibrationReprocessorResult = {
      planId: loadedPlan.planId,
      planPath,
      planNodeId: loadedPlan.storage.nodeId ?? resolvedPlanNodeId ?? planNodeIdParam ?? null,
      processedPartitions: 0,
        succeededPartitions: 0,
        failedPartitions: 0,
        mode,
        state: loadedPlan.state,
        runs: [],
        assets: [
          {
            assetId: 'observatory.reprocess.plan',
            partitionKey: loadedPlan.planId,
            producedAt: loadedPlan.updatedAt,
            payload: {
              planId: loadedPlan.planId,
              state: loadedPlan.state,
              updatedAt: loadedPlan.updatedAt,
              summary: loadedPlan.summary,
              storage: loadedPlan.storage
            }
        }
      ]
    };

    return result;
  }

  loadedPlan.state = 'in_progress';
    await queuePlanPersist(() =>
      enqueuePlanPersistence(
        loadedPlan,
        filestore,
        backendMountId,
        backendMountKey,
        planPath,
        principal,
        `${loadedPlan.planId}-start`
      )
    );

    const outcomes: PartitionRunOutcome[] = [];
    for (const execution of executions) {
      const outcome = await processPartition(context, coreWorkflows, loadedPlan, execution.calibration, execution.partition, {
        workflowSlug: ingestWorkflowSlug,
        principal,
        idempotencyKeyPrefix: idempotencyPrefix,
        pollIntervalMs
      });
      outcomes.push(outcome);

      await queuePlanPersist(() =>
        enqueuePlanPersistence(
          loadedPlan,
          filestore,
          backendMountId,
          backendMountKey,
          planPath,
          principal,
          `${loadedPlan.planId}-partition-${sanitizeIdentifier(execution.partition.partitionKey ?? execution.partition.minute, execution.partition.minute)}`
        )
      );

      // Progress metrics captured for result payload; context update not available.
    }

    const summary = computeResultSummary(outcomes);
    loadedPlan.state = summary.failed > 0 ? 'failed' : 'completed';
    await queuePlanPersist(() =>
      enqueuePlanPersistence(
        loadedPlan,
        filestore,
        backendMountId,
        backendMountKey,
        planPath,
        principal,
        `${loadedPlan.planId}-final`
      )
    );

    await upsertPlanMetastoreRecord(metastoreCapability, loadedPlan, summary, principal).catch((error) => {
      context.logger.warn('Failed to upsert calibration reprocess plan metastore record', {
        planId: loadedPlan.planId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    const result: CalibrationReprocessorResult = {
      planId: loadedPlan.planId,
      planPath,
      planNodeId: loadedPlan.storage.nodeId ?? resolvedPlanNodeId ?? planNodeIdParam ?? null,
      processedPartitions: summary.processed,
      succeededPartitions: summary.succeeded,
      failedPartitions: summary.failed,
      mode,
      state: loadedPlan.state,
      runs: outcomes.map((outcome) => ({
        partitionKey: outcome.partitionKey,
        minute: outcome.minute,
        runId: outcome.runId,
        status: outcome.status,
        errorMessage: outcome.errorMessage ?? null
      })),
      assets: [
        {
          assetId: 'observatory.reprocess.plan',
          partitionKey: loadedPlan.planId,
          producedAt: loadedPlan.updatedAt,
          payload: {
            planId: loadedPlan.planId,
            state: loadedPlan.state,
            updatedAt: loadedPlan.updatedAt,
            summary: loadedPlan.summary,
            storage: loadedPlan.storage,
            resultSummary: summary
          }
        }
      ]
    };

    return result;
  }
});

export default calibrationReprocessorJob;
