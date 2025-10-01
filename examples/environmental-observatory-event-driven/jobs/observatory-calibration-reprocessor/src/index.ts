import { FilestoreClient } from '@apphub/filestore-client';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();

import { uploadTextFile } from '../../shared/filestore';
import {
  calibrationReprocessPlanSchema,
  CalibrationPlanCalibration,
  CalibrationPlanPartition,
  CalibrationReprocessPlan,
  JsonValue,
  buildPlanSummary,
  computePartitionStateCounts
} from '../../shared/plans';

const DEFAULT_JOB_SLUG = 'observatory-calibration-reprocessor';
const DEFAULT_PLAN_VERSION = 1;
const DEFAULT_METASTORE_NAMESPACE = 'observatory.reprocess.plans';
const DEFAULT_POLL_INTERVAL_MS = 1500;
const USER_AGENT = 'observatory-calibration-reprocessor/0.1.0';

type JobRunStatus = 'succeeded' | 'failed' | 'canceled' | 'expired';

type JobRunResult = {
  status?: JobRunStatus;
  result?: unknown;
  errorMessage?: string | null;
};

type JobRunContext = {
  parameters: unknown;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  update: (updates: Record<string, unknown>) => Promise<void>;
};

type ReprocessorParameters = {
  planPath: string | null;
  planNodeId: number | null;
  planId: string | null;
  mode: 'all' | 'selected';
  selectedPartitions: string[];
  pollIntervalMs: number;
  coreBaseUrl: string;
  coreApiToken?: string;
  ingestWorkflowSlug: string;
  filestoreBaseUrl: string;
  filestoreBackendId: number;
  filestoreToken?: string;
  filestorePrincipal?: string;
  metastoreBaseUrl?: string | null;
  metastoreNamespace?: string | null;
  metastoreAuthToken?: string | null;
};

type PartitionExecution = {
  calibration: CalibrationPlanCalibration;
  partition: CalibrationPlanPartition;
};

type PartitionRunOutcome = {
  calibrationId: string;
  partitionKey: string | null;
  minute: string;
  runId: string | null;
  status: 'succeeded' | 'failed';
  errorMessage?: string | null;
};

type CoreRunRecord = {
  id: string;
  status: string;
  runKey: string | null;
  partitionKey: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  triggeredBy: string | null;
};

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

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeMinuteKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  let candidate = trimmed;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}:00`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}T00:00`;
  } else if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}`;
  }
  const isoCandidate = candidate.endsWith('Z') ? candidate : `${candidate}:00Z`;
  const date = new Date(isoCandidate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getUTCFullYear().toString().padStart(4, '0');
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const day = date.getUTCDate().toString().padStart(2, '0');
  const hour = date.getUTCHours().toString().padStart(2, '0');
  const minute = date.getUTCMinutes().toString().padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function sanitizeIdentifier(value: string | null | undefined, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return fallback;
  }
  const normalized = raw
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return normalized || fallback;
}

function parseMode(value: unknown): 'all' | 'selected' {
  const normalized = ensureString(value).toLowerCase();
  return normalized === 'selected' ? 'selected' : 'all';
}

function parseParameters(raw: unknown): ReprocessorParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const planPath = ensureString(raw.planPath ?? raw.plan_path ?? '').trim();
  const planNodeId = ensureNumber(raw.planNodeId ?? raw.plan_node_id);
  if (!planPath && !planNodeId) {
    throw new Error('planPath or planNodeId must be provided');
  }

  const planIdRaw = ensureString(raw.planId ?? raw.plan_id ?? '');
  const planId = planIdRaw ? sanitizeIdentifier(planIdRaw, planIdRaw) : null;
  const mode = parseMode(raw.mode);
  const selected = Array.isArray(raw.selectedPartitions ?? raw.selected_partitions)
    ? (raw.selectedPartitions ?? raw.selected_partitions)
    : [];
  const selectedPartitions = selected
    .map((entry) => ensureString(entry))
    .filter((entry) => entry.length > 0);

  const pollIntervalCandidate = ensureNumber(raw.pollIntervalMs ?? raw.poll_interval_ms);
  const pollIntervalMs = pollIntervalCandidate && pollIntervalCandidate >= 250
    ? Math.min(pollIntervalCandidate, 10_000)
    : DEFAULT_POLL_INTERVAL_MS;

  const coreBaseUrl = normalizeBaseUrl(
    ensureString(raw.coreBaseUrl ?? raw.core_base_url ?? 'http://127.0.0.1:4000')
  );
  if (!coreBaseUrl) {
    throw new Error('coreBaseUrl is required');
  }

  const ingestWorkflowSlug = ensureString(
    raw.ingestWorkflowSlug ?? raw.ingest_workflow_slug ?? 'observatory-minute-ingest'
  );
  if (!ingestWorkflowSlug) {
    throw new Error('ingestWorkflowSlug is required');
  }

  const filestoreBaseUrl = normalizeBaseUrl(
    ensureString(raw.filestoreBaseUrl ?? raw.filestore_base_url ?? 'http://127.0.0.1:4300')
  );
  if (!filestoreBaseUrl) {
    throw new Error('filestoreBaseUrl is required');
  }
  const filestoreBackendId = ensureNumber(
    raw.filestoreBackendId ?? raw.filestore_backend_id ?? raw.backendMountId ?? raw.backend_mount_id
  );
  if (!filestoreBackendId || filestoreBackendId <= 0) {
    throw new Error('filestoreBackendId must be a positive number');
  }

  const metastoreNamespace = ensureString(
    raw.metastoreNamespace ?? raw.metastore_namespace ?? DEFAULT_METASTORE_NAMESPACE
  );

  return {
    planPath: planPath || null,
    planNodeId: planNodeId ?? null,
    planId: planId || null,
    mode,
    selectedPartitions,
    pollIntervalMs,
    coreBaseUrl,
    coreApiToken: ensureString(raw.coreApiToken ?? raw.core_api_token ?? ''),
    ingestWorkflowSlug,
    filestoreBaseUrl,
    filestoreBackendId,
    filestoreToken: ensureString(raw.filestoreToken ?? raw.filestore_token ?? ''),
    filestorePrincipal: ensureString(raw.filestorePrincipal ?? raw.filestore_principal ?? ''),
    metastoreBaseUrl: ensureString(raw.metastoreBaseUrl ?? raw.metastore_base_url ?? '') || null,
    metastoreNamespace: metastoreNamespace || null,
    metastoreAuthToken: ensureString(raw.metastoreAuthToken ?? raw.metastore_auth_token ?? '') || null
  } satisfies ReprocessorParameters;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else if (chunk instanceof Buffer) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadPlan(
  parameters: ReprocessorParameters,
  client: FilestoreClient,
  context: JobRunContext
): Promise<CalibrationReprocessPlan> {
  let content: string;
  if (parameters.planNodeId) {
    const download = await client.downloadFile(parameters.planNodeId, {
      principal: parameters.filestorePrincipal || undefined
    });
    content = await readStream(download.stream);
  } else {
    const normalizedPath = (parameters.planPath ?? '').replace(/^\/+/, '').replace(/\/+$/g, '');
    const node = await client.getNodeByPath({
      backendMountId: parameters.filestoreBackendId,
      path: normalizedPath
    });
    const download = await client.downloadFile(node.id, {
      principal: parameters.filestorePrincipal || undefined
    });
    content = await readStream(download.stream);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    context.logger('Failed to parse plan JSON', { error: error instanceof Error ? error.message : String(error) });
    throw new Error('Plan file is not valid JSON');
  }

  const plan = calibrationReprocessPlanSchema.parse(parsed);
  return plan;
}

function normalizePlanPath(planPath: string | null, plan: CalibrationReprocessPlan): string {
  const candidate = planPath && planPath.trim().length > 0 ? planPath : plan.storage.planPath;
  if (!candidate || candidate.trim().length === 0) {
    throw new Error('Plan path could not be determined from parameters or plan storage');
  }
  return candidate.replace(/^\/+/, '').replace(/\/+$/g, '');
}

function buildSelectionSet(selected: string[]): {
  raw: Set<string>;
  minutes: Set<string>;
  instrumentMinutes: Set<string>;
} {
  const rawSet = new Set<string>();
  const minuteSet = new Set<string>();
  const instrumentMinutes = new Set<string>();
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
      instrumentMinutes.add(trimmed);
    }
  }
  return { raw: rawSet, minutes: minuteSet, instrumentMinutes };
}

function selectPartitions(
  plan: CalibrationReprocessPlan,
  parameters: ReprocessorParameters,
  context: JobRunContext
): PartitionExecution[] {
  const selections = buildSelectionSet(parameters.selectedPartitions);
  const matches = new Set<string>();
  const executions: PartitionExecution[] = [];

  for (const calibration of plan.calibrations) {
    for (const partition of calibration.partitions) {
      if (parameters.mode === 'selected') {
        const minuteMatch = selections.minutes.has(partition.minute);
        const partitionKeyMatch = selections.raw.has(partition.partitionKey ?? '');
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
        // Skip already completed partitions when processing everything.
        continue;
      }

      executions.push({ calibration, partition });
    }
  }

  if (parameters.mode === 'selected') {
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
      context.logger('Some selected partitions were not found in the plan', { unmatched });
    }
  }

  return executions;
}

function cloneParameters(parameters: Record<string, JsonValue> | null | undefined): Record<string, JsonValue> {
  if (!parameters || typeof parameters !== 'object') {
    return {};
  }
  return JSON.parse(JSON.stringify(parameters)) as Record<string, JsonValue>;
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

function updatePartitionStatus(
  partition: CalibrationPlanPartition,
  updates: Partial<CalibrationPlanPartition['status']>
): void {
  const merged = {
    ...partition.status,
    ...updates,
    updatedAt: new Date().toISOString()
  };
  partition.status = merged;
}

function appendCalibrationContext(
  parameters: Record<string, JsonValue>,
  plan: CalibrationReprocessPlan,
  calibration: CalibrationPlanCalibration,
  partition: CalibrationPlanPartition
): Record<string, JsonValue> {
  const contextKey = 'calibrationPlanContext';
  parameters[contextKey] = {
    planId: plan.planId,
    calibrationId: calibration.target.calibrationId,
    instrumentId: calibration.target.instrumentId,
    targetEffectiveAt: calibration.target.effectiveAt,
    partitionKey: partition.partitionKey,
    minute: partition.minute
  } satisfies Record<string, JsonValue> as JsonValue;
  return parameters;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function enqueuePlanPersistence(
  plan: CalibrationReprocessPlan,
  parameters: ReprocessorParameters,
  client: FilestoreClient,
  planPath: string,
  principal: string | undefined,
  idempotencyKey: string
): Promise<void> {
  refreshPlanSummaries(plan);
  plan.updatedAt = new Date().toISOString();

  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  const node = await uploadTextFile({
    client,
    backendMountId: parameters.filestoreBackendId,
    path: planPath,
    content: serialized,
    contentType: 'application/json; charset=utf-8',
    principal,
    idempotencyKey
  });
  if (node.id) {
    plan.storage.nodeId = node.id;
  }
}

let planPersistChain: Promise<void> = Promise.resolve();

function queuePlanPersist(task: () => Promise<void>): Promise<void> {
  planPersistChain = planPersistChain.then(task, task);
  return planPersistChain;
}

async function upsertPlanMetastoreRecord(
  parameters: ReprocessorParameters,
  plan: CalibrationReprocessPlan,
  context: JobRunContext,
  resultSummary: { processed: number; succeeded: number; failed: number }
): Promise<void> {
  if (!parameters.metastoreBaseUrl || !plan.storage.metastore) {
    return;
  }

  const baseUrl = normalizeBaseUrl(parameters.metastoreBaseUrl);
  const url = `${baseUrl}/records/${encodeURIComponent(plan.storage.metastore.namespace)}/${encodeURIComponent(plan.storage.metastore.recordKey)}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': USER_AGENT
  };
  if (parameters.metastoreAuthToken) {
    headers.authorization = `Bearer ${parameters.metastoreAuthToken}`;
  }

  const payload = {
    metadata: {
      planId: plan.planId,
      state: plan.state,
      updatedAt: plan.updatedAt,
      createdAt: plan.createdAt,
      partitionCount: plan.summary.partitionCount,
      instrumentCount: plan.summary.instrumentCount,
      calibrationCount: plan.summary.calibrationCount,
      processedPartitions: resultSummary.processed,
      succeededPartitions: resultSummary.succeeded,
      failedPartitions: resultSummary.failed,
      downstreamWorkflows: plan.downstreamWorkflows,
      storage: plan.storage,
      calibrations: plan.calibrations.map((entry) => ({
        calibrationId: entry.target.calibrationId,
        instrumentId: entry.target.instrumentId,
        effectiveAt: entry.target.effectiveAt,
        metastoreVersion: entry.target.metastoreVersion ?? null,
        partitionCount: entry.summary.partitionCount,
        stateCounts: entry.summary.stateCounts ?? null
      }))
    }
  } satisfies Record<string, unknown>;

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    context.logger('Failed to update plan metastore record', {
      namespace: plan.storage.metastore.namespace,
      recordKey: plan.storage.metastore.recordKey,
      status: response.status,
      error: detail
    });
  }
}

async function enqueueWorkflowRun(
  parameters: ReprocessorParameters,
  plan: CalibrationReprocessPlan,
  calibration: CalibrationPlanCalibration,
  partition: CalibrationPlanPartition,
  partitionParameters: Record<string, JsonValue>
): Promise<CoreRunRecord> {
  const runUrl = `${parameters.coreBaseUrl}/workflows/${encodeURIComponent(parameters.ingestWorkflowSlug)}/run`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': USER_AGENT
  };
  if (parameters.coreApiToken) {
    headers.authorization = `Bearer ${parameters.coreApiToken}`;
  }

  const partitionKeyFromParameters = ensureString(
    partitionParameters.partitionKey ?? partitionParameters.partition_key ?? ''
  );
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

  const response = await fetch(runUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      partitionKey,
      parameters: partitionParameters,
      triggeredBy: `${DEFAULT_JOB_SLUG}:${plan.planId}`,
      runKey
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to enqueue ingest workflow run: ${detail}`);
  }

  const payload = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown> };
  const data = isRecord(payload.data) ? payload.data : {};
  const runId = ensureString(data.id ?? data.runId ?? '');
  if (!runId) {
    throw new Error('Run ID missing from ingest workflow response');
  }

  return {
    id: runId,
    status: ensureString(data.status ?? 'pending') || 'pending',
    runKey: ensureString(data.runKey ?? '') || null,
    partitionKey: ensureString(data.partitionKey ?? partitionKey) || null,
    errorMessage: ensureString(data.errorMessage ?? ''),
    startedAt: ensureString(data.startedAt ?? ''),
    completedAt: ensureString(data.completedAt ?? ''),
    triggeredBy: ensureString(data.triggeredBy ?? '') || null
  } satisfies CoreRunRecord;
}

async function fetchWorkflowRun(
  parameters: ReprocessorParameters,
  runId: string
): Promise<CoreRunRecord> {
  const url = `${parameters.coreBaseUrl}/workflow-runs/${encodeURIComponent(runId)}`;
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': USER_AGENT
  };
  if (parameters.coreApiToken) {
    headers.authorization = `Bearer ${parameters.coreApiToken}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`Failed to fetch workflow run ${runId}: ${detail}`);
  }

  const payload = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown> };
  const data = isRecord(payload.data) ? payload.data : {};
  return {
    id: ensureString(data.id ?? runId),
    status: ensureString(data.status ?? ''),
    runKey: ensureString(data.runKey ?? '') || null,
    partitionKey: ensureString(data.partitionKey ?? '') || null,
    errorMessage: ensureString(data.errorMessage ?? '') || null,
    startedAt: ensureString(data.startedAt ?? '') || null,
    completedAt: ensureString(data.completedAt ?? '') || null,
    triggeredBy: ensureString(data.triggeredBy ?? '') || null
  } satisfies CoreRunRecord;
}

async function processPartitionExecution(
  parameters: ReprocessorParameters,
  plan: CalibrationReprocessPlan,
  calibration: CalibrationPlanCalibration,
  partition: CalibrationPlanPartition,
  client: FilestoreClient,
  planPath: string,
  principal: string | undefined,
  pollIntervalMs: number,
  context: JobRunContext
): Promise<PartitionRunOutcome> {
  const partitionParameters = cloneParameters(partition.parameters);
  let queuedRun: CoreRunRecord | null = null;

 try {
   queuedRun = await enqueueWorkflowRun(parameters, plan, calibration, partition, partitionParameters);
 } catch (error) {
   const message = error instanceof Error ? error.message : String(error);
    const attempts = (partition.status.attempts ?? 0) + 1;
    updatePartitionStatus(partition, {
      state: 'failed',
      runStatus: 'failed',
      runId: null,
      message,
      attempts,
      lastErrorAt: new Date().toISOString()
    });
    await queuePlanPersist(() =>
      enqueuePlanPersistence(plan, parameters, client, planPath, principal, `${plan.planId}-enqueue-error`)
    );
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
    runStartedAt: queuedRun.startedAt,
    runCompletedAt: queuedRun.completedAt,
    message: null,
    attempts: (partition.status.attempts ?? 0) + 1
  });

  await queuePlanPersist(() =>
    enqueuePlanPersistence(plan, parameters, client, planPath, principal, `${plan.planId}-queued-${queuedRun?.id ?? 'unknown'}`)
  );

  let finalStatus: PartitionRunOutcome['status'] = 'failed';
  let finalError: string | null = null;

  while (true) {
    await delay(pollIntervalMs);
    let runRecord: CoreRunRecord;
    try {
      runRecord = await fetchWorkflowRun(parameters, queuedRun.id);
    } catch (error) {
      finalError = error instanceof Error ? error.message : String(error);
      context.logger('Failed to poll workflow run status', {
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
      await queuePlanPersist(() =>
        enqueuePlanPersistence(plan, parameters, client, planPath, principal, `${plan.planId}-running-${queuedRun.id}`)
      );
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
      await queuePlanPersist(() =>
        enqueuePlanPersistence(plan, parameters, client, planPath, principal, `${plan.planId}-final-${queuedRun.id}`)
      );
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

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  try {
    planPersistChain = Promise.resolve();
    const parameters = parseParameters(context.parameters);
    const filestoreClient = new FilestoreClient({
      baseUrl: parameters.filestoreBaseUrl,
      token: parameters.filestoreToken || undefined,
      userAgent: USER_AGENT
    });

    let plan = await loadPlan(parameters, filestoreClient, context);
    const planPath = normalizePlanPath(parameters.planPath, plan);
    plan.storage.planPath = planPath;

    if (parameters.planId && parameters.planId !== plan.planId) {
      throw new Error(
        `Plan identifier mismatch: expected ${parameters.planId}, loaded ${plan.planId}`
      );
    }

    if (!plan.storage.metastore) {
      plan.storage.metastore = {
        namespace: parameters.metastoreNamespace ?? DEFAULT_METASTORE_NAMESPACE,
        recordKey: sanitizeIdentifier(plan.planId, plan.planId)
      };
    }

    const targets = selectPartitions(plan, parameters, context);

    if (targets.length === 0) {
      context.logger('No partitions selected for reprocessing', {
        planId: plan.planId,
        mode: parameters.mode
      });
      plan.state = 'completed';
      refreshPlanSummaries(plan);
      await queuePlanPersist(() =>
        enqueuePlanPersistence(
          plan,
          parameters,
          filestoreClient,
          planPath,
          parameters.filestorePrincipal || undefined,
          `${plan.planId}-no-op`
        )
      );
      await upsertPlanMetastoreRecord(parameters, plan, context, {
        processed: 0,
        succeeded: 0,
        failed: 0
      });
      return {
        status: 'succeeded',
        result: {
          planId: plan.planId,
          planPath,
          processedPartitions: 0,
          succeeded: 0,
          failed: 0,
          mode: parameters.mode,
          state: plan.state,
          runs: [],
          assets: [
            {
              assetId: 'observatory.reprocess.plan',
              partitionKey: plan.planId,
              producedAt: plan.updatedAt,
              payload: {
                planId: plan.planId,
                state: plan.state,
                updatedAt: plan.updatedAt,
                summary: plan.summary,
                storage: plan.storage
              }
            }
          ]
        }
      } satisfies JobRunResult;
    }

    plan.state = 'in_progress';
    await queuePlanPersist(() =>
      enqueuePlanPersistence(
        plan,
        parameters,
        filestoreClient,
        planPath,
        parameters.filestorePrincipal || undefined,
        `${plan.planId}-start`
      )
    );

    const outcomes: PartitionRunOutcome[] = [];

    for (const execution of targets) {
      const outcome = await processPartitionExecution(
        parameters,
        plan,
        execution.calibration,
        execution.partition,
        filestoreClient,
        planPath,
        parameters.filestorePrincipal || undefined,
        parameters.pollIntervalMs,
        context
      );
      outcomes.push(outcome);
    }

    const summary = computeResultSummary(outcomes);
    plan.state = summary.failed > 0 ? 'failed' : 'completed';
    await queuePlanPersist(() =>
      enqueuePlanPersistence(
        plan,
        parameters,
        filestoreClient,
        planPath,
        parameters.filestorePrincipal || undefined,
        `${plan.planId}-final`
      )
    );
    await upsertPlanMetastoreRecord(parameters, plan, context, summary);

    return {
      status: summary.failed > 0 ? 'failed' : 'succeeded',
      result: {
        planId: plan.planId,
        planPath,
        processedPartitions: summary.processed,
        succeeded: summary.succeeded,
        failed: summary.failed,
        mode: parameters.mode,
        state: plan.state,
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
            partitionKey: plan.planId,
            producedAt: plan.updatedAt,
            payload: {
              planId: plan.planId,
              state: plan.state,
              updatedAt: plan.updatedAt,
              summary: plan.summary,
              storage: plan.storage,
              resultSummary: summary
            }
          }
        ]
      }
    } satisfies JobRunResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger('Calibration reprocessing failed', { error: message });
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  }
}

export default handler;
