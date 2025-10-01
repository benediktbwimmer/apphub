import { randomUUID } from 'node:crypto';

import { FilestoreClient } from '@apphub/filestore-client';
import { ensureResolvedBackendId, uploadTextFile, DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../../shared/filestore';
import { enforceScratchOnlyWrites } from '../../shared/scratchGuard';

enforceScratchOnlyWrites();

import { toJsonRecord } from '../../shared/events';
import {
  calibrationReprocessPlanSchema,
  CalibrationPlanCalibration,
  CalibrationPlanDownstreamWorkflow,
  CalibrationPlanPartition,
  CalibrationPlanRecordedCalibration,
  CalibrationPlanTargetCalibration,
  CalibrationReprocessPlan,
  computePartitionStateCounts,
  createInitialPartitionStatus,
  buildPlanSummary
} from '../../shared/plans';

const DEFAULT_PLAN_VERSION = 1;
const DEFAULT_METASTORE_NAMESPACE = 'observatory.reprocess.plans';
const DEFAULT_JOB_SLUG = 'observatory-calibration-planner';

const minuteKeyFormatRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/;

const USER_AGENT = 'observatory-calibration-planner/0.1.0';

type PlannerCalibration = {
  calibrationId: string;
  instrumentId: string;
  effectiveAtIso: string;
  effectiveMinute: string;
  metastoreVersion: number | null;
};

type PlannerParameters = {
  calibrations: PlannerCalibration[];
  coreBaseUrl: string;
  coreApiToken?: string;
  ingestWorkflowSlug: string;
  ingestAssetId: string;
  downstreamWorkflows: CalibrationPlanDownstreamWorkflow[];
  plansPrefix: string;
  planId: string;
  planFileName: string;
  filestoreBaseUrl: string;
  filestoreBackendId: number | null;
  filestoreBackendKey: string;
  filestoreToken?: string;
  filestorePrincipal?: string;
  metastoreBaseUrl?: string | null;
  metastoreNamespace?: string | null;
  metastoreAuthToken?: string | null;
  lookback?: number;
};

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

type CorePartitionSummary = {
  partitionKey: string | null;
  materializations: number;
  latest: CorePartitionLatest | null;
  parameters: unknown;
};

type CorePartitionLatest = {
  runId: string | null;
  runStatus: string | null;
  stepId: string | null;
  stepStatus: string | null;
  producedAt: string | null;
  payload: Record<string, unknown> | null;
  partitionKey: string | null;
  runStartedAt: string | null;
  runCompletedAt: string | null;
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

function sanitizeFileName(value: string | null | undefined, fallbackBase: string): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return `${fallbackBase}.json`;
  }
  const withoutSlashes = raw.replace(/[\/]+/g, '-');
  const normalized = sanitizeIdentifier(withoutSlashes, fallbackBase);
  return normalized.endsWith('.json') ? normalized : `${normalized}.json`;
}

function normalizeMinuteKey(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  let candidate = trimmed;
  if (minuteKeyFormatRegex.test(trimmed)) {
    candidate = `${trimmed}:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}:00:00Z`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}T00:00:00Z`;
  } else if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(trimmed)) {
    candidate = `${trimmed}Z`;
  }
  const date = new Date(candidate);
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

function toEffectiveMinuteKey(effectiveAtIso: string): string {
  const minute = normalizeMinuteKey(effectiveAtIso);
  if (!minute) {
    throw new Error(`Invalid effectiveAt timestamp '${effectiveAtIso}'`);
  }
  return minute;
}

function normalizePlanPath(prefix: string, fileName: string): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const normalizedFile = fileName.replace(/^\/+/, '');
  return normalizedPrefix ? `${normalizedPrefix}/${normalizedFile}` : normalizedFile;
}

type RawCalibrationEntry = {
  calibrationId?: unknown;
  instrumentId?: unknown;
  instrument_id?: unknown;
  effectiveAt?: unknown;
  effective_at?: unknown;
  metastoreVersion?: unknown;
  metastore_version?: unknown;
};

function parseCalibrations(raw: unknown): PlannerCalibration[] {
  const candidates: unknown[] = [];
  if (Array.isArray(raw)) {
    candidates.push(...raw);
  } else if (isRecord(raw) && Array.isArray(raw.calibrations)) {
    candidates.push(...raw.calibrations);
  } else if (isRecord(raw) && raw.calibration) {
    candidates.push(raw.calibration);
  }

  if (candidates.length === 0) {
    throw new Error('At least one calibration must be provided');
  }

  return candidates.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Calibration at index ${index} must be an object`);
    }
    const instrumentId =
      ensureString(entry.instrumentId ?? entry.instrument_id ?? '').trim();
    if (!instrumentId) {
      throw new Error(`Calibration at index ${index} is missing instrumentId`);
    }
    const effectiveAtRaw = ensureString(entry.effectiveAt ?? entry.effective_at ?? '').trim();
    if (!effectiveAtRaw) {
      throw new Error(`Calibration at index ${index} is missing effectiveAt`);
    }
    const effectiveAtIso = new Date(effectiveAtRaw).toISOString();
    if (Number.isNaN(new Date(effectiveAtIso).getTime())) {
      throw new Error(`Calibration at index ${index} has invalid effectiveAt '${effectiveAtRaw}'`);
    }
    const calibrationId = sanitizeIdentifier(
      ensureString(entry.calibrationId ?? entry.calibration_id ?? ''),
      `${instrumentId}:${effectiveAtIso}`
    );
    const metastoreVersionRaw = entry.metastoreVersion ?? entry.metastore_version;
    const metastoreVersion = ensureNumber(metastoreVersionRaw);
    return {
      calibrationId,
      instrumentId,
      effectiveAtIso,
      effectiveMinute: toEffectiveMinuteKey(effectiveAtIso),
      metastoreVersion
    } satisfies PlannerCalibration;
  });
}

function parseDownstreamWorkflows(raw: unknown): CalibrationPlanDownstreamWorkflow[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const workflows: CalibrationPlanDownstreamWorkflow[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const workflowSlug = ensureString(entry.workflowSlug ?? entry.slug ?? '').trim();
    if (!workflowSlug) {
      continue;
    }
    const description = ensureString(entry.description ?? '');
    const assetIds: string[] = [];
    if (Array.isArray(entry.assetIds)) {
      for (const asset of entry.assetIds) {
        const assetId = ensureString(asset).trim();
        if (assetId) {
          assetIds.push(assetId);
        }
      }
    }
    workflows.push({
      workflowSlug,
      description: description || undefined,
      assetIds: assetIds.length > 0 ? assetIds : undefined
    });
  }
  return workflows;
}

function parseParameters(raw: unknown): PlannerParameters {
  if (!isRecord(raw)) {
    throw new Error('Parameters must be an object');
  }

  const calibrations = parseCalibrations(raw.calibrations ?? raw);
  const coreBaseUrl = normalizeBaseUrl(
    ensureString(raw.coreBaseUrl ?? raw.core_base_url ?? 'http://127.0.0.1:4000')
  );
  if (!coreBaseUrl) {
    throw new Error('coreBaseUrl is required');
  }
  const ingestWorkflowSlug = ensureString(
    raw.ingestWorkflowSlug ??
      raw.ingest_workflow_slug ??
      raw.workflowSlug ??
      'observatory-minute-ingest'
  );
  if (!ingestWorkflowSlug) {
    throw new Error('ingestWorkflowSlug is required');
  }
  const ingestAssetId = ensureString(
    raw.ingestAssetId ?? raw.assetId ?? 'observatory.timeseries.timestore'
  );
  if (!ingestAssetId) {
    throw new Error('ingestAssetId is required');
  }

  const plansPrefixRaw = ensureString(raw.plansPrefix ?? raw.plans_prefix ?? '').trim();
  if (!plansPrefixRaw) {
    throw new Error('plansPrefix is required');
  }
  const plansPrefix = plansPrefixRaw.replace(/^\/+|\/+$/g, '');
  if (!plansPrefix) {
    throw new Error('plansPrefix must not be empty');
  }

  const planIdFallback = `${ingestWorkflowSlug}-${randomUUID()}`;
  const planId = sanitizeIdentifier(raw.planId ?? raw.plan_id ?? '', planIdFallback);
  const planFileName = sanitizeFileName(raw.planFileName ?? raw.plan_file_name ?? '', planId);

  const filestoreBaseUrl = normalizeBaseUrl(
    ensureString(raw.filestoreBaseUrl ?? raw.filestore_base_url ?? 'http://127.0.0.1:4300')
  );
  if (!filestoreBaseUrl) {
    throw new Error('filestoreBaseUrl is required');
  }
  const filestoreBackendKey = ensureString(
    raw.filestoreBackendKey ??
      raw.filestore_backend_key ??
      raw.backendMountKey ??
      raw.backend_mount_key ??
      DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
    DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY
  );
  const filestoreBackendId = ensureNumber(
    raw.filestoreBackendId ?? raw.filestore_backend_id ?? raw.backendMountId ?? raw.backend_mount_id
  );
  if (!filestoreBackendKey) {
    throw new Error('filestoreBackendKey must be provided');
  }

  const downstreamWorkflows = parseDownstreamWorkflows(raw.downstreamWorkflows ?? raw.downstream_workflows);

  const metastoreBaseUrl = ensureString(raw.metastoreBaseUrl ?? raw.metastore_base_url ?? '').trim();
  const metastoreNamespace = ensureString(
    raw.metastoreNamespace ?? raw.metastore_namespace ?? DEFAULT_METASTORE_NAMESPACE
  );

  const lookback = ensureNumber(raw.lookback);
  const normalizedLookback = lookback && lookback > 0 ? Math.min(lookback, 10_000) : undefined;

  return {
    calibrations,
    coreBaseUrl,
    coreApiToken: ensureString(raw.coreApiToken ?? raw.core_api_token ?? ''),
    ingestWorkflowSlug,
    ingestAssetId,
    downstreamWorkflows,
    plansPrefix,
    planId,
    planFileName,
    filestoreBaseUrl,
    filestoreBackendId: filestoreBackendId ?? null,
    filestoreBackendKey,
    filestoreToken: ensureString(raw.filestoreToken ?? raw.filestore_token ?? ''),
    filestorePrincipal: ensureString(raw.filestorePrincipal ?? raw.filestore_principal ?? ''),
    metastoreBaseUrl: metastoreBaseUrl || null,
    metastoreNamespace: metastoreNamespace || null,
    metastoreAuthToken: ensureString(raw.metastoreAuthToken ?? raw.metastore_auth_token ?? ''),
    lookback: normalizedLookback
  } satisfies PlannerParameters;
}

async function fetchAssetPartitions(parameters: PlannerParameters): Promise<CorePartitionSummary[]> {
  const url = new URL(
    `/workflows/${encodeURIComponent(parameters.ingestWorkflowSlug)}/assets/${encodeURIComponent(parameters.ingestAssetId)}/partitions`,
    `${parameters.coreBaseUrl}/`
  );
  if (parameters.lookback && parameters.lookback > 0) {
    url.searchParams.set('lookback', String(parameters.lookback));
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': USER_AGENT
  };
  if (parameters.coreApiToken) {
    headers.authorization = `Bearer ${parameters.coreApiToken}`;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(
      `Failed to fetch ingest asset partitions (${response.status} ${response.statusText}): ${detail}`
    );
  }

  const payload = (await response.json().catch(() => ({}))) as {
    data?: { partitions?: unknown };
  };
  const partitionsRaw = Array.isArray(payload.data?.partitions) ? payload.data?.partitions : [];
  const partitions: CorePartitionSummary[] = [];
  for (const entry of partitionsRaw) {
    if (!isRecord(entry)) {
      continue;
    }
    const partitionKey = ensureString(entry.partitionKey ?? entry.partition_key ?? '') || null;
    const materializations = ensureNumber(entry.materializations ?? entry.count ?? 0) ?? 0;
    const rawLatest = isRecord(entry.latest) ? entry.latest : null;
    const latest: CorePartitionLatest | null = rawLatest
      ? {
          runId: ensureString(rawLatest.runId ?? rawLatest.run_id ?? '') || null,
          runStatus: ensureString(rawLatest.runStatus ?? rawLatest.run_status ?? '') || null,
          stepId: ensureString(rawLatest.stepId ?? rawLatest.step_id ?? '') || null,
          stepStatus: ensureString(rawLatest.stepStatus ?? rawLatest.step_status ?? '') || null,
          producedAt: ensureString(rawLatest.producedAt ?? rawLatest.produced_at ?? '') || null,
          payload: isRecord(rawLatest.payload) ? (rawLatest.payload as Record<string, unknown>) : null,
          partitionKey: ensureString(rawLatest.partitionKey ?? rawLatest.partition_key ?? '') || null,
          runStartedAt: ensureString(rawLatest.runStartedAt ?? rawLatest.run_started_at ?? '') || null,
          runCompletedAt: ensureString(rawLatest.runCompletedAt ?? rawLatest.run_completed_at ?? '') || null
        }
      : null;

    partitions.push({
      partitionKey,
      materializations,
      latest,
      parameters: entry.parameters ?? null
    });
  }
  return partitions;
}

function parseInstrumentId(
  payload: Record<string, unknown> | null,
  partitionKey: string | null
): string {
  const fromPayload = payload
    ? ensureString(
        payload.instrumentId ??
          payload.instrument_id ??
          (isRecord(payload.partitionKeyFields) ? payload.partitionKeyFields.instrument : undefined) ??
          ''
      )
    : '';
  if (fromPayload) {
    return fromPayload;
  }
  if (partitionKey) {
    const parts = partitionKey.split('|');
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 'instrument' && value) {
        return value.trim();
      }
    }
  }
  return '';
}

function parseWindowMinute(
  payload: Record<string, unknown> | null,
  partitionKey: string | null
): string | null {
  let candidate = payload && isRecord(payload.partitionKeyFields)
    ? ensureString((payload.partitionKeyFields as Record<string, unknown>).window ?? '')
    : '';
  if (!candidate && payload) {
    candidate = ensureString(payload.minute ?? payload.window ?? '');
  }
  if (!candidate && partitionKey) {
    const parts = partitionKey.split('|');
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 'window' && value) {
        candidate = value.trim();
        break;
      }
    }
  }
  return normalizeMinuteKey(candidate);
}

function parseDatasetSlug(payload: Record<string, unknown> | null): string {
  if (!payload) {
    return 'unknown';
  }
  const slug = ensureString(payload.datasetSlug ?? payload.dataset_slug ?? '').trim();
  return slug || 'unknown';
}

function parseRecordedCalibration(payload: Record<string, unknown> | null): CalibrationPlanRecordedCalibration {
  if (!payload) {
    return {
      calibrationId: null,
      instrumentId: null,
      effectiveAt: null,
      metastoreVersion: null
    };
  }
  const calibrationId = ensureString(payload.calibrationId ?? payload.calibration_id ?? '').trim() || null;
  const instrumentId = ensureString(payload.instrumentId ?? payload.instrument_id ?? '').trim() || null;
  const effectiveAtRaw = ensureString(
    payload.calibrationEffectiveAt ?? payload.calibration_effective_at ?? ''
  ).trim();
  const effectiveAt = effectiveAtRaw ? new Date(effectiveAtRaw).toISOString() : null;
  const metastoreVersion = ensureNumber(
    payload.calibrationMetastoreVersion ?? payload.calibration_metastore_version ?? null
  );
  return {
    calibrationId,
    instrumentId,
    effectiveAt,
    metastoreVersion: metastoreVersion ?? null
  } satisfies CalibrationPlanRecordedCalibration;
}

function parsePartitionParameters(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  return toJsonRecord(value);
}

type EvaluationResult = {
  include: boolean;
  reason: string | null;
};

function evaluateCalibrationMismatch(
  calibration: PlannerCalibration,
  recorded: CalibrationPlanRecordedCalibration,
  minuteMs: number,
  effectiveMs: number
): EvaluationResult {
  if (Number.isNaN(minuteMs) || Number.isNaN(effectiveMs)) {
    return { include: false, reason: 'timestamp_parse_failed' };
  }
  if (minuteMs < effectiveMs) {
    return { include: false, reason: 'before_effective_at' };
  }

  const reasons: string[] = [];
  if (!recorded.calibrationId) {
    reasons.push('no_calibration_recorded');
  } else if (recorded.calibrationId !== calibration.calibrationId) {
    reasons.push(`calibration_id_mismatch:${recorded.calibrationId}->${calibration.calibrationId}`);
  }

  if (calibration.metastoreVersion !== null) {
    if (recorded.metastoreVersion === null) {
      reasons.push(`calibration_version_missing->${calibration.metastoreVersion}`);
    } else if (recorded.metastoreVersion < calibration.metastoreVersion) {
      reasons.push(
        `calibration_version_outdated:${recorded.metastoreVersion}->${calibration.metastoreVersion}`
      );
    }
  }

  if (recorded.effectiveAt && recorded.effectiveAt !== calibration.effectiveAtIso) {
    reasons.push('calibration_effective_at_mismatch');
  }

  const include = reasons.length > 0;
  return {
    include,
    reason: include ? reasons.join(',') : 'up_to_date'
  };
}

function buildPartitionEntry(
  calibration: PlannerCalibration,
  partition: CorePartitionSummary,
  minute: string,
  datasetSlug: string,
  recordedCalibration: CalibrationPlanRecordedCalibration,
  latest: CorePartitionLatest | null,
  reason: string | null
): CalibrationPlanPartition {
  const status = createInitialPartitionStatus();
  const parameters = parsePartitionParameters(partition.parameters);
  const targetCalibration: CalibrationPlanTargetCalibration = {
    calibrationId: calibration.calibrationId,
    instrumentId: calibration.instrumentId,
    effectiveAt: calibration.effectiveAtIso,
    metastoreVersion: calibration.metastoreVersion
  };

  return {
    partitionKey: latest?.partitionKey ?? partition.partitionKey ?? `${datasetSlug}:${minute}`,
    minute,
    instrumentId: calibration.instrumentId,
    datasetSlug,
    recordedCalibration,
    targetCalibration,
    latestRun: latest
      ? {
          workflowRunId: latest.runId,
          status: latest.runStatus,
          startedAt: latest.runStartedAt,
          completedAt: latest.runCompletedAt
        }
      : null,
    parameters: parameters ?? null,
    status,
    notes: reason ?? undefined
  } satisfies CalibrationPlanPartition;
}

function deriveMetastoreRecordKey(planId: string): string {
  return sanitizeIdentifier(planId, planId);
}

function buildPlanStorage(parameters: PlannerParameters, planPath: string, planId: string) {
  const storage: CalibrationReprocessPlan['storage'] = {
    plansPrefix: parameters.plansPrefix,
    planPath,
    nodeId: undefined
  };
  if (parameters.metastoreBaseUrl) {
    storage.metastore = {
      namespace: parameters.metastoreNamespace ?? DEFAULT_METASTORE_NAMESPACE,
      recordKey: deriveMetastoreRecordKey(planId)
    };
  }
  return storage;
}

async function upsertPlanMetastoreRecord(
  parameters: PlannerParameters,
  plan: CalibrationReprocessPlan,
  context: JobRunContext
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
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      partitionCount: plan.summary.partitionCount,
      instrumentCount: plan.summary.instrumentCount,
      calibrationCount: plan.summary.calibrationCount,
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
    }
  } satisfies Record<string, unknown>;

  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    context.logger('Failed to upsert plan metastore record', {
      namespace: plan.storage.metastore.namespace,
      recordKey: plan.storage.metastore.recordKey,
      status: response.status,
      error: detail
    });
  }
}

function ensureCalibrationPartitions(
  calibration: PlannerCalibration,
  partitions: CorePartitionSummary[],
  context: JobRunContext
): CalibrationPlanPartition[] {
  const results: CalibrationPlanPartition[] = [];
  const effectiveMs = Date.parse(calibration.effectiveAtIso);

  for (const partition of partitions) {
    const latest = partition.latest;
    if (!latest || !latest.payload) {
      continue;
    }
    const instrumentId = parseInstrumentId(latest.payload, latest.partitionKey ?? partition.partitionKey ?? null);
    if (!instrumentId || instrumentId !== calibration.instrumentId) {
      continue;
    }
    const windowMinute = parseWindowMinute(latest.payload, latest.partitionKey ?? partition.partitionKey ?? null);
    if (!windowMinute) {
      continue;
    }

    const minuteIso = `${windowMinute}:00Z`;
    const minuteMs = Date.parse(minuteIso);

    const recordedCalibration = parseRecordedCalibration(latest.payload);
    const evaluation = evaluateCalibrationMismatch(calibration, recordedCalibration, minuteMs, effectiveMs);

    if (!evaluation.include) {
      continue;
    }

    const datasetSlug = parseDatasetSlug(latest.payload);
    const partitionEntry = buildPartitionEntry(
      calibration,
      partition,
      windowMinute,
      datasetSlug,
      recordedCalibration,
      latest,
      evaluation.reason
    );
    results.push(partitionEntry);
  }

  if (results.length === 0) {
    context.logger('No stale partitions detected for calibration', {
      calibrationId: calibration.calibrationId,
      instrumentId: calibration.instrumentId,
      effectiveAt: calibration.effectiveAtIso
    });
  }

  return results;
}

function buildCalibrationEntries(
  parameters: PlannerParameters,
  partitions: CorePartitionSummary[],
  requestTimestamp: string,
  context: JobRunContext
): CalibrationPlanCalibration[] {
  const entries: CalibrationPlanCalibration[] = [];
  for (const calibration of parameters.calibrations) {
    const matchingPartitions = ensureCalibrationPartitions(calibration, partitions, context);
    const summary = {
      partitionCount: matchingPartitions.length,
      stateCounts: computePartitionStateCounts(matchingPartitions)
    };
    entries.push({
      target: {
        calibrationId: calibration.calibrationId,
        instrumentId: calibration.instrumentId,
        effectiveAt: calibration.effectiveAtIso,
        metastoreVersion: calibration.metastoreVersion
      },
      requestedAt: requestTimestamp,
      effectiveFromMinute: calibration.effectiveMinute,
      partitions: matchingPartitions,
      summary
    });
  }
  return entries;
}

async function materializePlanArtifact(
  plan: CalibrationReprocessPlan,
  parameters: PlannerParameters,
  path: string
): Promise<CalibrationReprocessPlan> {
  const client = new FilestoreClient({
    baseUrl: parameters.filestoreBaseUrl,
    token: parameters.filestoreToken || undefined,
    userAgent: USER_AGENT
  });
  const backendMountId = await ensureResolvedBackendId(client, parameters);

  const serializedInitial = `${JSON.stringify(plan, null, 2)}\n`;
  const firstUpload = await uploadTextFile({
    client,
    backendMountId,
    backendMountKey: parameters.filestoreBackendKey,
    path,
    content: serializedInitial,
    contentType: 'application/json; charset=utf-8',
    principal: parameters.filestorePrincipal || undefined,
    idempotencyKey: `${plan.planId}-v${plan.planVersion}-initial`
  });

  const updatedPlan: CalibrationReprocessPlan = {
    ...plan,
    storage: {
      ...plan.storage,
      nodeId: firstUpload.id ?? plan.storage.nodeId
    },
    updatedAt: new Date().toISOString()
  };

  const serializedFinal = `${JSON.stringify(updatedPlan, null, 2)}\n`;
  if (serializedFinal !== serializedInitial) {
    const secondUpload = await uploadTextFile({
      client,
      backendMountId,
      backendMountKey: parameters.filestoreBackendKey,
      path,
      content: serializedFinal,
      contentType: 'application/json; charset=utf-8',
      principal: parameters.filestorePrincipal || undefined,
      idempotencyKey: `${plan.planId}-v${plan.planVersion}-final`
    });
    if (secondUpload.id) {
      updatedPlan.storage.nodeId = secondUpload.id;
    }
  }

  return updatedPlan;
}

export async function handler(context: JobRunContext): Promise<JobRunResult> {
  try {
    const parameters = parseParameters(context.parameters);
    const planPath = normalizePlanPath(parameters.plansPrefix, parameters.planFileName);
    const requestTimestamp = new Date().toISOString();

    const partitions = await fetchAssetPartitions(parameters);
    const calibrationEntries = buildCalibrationEntries(parameters, partitions, requestTimestamp, context);

    const plan: CalibrationReprocessPlan = calibrationReprocessPlanSchema.parse({
      planId: parameters.planId,
      planVersion: DEFAULT_PLAN_VERSION,
      state: 'pending',
      createdAt: requestTimestamp,
      updatedAt: requestTimestamp,
      ingestWorkflowSlug: parameters.ingestWorkflowSlug,
      ingestAssetId: parameters.ingestAssetId,
      downstreamWorkflows: parameters.downstreamWorkflows,
      calibrations: calibrationEntries,
      summary: buildPlanSummary(calibrationEntries),
      storage: buildPlanStorage(parameters, planPath, parameters.planId),
      metadata: {
        createdBy: {
          jobSlug: DEFAULT_JOB_SLUG
        }
      }
    });

    const materializedPlan = await materializePlanArtifact(plan, parameters, planPath);

    await context.update({
      planId: materializedPlan.planId,
      partitionCount: materializedPlan.summary.partitionCount,
      calibrationCount: materializedPlan.summary.calibrationCount
    });

    await upsertPlanMetastoreRecord(parameters, materializedPlan, context).catch(() => undefined);

    return {
      status: 'succeeded',
      result: {
        planId: materializedPlan.planId,
        planPath: materializedPlan.storage.planPath,
        planNodeId: materializedPlan.storage.nodeId ?? null,
        partitionCount: materializedPlan.summary.partitionCount,
        instrumentCount: materializedPlan.summary.instrumentCount,
        calibrationCount: materializedPlan.summary.calibrationCount,
        state: materializedPlan.state,
        storage: {
          plansPrefix: materializedPlan.storage.plansPrefix ?? null,
          planPath: materializedPlan.storage.planPath,
          nodeId: materializedPlan.storage.nodeId ?? null
        },
        summary: {
          partitionCount: materializedPlan.summary.partitionCount,
          instrumentCount: materializedPlan.summary.instrumentCount,
          calibrationCount: materializedPlan.summary.calibrationCount
        },
        assets: [
          {
            assetId: 'observatory.reprocess.plan',
            partitionKey: materializedPlan.planId,
            producedAt: materializedPlan.updatedAt,
            payload: {
              planId: materializedPlan.planId,
              state: materializedPlan.state,
              createdAt: materializedPlan.createdAt,
              updatedAt: materializedPlan.updatedAt,
              partitionCount: materializedPlan.summary.partitionCount,
              instrumentCount: materializedPlan.summary.instrumentCount,
              calibrationCount: materializedPlan.summary.calibrationCount,
              downstreamWorkflows: materializedPlan.downstreamWorkflows,
              storage: materializedPlan.storage
            }
          }
        ]
      }
    } satisfies JobRunResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    context.logger('Calibration planning failed', { error: message });
    return {
      status: 'failed',
      errorMessage: message
    } satisfies JobRunResult;
  }
}

export default handler;
