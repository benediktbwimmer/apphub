import { randomUUID } from 'node:crypto';

import {
  CapabilityRequestError,
  createCoreWorkflowsCapability,
  createJobHandler,
  createMetastoreCapability,
  selectCoreWorkflows,
  selectEventBus,
  selectFilestore,
  selectMetastore,
  inheritModuleSettings,
  inheritModuleSecrets,
  type CoreWorkflowsCapability,
  type FilestoreCapability,
  type JobContext,
  type MetastoreCapability
} from '@apphub/module-sdk';
import { z } from 'zod';

import { ensureResolvedBackendId, uploadTextFile } from '@apphub/module-sdk';
import { DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY } from '../runtime';
import { createObservatoryEventPublisher, publishAssetMaterialized } from '../runtime/events';
import {
  buildPlanStorage,
  buildPlanSummary,
  calibrationPlanDownstreamWorkflowSchema,
  computePartitionStateCounts,
  createInitialPartitionStatus,
  deriveMetastoreRecordKey,
  normalizeMinuteKey,
  normalizePlanPath,
  sanitizeFileName,
  sanitizeIdentifier,
  toEffectiveMinuteKey,
  type JsonValue,
  type CalibrationPlanCalibration,
  type CalibrationPlanDownstreamWorkflow,
  type CalibrationPlanPartition,
  type CalibrationPlanRecordedCalibration,
  type CalibrationPlanTargetCalibration,
  type CalibrationReprocessPlan
} from '../runtime/plans';
import { toJsonRecord } from '../runtime/events';
import type { ObservatoryModuleSecrets, ObservatoryModuleSettings } from '../runtime/settings';

const DEFAULT_PLAN_VERSION = 1;
const MAX_LOOKBACK_MINUTES = 10_000;

const calibrationInputSchema = z
  .object({
    calibrationId: z.string().trim().min(1).optional(),
    instrumentId: z.string().trim().min(1),
    effectiveAt: z.string().trim().min(1),
    metastoreVersion: z.union([z.number().int(), z.string().trim()]).optional().nullable()
  })
  .strip();

const plannerOverridesSchema = z
  .object({
    calibrations: z.array(calibrationInputSchema).optional(),
    calibration: calibrationInputSchema.optional(),
    planId: z.string().trim().min(1).optional(),
    planIdFallback: z.string().trim().min(1).optional(),
    planFileName: z.string().trim().min(1).optional(),
    plansPrefix: z.string().trim().min(1).optional(),
    downstreamWorkflows: z.array(calibrationPlanDownstreamWorkflowSchema).optional(),
    lookbackMinutes: z.number().int().positive().optional(),
    ingestWorkflowSlug: z.string().trim().min(1).optional(),
    ingestAssetId: z.string().trim().min(1).optional(),
    metastoreNamespace: z.string().trim().min(1).optional(),
    metastoreBaseUrl: z.string().trim().min(1).optional(),
    coreBaseUrl: z.string().trim().min(1).optional(),
    filestoreBackendKey: z.string().trim().min(1).optional(),
    filestoreBackendId: z.number().int().positive().optional(),
    principal: z.string().trim().min(1).optional()
  })
  .strip();

type RawPlannerOverrides = z.infer<typeof plannerOverridesSchema>;

type PlannerCalibration = {
  calibrationId: string;
  instrumentId: string;
  effectiveAtIso: string;
  effectiveMinute: string;
  metastoreVersion: number | null;
};

type PlannerOverrides = {
  calibrations: PlannerCalibration[];
  planId?: string;
  planFileName?: string;
  plansPrefix?: string;
  downstreamWorkflows?: CalibrationPlanDownstreamWorkflow[];
  lookbackMinutes?: number;
  ingestWorkflowSlug?: string;
  ingestAssetId?: string;
  metastoreNamespace?: string;
  metastoreBaseUrl?: string;
  coreBaseUrl?: string;
  filestoreBackendKey?: string;
  filestoreBackendId?: number;
  principal?: string;
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

type CorePartitionSummary = {
  partitionKey: string | null;
  materializations: number;
  latest: CorePartitionLatest | null;
  parameters: unknown | null;
};

type CalibrationPlannerResult = {
  planId: string;
  planPath: string;
  planNodeId: number | null;
  partitionCount: number;
  instrumentCount: number;
  calibrationCount: number;
  state: CalibrationReprocessPlan['state'];
  storage: {
    plansPrefix: string | null;
    planPath: string;
    nodeId: number | null;
  };
  summary: {
    partitionCount: number;
    instrumentCount: number;
    calibrationCount: number;
  };
  assets: Array<{
    assetId: string;
    partitionKey: string;
    producedAt: string;
    payload: Record<string, unknown>;
  }>;
};

type CalibrationPlannerContext = JobContext<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  PlannerOverrides
>;

type EvaluationResult = {
  include: boolean;
  reason: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function ensureNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseCalibrations(raw: RawPlannerOverrides): PlannerCalibration[] {
  const candidates: unknown[] = [];
  if (Array.isArray(raw.calibrations)) {
    candidates.push(...raw.calibrations);
  }
  if (raw.calibration) {
    candidates.push(raw.calibration);
  }
  if (candidates.length === 0) {
    return [];
  }

  const calibrations: PlannerCalibration[] = [];
  candidates.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const record = entry as Record<string, unknown>;
    const instrumentRaw = typeof record.instrumentId === 'string' ? record.instrumentId.trim() : '';
    const effectiveRaw = typeof record.effectiveAt === 'string' ? record.effectiveAt.trim() : '';
    if (!instrumentRaw || !effectiveRaw) {
      return;
    }
    const calibrationIdRaw =
      typeof record.calibrationId === 'string' && record.calibrationId.trim().length > 0
        ? record.calibrationId.trim()
        : undefined;
    const parsed = calibrationInputSchema.safeParse({
      calibrationId: calibrationIdRaw,
      instrumentId: instrumentRaw,
      effectiveAt: effectiveRaw,
      metastoreVersion: record.metastoreVersion
    });
    if (!parsed.success) {
      return;
    }
    const effectiveAtIso = new Date(parsed.data.effectiveAt).toISOString();
    if (Number.isNaN(new Date(effectiveAtIso).getTime())) {
      return;
    }
    const fallbackId = `${parsed.data.instrumentId}:${effectiveAtIso}`;
    const calibrationId = sanitizeIdentifier(parsed.data.calibrationId ?? fallbackId, fallbackId);
    const metastoreVersion = ensureNumber(parsed.data.metastoreVersion) ?? null;
    calibrations.push({
      calibrationId,
      instrumentId: parsed.data.instrumentId,
      effectiveAtIso,
      effectiveMinute: toEffectiveMinuteKey(effectiveAtIso),
      metastoreVersion
    });
  });

  return calibrations;
}

function parseDownstreamWorkflows(raw: RawPlannerOverrides): CalibrationPlanDownstreamWorkflow[] {
  const entries = raw.downstreamWorkflows ?? [];
  if (!entries.length) {
    return [];
  }
  return entries.map((entry) => calibrationPlanDownstreamWorkflowSchema.parse(entry));
}

function resolvePlannerOverrides(raw: unknown): PlannerOverrides {
  const parsed = plannerOverridesSchema.parse(raw ?? {});
  const calibrations = parseCalibrations(parsed);
  const downstreamWorkflows = parseDownstreamWorkflows(parsed);
  const lookback = parsed.lookbackMinutes ? Math.min(parsed.lookbackMinutes, MAX_LOOKBACK_MINUTES) : undefined;

  return {
    calibrations,
    planId: parsed.planId,
    planFileName: parsed.planFileName,
    plansPrefix: parsed.plansPrefix,
    downstreamWorkflows,
    lookbackMinutes: lookback,
    ingestWorkflowSlug: parsed.ingestWorkflowSlug,
    ingestAssetId: parsed.ingestAssetId,
    metastoreNamespace: parsed.metastoreNamespace,
    metastoreBaseUrl: parsed.metastoreBaseUrl,
    coreBaseUrl: parsed.coreBaseUrl,
    filestoreBackendKey: parsed.filestoreBackendKey,
    filestoreBackendId: parsed.filestoreBackendId,
    principal: parsed.principal
  } satisfies PlannerOverrides;
}

function parseInstrumentId(payload: Record<string, unknown> | null, partitionKey: string | null): string {
  const direct = payload
    ? (payload.instrumentId ?? payload.instrument_id ??
        (isRecord(payload.partitionKeyFields) ? payload.partitionKeyFields.instrument : undefined))
    : undefined;
  const candidate = typeof direct === 'string' ? direct.trim() : '';
  if (candidate) {
    return candidate;
  }
  if (!partitionKey) {
    return '';
  }
  for (const part of partitionKey.split('|')) {
    const [key, value] = part.split('=');
    if (key === 'instrument' && value) {
      return value.trim();
    }
  }
  return '';
}

function parseWindowMinute(payload: Record<string, unknown> | null, partitionKey: string | null): string | null {
  let candidate: string | null = null;
  if (payload && isRecord(payload.partitionKeyFields)) {
    const windowField = payload.partitionKeyFields.window;
    if (typeof windowField === 'string') {
      candidate = windowField;
    }
  }
  if (!candidate && payload) {
    const minute = payload.minute ?? payload.window;
    if (typeof minute === 'string') {
      candidate = minute;
    }
  }
  if (!candidate && partitionKey) {
    for (const part of partitionKey.split('|')) {
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
  const slugCandidate = payload.datasetSlug ?? payload.dataset_slug;
  if (typeof slugCandidate === 'string' && slugCandidate.trim().length > 0) {
    return slugCandidate.trim();
  }
  return 'unknown';
}

function parseRecordedCalibration(payload: Record<string, unknown> | null): CalibrationPlanRecordedCalibration {
  if (!payload) {
    return {
      calibrationId: null,
      instrumentId: null,
      effectiveAt: null,
      metastoreVersion: null
    } satisfies CalibrationPlanRecordedCalibration;
  }
  const calibrationId =
    typeof payload.calibrationId === 'string'
      ? payload.calibrationId.trim()
      : typeof payload.calibration_id === 'string'
        ? payload.calibration_id.trim()
        : '';
  const instrumentId =
    typeof payload.instrumentId === 'string'
      ? payload.instrumentId.trim()
      : typeof payload.instrument_id === 'string'
        ? payload.instrument_id.trim()
        : '';
  const effectiveAtRaw =
    typeof payload.calibrationEffectiveAt === 'string'
      ? payload.calibrationEffectiveAt.trim()
      : typeof payload.calibration_effective_at === 'string'
        ? payload.calibration_effective_at.trim()
        : '';
  const effectiveAt = effectiveAtRaw ? new Date(effectiveAtRaw).toISOString() : null;
  const metastoreVersion = ensureNumber(
    payload.calibrationMetastoreVersion ?? payload.calibration_metastore_version ?? null
  );
  return {
    calibrationId: calibrationId || null,
    instrumentId: instrumentId || null,
    effectiveAt,
    metastoreVersion: metastoreVersion ?? null
  } satisfies CalibrationPlanRecordedCalibration;
}

function parsePartitionParameters(value: unknown): Record<string, JsonValue> | null {
  if (!isRecord(value)) {
    return null;
  }
  return toJsonRecord(value) as Record<string, JsonValue>;
}

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

  const recordedVersion = recorded.metastoreVersion ?? null;
  if (calibration.metastoreVersion !== null) {
    if (recordedVersion === null) {
      reasons.push(`calibration_version_missing->${calibration.metastoreVersion}`);
    } else if (recordedVersion < calibration.metastoreVersion) {
      reasons.push(
        `calibration_version_outdated:${recordedVersion}->${calibration.metastoreVersion}`
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

function ensureCalibrationPartitions(
  calibration: PlannerCalibration,
  partitions: CorePartitionSummary[],
  context: CalibrationPlannerContext
): CalibrationPlanPartition[] {
  const results: CalibrationPlanPartition[] = [];
  const effectiveMs = Date.parse(calibration.effectiveAtIso);

  for (const partition of partitions) {
    const latest = partition.latest;
    if (!latest || !latest.payload) {
      continue;
    }
    const instrumentId = parseInstrumentId(
      latest.payload,
      latest.partitionKey ?? partition.partitionKey ?? null
    );
    if (!instrumentId || instrumentId !== calibration.instrumentId) {
      continue;
    }
    const windowMinute = parseWindowMinute(
      latest.payload,
      latest.partitionKey ?? partition.partitionKey ?? null
    );
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
    context.logger.info('No stale partitions detected for calibration', {
      calibrationId: calibration.calibrationId,
      instrumentId: calibration.instrumentId,
      effectiveAt: calibration.effectiveAtIso
    });
  }

  return results;
}

function buildCalibrationEntries(
  overrides: PlannerOverrides,
  partitions: CorePartitionSummary[],
  requestTimestamp: string,
  context: CalibrationPlannerContext
): CalibrationPlanCalibration[] {
  return overrides.calibrations.map((calibration) => {
    const matchingPartitions = ensureCalibrationPartitions(calibration, partitions, context);
    const summary = {
      partitionCount: matchingPartitions.length,
      stateCounts: computePartitionStateCounts(matchingPartitions)
    };
    return {
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
    } satisfies CalibrationPlanCalibration;
  });
}

async function fetchAssetPartitions(
  capability: CoreWorkflowsCapability,
  options: {
    ingestWorkflowSlug: string;
    ingestAssetId: string;
    lookbackMinutes: number | null;
    principal?: string;
  }
): Promise<CorePartitionSummary[]> {
  try {
    const response = await capability.listAssetPartitions({
      workflowSlug: options.ingestWorkflowSlug,
      assetId: options.ingestAssetId,
      lookback: options.lookbackMinutes ?? undefined,
      principal: options.principal
    });

    const partitions: CorePartitionSummary[] = [];
    const partitionsRaw = Array.isArray(response?.data?.partitions)
      ? (response?.data?.partitions as unknown[])
      : [];

    for (const entry of partitionsRaw) {
      if (!isRecord(entry)) {
        continue;
      }
      const partitionKey =
        typeof entry.partitionKey === 'string'
          ? entry.partitionKey
          : typeof entry.partition_key === 'string'
            ? entry.partition_key
            : null;
      const materializations = ensureNumber(entry.materializations ?? entry.count ?? 0) ?? 0;
      const rawLatest = isRecord(entry.latest) ? entry.latest : null;
      const latest: CorePartitionLatest | null = rawLatest
        ? {
            runId:
              typeof rawLatest.runId === 'string'
                ? rawLatest.runId
                : typeof rawLatest.run_id === 'string'
                  ? rawLatest.run_id
                  : null,
            runStatus:
              typeof rawLatest.runStatus === 'string'
                ? rawLatest.runStatus
                : typeof rawLatest.run_status === 'string'
                  ? rawLatest.run_status
                  : null,
            stepId:
              typeof rawLatest.stepId === 'string'
                ? rawLatest.stepId
                : typeof rawLatest.step_id === 'string'
                  ? rawLatest.step_id
                  : null,
            stepStatus:
              typeof rawLatest.stepStatus === 'string'
                ? rawLatest.stepStatus
                : typeof rawLatest.step_status === 'string'
                  ? rawLatest.step_status
                  : null,
            producedAt:
              typeof rawLatest.producedAt === 'string'
                ? rawLatest.producedAt
                : typeof rawLatest.produced_at === 'string'
                  ? rawLatest.produced_at
                  : null,
            payload: isRecord(rawLatest.payload) ? (rawLatest.payload as Record<string, unknown>) : null,
            partitionKey:
              typeof rawLatest.partitionKey === 'string'
                ? rawLatest.partitionKey
                : typeof rawLatest.partition_key === 'string'
                  ? rawLatest.partition_key
                  : null,
            runStartedAt:
              typeof rawLatest.runStartedAt === 'string'
                ? rawLatest.runStartedAt
                : typeof rawLatest.run_started_at === 'string'
                  ? rawLatest.run_started_at
                  : null,
            runCompletedAt:
              typeof rawLatest.runCompletedAt === 'string'
                ? rawLatest.runCompletedAt
                : typeof rawLatest.run_completed_at === 'string'
                  ? rawLatest.run_completed_at
                  : null
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
  } catch (error) {
    if (error instanceof CapabilityRequestError) {
      throw new Error(
        `Failed to fetch ingest asset partitions (${error.status ?? 'unknown'}) for ${options.ingestWorkflowSlug}/${options.ingestAssetId}`
      );
    }
    throw error;
  }
}

async function upsertPlanMetastoreRecord(
  metastore: MetastoreCapability | null,
  plan: CalibrationReprocessPlan,
  principal: string | undefined
): Promise<void> {
  if (!metastore || !plan.storage.metastore) {
    return;
  }

  try {
    await metastore.upsertRecord({
      key: deriveMetastoreRecordKey(plan.planId),
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
      },
      principal
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to upsert plan metastore record: ${message}`);
  }
}

async function materializePlanArtifact(
  plan: CalibrationReprocessPlan,
  filestore: FilestoreCapability,
  backendMountId: number,
  backendMountKey: string | null,
  planPath: string,
  principal: string | undefined
): Promise<CalibrationReprocessPlan> {
  const serializedInitial = `${JSON.stringify(plan, null, 2)}\n`;
  const firstUpload = await uploadTextFile({
    filestore,
    backendMountId,
    backendMountKey: backendMountKey ?? undefined,
    defaultBackendKey: DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
    path: planPath,
    content: serializedInitial,
    contentType: 'application/json; charset=utf-8',
    principal,
    idempotencyKey: `${plan.planId}-v${plan.planVersion}-initial`
  });

  const updatedPlan: CalibrationReprocessPlan = {
    ...plan,
    storage: {
      ...plan.storage,
      nodeId: plan.storage.nodeId
    },
    updatedAt: new Date().toISOString()
  };

  const initialNodeId = firstUpload.node?.id ?? firstUpload.nodeId;
  if (initialNodeId !== undefined && initialNodeId !== null) {
    updatedPlan.storage.nodeId = initialNodeId;
  } else if (plan.storage.nodeId !== undefined) {
    updatedPlan.storage.nodeId = plan.storage.nodeId;
  }

  const serializedFinal = `${JSON.stringify(updatedPlan, null, 2)}\n`;
  if (serializedFinal !== serializedInitial) {
    const secondUpload = await uploadTextFile({
      filestore,
      backendMountId,
      backendMountKey: backendMountKey ?? undefined,
      defaultBackendKey: DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY,
      path: planPath,
      content: serializedFinal,
      contentType: 'application/json; charset=utf-8',
      principal,
      idempotencyKey: `${plan.planId}-v${plan.planVersion}-final`
    });
    const finalNodeId = secondUpload.node?.id ?? secondUpload.nodeId;
    if (finalNodeId !== undefined && finalNodeId !== null) {
      updatedPlan.storage.nodeId = finalNodeId;
    }
  }

  return updatedPlan;
}

export const calibrationPlannerJob = createJobHandler<
  ObservatoryModuleSettings,
  ObservatoryModuleSecrets,
  CalibrationPlannerResult,
  PlannerOverrides,
  ['filestore', 'coreWorkflows', 'metastore.calibrations', 'events.default']
>({
  name: 'observatory-calibration-planner',
  settings: inheritModuleSettings(),
  secrets: inheritModuleSecrets(),
  requires: ['filestore', 'coreWorkflows', 'metastore.calibrations', 'events.default'] as const,
  parameters: {
    resolve: (raw) => resolvePlannerOverrides(raw)
  },
  handler: async (context: CalibrationPlannerContext): Promise<CalibrationPlannerResult> => {
    const filestoreCapabilityCandidate = selectFilestore(context.capabilities);
    if (!filestoreCapabilityCandidate) {
      throw new Error('Filestore capability is required for the calibration planner');
    }
    const filestore: FilestoreCapability = filestoreCapabilityCandidate;

    const baseCoreWorkflows = selectCoreWorkflows(context.capabilities);
    const coreWorkflows = context.parameters.coreBaseUrl
      ? createCoreWorkflowsCapability({
          baseUrl: context.parameters.coreBaseUrl,
          token: () => context.secrets.coreApiToken ?? null
        })
      : baseCoreWorkflows;

    if (!coreWorkflows) {
      throw new Error('Core workflows capability is required for the calibration planner');
    }

    const eventsCapability = selectEventBus(context.capabilities, 'default');
    if (!eventsCapability) {
      throw new Error('Event bus capability is required for the calibration planner');
    }

    const publisher = createObservatoryEventPublisher({
      capability: eventsCapability,
      source: context.settings.events.source || 'observatory.calibration-planner'
    });

    try {
      const ingestWorkflowSlug =
        context.parameters.ingestWorkflowSlug ?? context.settings.reprocess.ingestWorkflowSlug;
      const ingestAssetId = context.parameters.ingestAssetId ?? context.settings.reprocess.ingestAssetId;
      const downstreamWorkflows =
        context.parameters.downstreamWorkflows ?? context.settings.reprocess.downstreamWorkflows;
      const plansPrefix =
        context.parameters.plansPrefix ?? context.settings.filestore.plansPrefix ?? 'datasets/observatory/calibrations/plans';
      const lookbackMinutes =
        context.parameters.lookbackMinutes ?? context.settings.timestore.lookbackMinutes ?? null;
      const metastoreNamespace =
        context.parameters.metastoreNamespace ?? context.settings.reprocess.metastoreNamespace;
      const metastoreBaseUrl =
        (context.parameters.metastoreBaseUrl ?? context.settings.metastore.baseUrl)?.trim() || null;
      const fallbackMetastore = selectMetastore(context.capabilities, 'calibrations');
      const principal = context.parameters.principal ?? context.settings.principals.calibrationPlanner;

      const backendParams = {
        filestoreBackendId: context.parameters.filestoreBackendId ?? context.settings.filestore.backendId ?? null,
        filestoreBackendKey:
          context.parameters.filestoreBackendKey ?? context.settings.filestore.backendKey ?? null
      } satisfies {
        filestoreBackendId?: number | null;
        filestoreBackendKey?: string | null;
      };

      const backendMountId = await ensureResolvedBackendId(filestore, backendParams);
      const backendMountKey = backendParams.filestoreBackendKey ?? DEFAULT_OBSERVATORY_FILESTORE_BACKEND_KEY;

    const fallbackPlanId = `${ingestWorkflowSlug}-${randomUUID()}`;
    const planId = sanitizeIdentifier(context.parameters.planId ?? fallbackPlanId, fallbackPlanId);
    const planFileName = sanitizeFileName(context.parameters.planFileName ?? planId, planId);
    const planPath = normalizePlanPath(plansPrefix, planFileName);

    const requestTimestamp = new Date().toISOString();

    const partitions = await fetchAssetPartitions(coreWorkflows, {
      ingestWorkflowSlug,
      ingestAssetId,
      lookbackMinutes: lookbackMinutes ?? null,
      principal
    });

    const calibrationEntries = buildCalibrationEntries(context.parameters, partitions, requestTimestamp, context);
    if (calibrationEntries.length === 0) {
      context.logger.info('No valid calibrations provided; skipping plan generation', {
        planId,
        ingestWorkflowSlug,
        ingestAssetId
      });
      return {
        planId,
        planPath,
        planNodeId: null,
        partitionCount: 0,
        instrumentCount: 0,
        calibrationCount: 0,
        state: 'completed',
        storage: {
          plansPrefix: plansPrefix ?? null,
          planPath,
          nodeId: null
        },
        summary: {
          partitionCount: 0,
          instrumentCount: 0,
          calibrationCount: 0
        },
        assets: []
      } satisfies CalibrationPlannerResult;
    }

    const summary = buildPlanSummary(calibrationEntries);

    const includeMetastore = Boolean(metastoreBaseUrl ?? fallbackMetastore);
    const plan: CalibrationReprocessPlan = {
      planId,
      planVersion: DEFAULT_PLAN_VERSION,
      state: 'pending',
      createdAt: requestTimestamp,
      updatedAt: requestTimestamp,
      ingestWorkflowSlug,
      ingestAssetId,
      downstreamWorkflows,
      calibrations: calibrationEntries,
      summary,
      storage: buildPlanStorage({
        planId,
        planPath,
        plansPrefix,
        includeMetastore,
        metastoreNamespace
      }),
      metadata: {
        createdBy: {
          jobSlug: 'observatory-calibration-planner'
        }
      }
    } satisfies CalibrationReprocessPlan;

    const metastoreCapability = metastoreBaseUrl
      ? createMetastoreCapability({
          baseUrl: metastoreBaseUrl,
          namespace: metastoreNamespace,
          token: () => context.secrets.metastoreToken ?? null
        })
      : fallbackMetastore;

      const materializedPlan = await materializePlanArtifact(
        plan,
        filestore,
        backendMountId,
        backendMountKey,
        planPath,
        principal
      );

      if (metastoreCapability) {
        try {
          await upsertPlanMetastoreRecord(metastoreCapability, materializedPlan, principal);
        } catch (error) {
          context.logger.warn('Failed to upsert calibration plan metastore record', {
            planId: materializedPlan.planId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      const result: CalibrationPlannerResult = {
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
      } satisfies CalibrationPlannerResult;

      await publishAssetMaterialized(publisher, {
        assetId: 'observatory.reprocess.plan',
        partitionKey: materializedPlan.planId,
        producedAt: materializedPlan.updatedAt,
        metadata: {
          calibrationCount: materializedPlan.summary.calibrationCount,
          instrumentCount: materializedPlan.summary.instrumentCount,
          partitionCount: materializedPlan.summary.partitionCount,
          plansPrefix: materializedPlan.storage.plansPrefix ?? null,
          planPath: materializedPlan.storage.planPath,
          planNodeId: materializedPlan.storage.nodeId ?? null,
          metastoreNamespace,
          metastoreRecordKey: deriveMetastoreRecordKey(materializedPlan.planId)
        }
      });

      return result;
    } finally {
      await publisher.close().catch(() => undefined);
    }
  }
});
