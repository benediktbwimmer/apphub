import { createHash } from 'node:crypto';
import { z } from 'zod';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

const isoDateRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2}))$/;

export const calibrationMeasurementFields = [
  'temperature_c',
  'relative_humidity_pct',
  'pm2_5_ug_m3',
  'battery_voltage'
] as const;

export const calibrationMeasurementOffsetsSchema = z
  .object({
    temperature_c: z.number().finite().optional(),
    relative_humidity_pct: z.number().finite().optional(),
    pm2_5_ug_m3: z.number().finite().optional(),
    battery_voltage: z.number().finite().optional()
  })
  .strip();

export const calibrationMeasurementScalesSchema = z
  .object({
    temperature_c: z.number().finite().optional(),
    relative_humidity_pct: z.number().finite().optional(),
    pm2_5_ug_m3: z.number().finite().optional(),
    battery_voltage: z.number().finite().optional()
  })
  .strip();

export const calibrationFileSchema = z
  .object({
    instrumentId: z.string().min(1, 'instrumentId is required'),
    effectiveAt: z
      .string()
      .regex(isoDateRegex, 'effectiveAt must be ISO-8601 with offset (e.g. 2025-01-01T00:00:00Z)'),
    createdAt: z
      .string()
      .regex(isoDateRegex, 'createdAt must be ISO-8601 with offset')
      .optional(),
    revision: z.number().int().nonnegative().optional(),
    offsets: calibrationMeasurementOffsetsSchema.default({}),
    scales: calibrationMeasurementScalesSchema.optional(),
    notes: z.string().max(10_000).optional(),
    metadata: z.record(z.string(), z.unknown()).default({})
  })
  .strip();

export type CalibrationFile = z.infer<typeof calibrationFileSchema>;

export type NormalizedCalibrationDocument = {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  createdAt: string;
  revision: number | null;
  offsets: Record<string, number>;
  scales: Record<string, number> | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  checksum: string;
};

export type CalibrationSnapshot = {
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  createdAt: string | null;
  revision: number | null;
  offsets: Record<string, number>;
  scales: Record<string, number> | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  checksum: string | null;
  metastoreVersion: number | null;
};

function sanitizeMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(value ?? {}).filter(([key]) => typeof key === 'string' && key.trim().length > 0);
  return Object.fromEntries(entries);
}

export function sanitizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

function toNumberRecord(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!value || typeof value !== 'object') {
    return result;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) {
      continue;
    }
    const numeric =
      typeof entry === 'number'
        ? entry
        : typeof entry === 'string'
          ? Number(entry)
          : null;
    if (numeric !== null && Number.isFinite(numeric)) {
      result[key] = numeric;
    }
  }
  return result;
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

export function normalizeCalibrationDocument(payload: CalibrationFile, rawContent: string): NormalizedCalibrationDocument {
  const effectiveAt = new Date(payload.effectiveAt).toISOString();
  const createdAt = payload.createdAt ? new Date(payload.createdAt).toISOString() : new Date().toISOString();
  const calibrationId = `${sanitizeIdentifier(payload.instrumentId)}:${effectiveAt}`;
  const checksum = createHash('sha256').update(rawContent, 'utf8').digest('hex');

  return {
    calibrationId,
    instrumentId: payload.instrumentId.trim(),
    effectiveAt,
    createdAt,
    revision: payload.revision ?? null,
    offsets: Object.fromEntries(
      Object.entries(payload.offsets ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
    ),
    scales: payload.scales
      ? Object.fromEntries(
          Object.entries(payload.scales ?? {}).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
        )
      : null,
    notes: payload.notes?.trim() ? payload.notes.trim() : null,
    metadata: sanitizeMetadata(payload.metadata ?? {}),
    checksum
  } satisfies NormalizedCalibrationDocument;
}

export function buildCalibrationFilename(instrumentId: string, effectiveAtIso: string): string {
  const sanitizedInstrument = sanitizeIdentifier(instrumentId) || 'calibration';
  const iso = new Date(effectiveAtIso).toISOString();
  const timestamp = iso.replace(/[-:]/g, '').replace('.000', '').replace(/\.\d+Z$/, 'Z');
  return `${sanitizedInstrument}_${timestamp}.json`;
}

export function parseCalibrationSnapshot(record: unknown): CalibrationSnapshot | null {
  if (!record || typeof record !== 'object') {
    return null;
  }
  const entry = record as Record<string, unknown>;
  const calibrationId =
    typeof entry.key === 'string' && entry.key.trim().length > 0 ? entry.key.trim() : null;
  if (!calibrationId) {
    return null;
  }
  const versionRaw = entry.version;
  const version = typeof versionRaw === 'number' && Number.isFinite(versionRaw) ? versionRaw : null;
  const metadataRaw = entry.metadata;
  if (!metadataRaw || typeof metadataRaw !== 'object') {
    return null;
  }
  const metadata = metadataRaw as Record<string, unknown>;
  const instrumentIdRaw = metadata.instrumentId ?? metadata.instrument_id;
  const instrumentId = typeof instrumentIdRaw === 'string' ? instrumentIdRaw.trim() : '';
  if (!instrumentId) {
    return null;
  }
  const effectiveAt = normalizeIsoTimestamp(metadata.effectiveAt ?? metadata.effective_at);
  if (!effectiveAt) {
    return null;
  }
  const createdAt = normalizeIsoTimestamp(metadata.createdAt ?? metadata.created_at);
  const revisionRaw = metadata.revision;
  const revision =
    typeof revisionRaw === 'number' && Number.isFinite(revisionRaw)
      ? Math.trunc(revisionRaw)
      : null;
  const offsets = toNumberRecord(metadata.offsets);
  const scalesRecord = toNumberRecord(metadata.scales);
  const scales = Object.keys(scalesRecord).length > 0 ? scalesRecord : null;
  const notesRaw = metadata.notes;
  const notes =
    typeof notesRaw === 'string' && notesRaw.trim().length > 0 ? notesRaw.trim() : null;
  const checksumRaw = metadata.checksum ?? metadata.sourceChecksum ?? metadata.source_checksum;
  const checksum =
    typeof checksumRaw === 'string' && checksumRaw.trim().length > 0 ? checksumRaw.trim() : null;
  const metadataField = sanitizeMetadata((metadata.metadata as Record<string, unknown>) ?? {});

  return {
    calibrationId,
    instrumentId,
    effectiveAt,
    createdAt,
    revision,
    offsets,
    scales,
    notes,
    metadata: metadataField,
    checksum,
    metastoreVersion: version
  } satisfies CalibrationSnapshot;
}

export function parseCalibrationSnapshots(records: unknown[]): CalibrationSnapshot[] {
  const results: CalibrationSnapshot[] = [];
  for (const entry of records) {
    const snapshot = parseCalibrationSnapshot(entry);
    if (snapshot) {
      results.push(snapshot);
    }
  }
  return results;
}

export const calibrationPlanPartitionStates = ['pending', 'queued', 'running', 'succeeded', 'failed', 'skipped'] as const;
export type CalibrationPlanPartitionState = (typeof calibrationPlanPartitionStates)[number];

export const calibrationPlanPartitionStatusSchema = z
  .object({
    state: z.enum(calibrationPlanPartitionStates),
    runId: z.string().min(1).optional().nullable(),
    runStatus: z.string().min(1).optional().nullable(),
    runStartedAt: z.string().datetime({ offset: true }).optional().nullable(),
    runCompletedAt: z.string().datetime({ offset: true }).optional().nullable(),
    message: z.string().max(2000).optional().nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    attempts: z.number().int().nonnegative().optional(),
    lastErrorAt: z.string().datetime({ offset: true }).optional().nullable()
  })
  .strict();
export type CalibrationPlanPartitionStatus = z.infer<typeof calibrationPlanPartitionStatusSchema>;

export const calibrationPlanRecordedCalibrationSchema = z
  .object({
    calibrationId: z.string().min(1).optional().nullable(),
    instrumentId: z.string().min(1).optional().nullable(),
    effectiveAt: z.string().datetime({ offset: true }).optional().nullable(),
    metastoreVersion: z.number().int().optional().nullable()
  })
  .strict();
export type CalibrationPlanRecordedCalibration = z.infer<typeof calibrationPlanRecordedCalibrationSchema>;

export const calibrationPlanTargetCalibrationSchema = z
  .object({
    calibrationId: z.string().min(1),
    instrumentId: z.string().min(1),
    effectiveAt: z.string().datetime({ offset: true }),
    metastoreVersion: z.number().int().optional().nullable()
  })
  .strict();
export type CalibrationPlanTargetCalibration = z.infer<typeof calibrationPlanTargetCalibrationSchema>;

export const calibrationPlanLatestRunSchema = z
  .object({
    workflowRunId: z.string().min(1).optional().nullable(),
    status: z.string().min(1).optional().nullable(),
    startedAt: z.string().datetime({ offset: true }).optional().nullable(),
    completedAt: z.string().datetime({ offset: true }).optional().nullable()
  })
  .strict();
export type CalibrationPlanLatestRun = z.infer<typeof calibrationPlanLatestRunSchema>;

export const calibrationPlanPartitionSchema = z
  .object({
    partitionKey: z.string().min(1),
    minute: z.string().regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/),
    instrumentId: z.string().min(1),
    datasetSlug: z.string().min(1),
    recordedCalibration: calibrationPlanRecordedCalibrationSchema,
    target: calibrationPlanTargetCalibrationSchema,
    latestRun: calibrationPlanLatestRunSchema.optional().nullable(),
    parameters: z.record(z.string(), jsonValueSchema).optional().nullable(),
    status: calibrationPlanPartitionStatusSchema,
    notes: z.string().optional()
  })
  .strict();
export type CalibrationPlanPartition = z.infer<typeof calibrationPlanPartitionSchema>;

export const calibrationPlanCalibrationSummarySchema = z
  .object({
    partitionCount: z.number().int().nonnegative(),
    stateCounts: z
      .record(z.enum(calibrationPlanPartitionStates), z.number().int().nonnegative())
      .optional()
  })
  .strict();
export type CalibrationPlanCalibrationSummary = z.infer<typeof calibrationPlanCalibrationSummarySchema>;

export const calibrationPlanCalibrationSchema = z
  .object({
    target: calibrationPlanTargetCalibrationSchema,
    requestedAt: z.string().datetime({ offset: true }),
    effectiveFromMinute: z.string().regex(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/),
    partitions: z.array(calibrationPlanPartitionSchema),
    summary: calibrationPlanCalibrationSummarySchema,
    notes: z.string().optional()
  })
  .strict();
export type CalibrationPlanCalibration = z.infer<typeof calibrationPlanCalibrationSchema>;

export const calibrationPlanDownstreamWorkflowSchema = z
  .object({
    workflowSlug: z.string().min(1),
    description: z.string().optional(),
    assetIds: z.array(z.string().min(1)).optional()
  })
  .strict();
export type CalibrationPlanDownstreamWorkflow = z.infer<typeof calibrationPlanDownstreamWorkflowSchema>;

export const calibrationPlanSummarySchema = z
  .object({
    partitionCount: z.number().int().nonnegative(),
    instrumentCount: z.number().int().nonnegative(),
    calibrationCount: z.number().int().nonnegative(),
    stateCounts: z
      .record(z.enum(calibrationPlanPartitionStates), z.number().int().nonnegative())
      .optional()
  })
  .strict();
export type CalibrationPlanSummary = z.infer<typeof calibrationPlanSummarySchema>;

export const calibrationPlanStateSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);
export type CalibrationPlanState = z.infer<typeof calibrationPlanStateSchema>;

export const calibrationPlanStorageSchema = z
  .object({
    plansPrefix: z.string().min(1).optional(),
    planPath: z.string().min(1),
    nodeId: z.number().int().optional(),
    metastore: z
      .object({
        namespace: z.string().min(1),
        recordKey: z.string().min(1)
      })
      .optional()
  })
  .strict();
export type CalibrationPlanStorage = z.infer<typeof calibrationPlanStorageSchema>;

export const calibrationPlanMetadataSchema = z
  .object({
    createdBy: z
      .object({
        workflowSlug: z.string().min(1).optional(),
        jobSlug: z.string().min(1).optional(),
        runId: z.string().min(1).optional()
      })
      .optional(),
    notes: z.string().optional()
  })
  .strict()
  .optional();
export type CalibrationPlanMetadata = z.infer<typeof calibrationPlanMetadataSchema>;

export const calibrationReprocessPlanSchema = z
  .object({
    planId: z.string().min(1),
    planVersion: z.number().int().min(1),
    state: calibrationPlanStateSchema,
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
    ingestWorkflowSlug: z.string().min(1),
    ingestAssetId: z.string().min(1),
    downstreamWorkflows: z.array(calibrationPlanDownstreamWorkflowSchema).default([]),
    calibrations: z.array(calibrationPlanCalibrationSchema),
    summary: calibrationPlanSummarySchema,
    storage: calibrationPlanStorageSchema,
    metadata: calibrationPlanMetadataSchema
  })
  .strict();
export type CalibrationReprocessPlan = z.infer<typeof calibrationReprocessPlanSchema>;

export type CalibrationPlanRecordSummary = {
  planId: string;
  state: CalibrationPlanState;
  createdAt: string;
  updatedAt: string;
  partitionCount: number;
  instrumentCount: number;
  calibrationCount: number;
  storage: CalibrationPlanStorage;
  summary: CalibrationPlanSummary;
  calibrations: Array<{
    calibrationId: string;
    instrumentId: string;
    effectiveAt: string;
    metastoreVersion: number | null;
    effectiveFromMinute: string;
    partitionCount: number;
    stateCounts: Record<CalibrationPlanPartitionState, number> | null;
  }>;
  downstreamWorkflows: CalibrationPlanDownstreamWorkflow[];
};

function parseStateCounts(value: unknown): Record<CalibrationPlanPartitionState, number> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const result: Partial<Record<CalibrationPlanPartitionState, number>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!calibrationPlanPartitionStates.includes(key as CalibrationPlanPartitionState)) {
      continue;
    }
    const parsed = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : null;
    if (parsed !== null) {
      result[key as CalibrationPlanPartitionState] = parsed;
    }
  }
  if (Object.keys(result).length === 0) {
    return null;
  }
  const complete: Record<CalibrationPlanPartitionState, number> = {
    pending: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };
  for (const state of calibrationPlanPartitionStates) {
    if (result[state] !== undefined) {
      complete[state] = result[state]!;
    }
  }
  return complete;
}

export function parseCalibrationPlanSummary(metadata: unknown): CalibrationPlanRecordSummary | null {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const entry = metadata as Record<string, unknown>;
  const planIdRaw = entry.planId ?? entry.plan_id;
  const planId = typeof planIdRaw === 'string' ? planIdRaw.trim() : '';
  if (!planId) {
    return null;
  }
  const state = typeof entry.state === 'string' ? (entry.state.trim().toLowerCase() as CalibrationPlanState) : 'pending';
  const createdAt = normalizeIsoTimestamp(entry.createdAt ?? entry.created_at) ?? new Date().toISOString();
  const updatedAt = normalizeIsoTimestamp(entry.updatedAt ?? entry.updated_at) ?? createdAt;
  const partitionCount = typeof entry.partitionCount === 'number' && Number.isFinite(entry.partitionCount)
    ? Math.max(0, Math.trunc(entry.partitionCount))
    : 0;
  const instrumentCount = typeof entry.instrumentCount === 'number' && Number.isFinite(entry.instrumentCount)
    ? Math.max(0, Math.trunc(entry.instrumentCount))
    : 0;
  const calibrationCount = typeof entry.calibrationCount === 'number' && Number.isFinite(entry.calibrationCount)
    ? Math.max(0, Math.trunc(entry.calibrationCount))
    : 0;

  const storage = calibrationPlanStorageSchema.safeParse(entry.storage ?? {});
  if (!storage.success) {
    return null;
  }

  const summary = calibrationPlanSummarySchema.safeParse({
    partitionCount,
    instrumentCount,
    calibrationCount,
    stateCounts: parseStateCounts(entry.stateCounts ?? entry.state_counts) ?? undefined
  });
  if (!summary.success) {
    return null;
  }

  const calibrationsRaw = Array.isArray(entry.calibrations) ? entry.calibrations : [];
  const calibrations: CalibrationPlanRecordSummary['calibrations'] = [];
  for (const calibrationEntry of calibrationsRaw) {
    if (!calibrationEntry || typeof calibrationEntry !== 'object') {
      continue;
    }
    const record = calibrationEntry as Record<string, unknown>;
    const calibrationId = typeof record.calibrationId === 'string' ? record.calibrationId.trim() : '';
    const instrumentId = typeof record.instrumentId === 'string' ? record.instrumentId.trim() : '';
    const effectiveAt = normalizeIsoTimestamp(record.effectiveAt ?? record.effective_at);
    if (!calibrationId || !instrumentId || !effectiveAt) {
      continue;
    }
    const effectiveFromMinuteRaw = typeof record.effectiveFromMinute === 'string' ? record.effectiveFromMinute.trim() : '';
    const effectiveFromMinute = effectiveFromMinuteRaw || effectiveAt.slice(0, 16);
    const metastoreVersion =
      typeof record.metastoreVersion === 'number' && Number.isFinite(record.metastoreVersion)
        ? Math.trunc(record.metastoreVersion)
        : null;
    const partitionTotal =
      typeof record.partitionCount === 'number' && Number.isFinite(record.partitionCount)
        ? Math.max(0, Math.trunc(record.partitionCount))
        : 0;
    const stateCounts = parseStateCounts(record.stateCounts ?? record.state_counts);
    calibrations.push({
      calibrationId,
      instrumentId,
      effectiveAt,
      metastoreVersion,
      effectiveFromMinute,
      partitionCount: partitionTotal,
      stateCounts
    });
  }

  const downstreamWorkflowsRaw = Array.isArray(entry.downstreamWorkflows)
    ? entry.downstreamWorkflows
    : Array.isArray(entry.downstream_workflows)
      ? entry.downstream_workflows
      : [];
  const downstreamWorkflows: CalibrationPlanDownstreamWorkflow[] = [];
  for (const workflowEntry of downstreamWorkflowsRaw) {
    const parsed = calibrationPlanDownstreamWorkflowSchema.safeParse(workflowEntry);
    if (parsed.success) {
      downstreamWorkflows.push(parsed.data);
    }
  }

  return {
    planId,
    state,
    createdAt,
    updatedAt,
    partitionCount,
    instrumentCount,
    calibrationCount,
    storage: storage.data,
    summary: summary.data,
    calibrations,
    downstreamWorkflows
  } satisfies CalibrationPlanRecordSummary;
}

export function computePartitionStateCounts(
  partitions: readonly CalibrationPlanPartition[]
): Record<CalibrationPlanPartitionState, number> {
  const counts: Record<CalibrationPlanPartitionState, number> = {
    pending: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };
  for (const partition of partitions) {
    const state = partition.status.state;
    if (counts[state] !== undefined) {
      counts[state] += 1;
    }
  }
  return counts;
}

export function buildPlanSummary(calibrations: readonly CalibrationPlanCalibration[]): CalibrationPlanSummary {
  let partitionCount = 0;
  let instrumentCount = 0;
  const instrumentIds = new Set<string>();
  const stateCounts: Record<CalibrationPlanPartitionState, number> = {
    pending: 0,
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0
  };

  for (const calibration of calibrations) {
    instrumentIds.add(calibration.target.instrumentId);
    partitionCount += calibration.partitions.length;
    const calibrationStateCounts = computePartitionStateCounts(calibration.partitions);
    for (const state of calibrationPlanPartitionStates) {
      stateCounts[state] += calibrationStateCounts[state];
    }
  }

  instrumentCount = instrumentIds.size;

  return {
    partitionCount,
    instrumentCount,
    calibrationCount: calibrations.length,
    stateCounts
  } satisfies CalibrationPlanSummary;
}
