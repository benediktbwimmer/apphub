import { z } from 'zod';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

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

const minuteKeyRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/;

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
    minute: z.string().regex(minuteKeyRegex, 'minute must be formatted as YYYY-MM-DDTHH:mm'),
    instrumentId: z.string().min(1),
    datasetSlug: z.string().min(1),
    recordedCalibration: calibrationPlanRecordedCalibrationSchema,
    targetCalibration: calibrationPlanTargetCalibrationSchema,
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
    effectiveFromMinute: z.string().regex(minuteKeyRegex),
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

function createEmptyStateCounts(): Record<CalibrationPlanPartitionState, number> {
  return calibrationPlanPartitionStates.reduce((acc, state) => {
    acc[state] = 0;
    return acc;
  }, {} as Record<CalibrationPlanPartitionState, number>);
}

export function createInitialPartitionStatus(now: Date = new Date()): CalibrationPlanPartitionStatus {
  const timestamp = now.toISOString();
  return {
    state: 'pending',
    runId: null,
    runStatus: null,
    runStartedAt: null,
    runCompletedAt: null,
    message: null,
    updatedAt: timestamp,
    attempts: 0,
    lastErrorAt: null
  } satisfies CalibrationPlanPartitionStatus;
}

export function computePartitionStateCounts(
  partitions: readonly CalibrationPlanPartition[]
): Record<CalibrationPlanPartitionState, number> {
  const counts = createEmptyStateCounts();
  for (const partition of partitions) {
    const state = partition.status.state;
    counts[state] = (counts[state] ?? 0) + 1;
  }
  return counts;
}

export function buildCalibrationSummary(
  calibration: CalibrationPlanCalibration
): CalibrationPlanCalibrationSummary {
  const stateCounts = computePartitionStateCounts(calibration.partitions);
  return {
    partitionCount: calibration.partitions.length,
    stateCounts
  } satisfies CalibrationPlanCalibrationSummary;
}

export function buildPlanSummary(calibrations: readonly CalibrationPlanCalibration[]): CalibrationPlanSummary {
  const instrumentIds = new Set<string>();
  const stateCounts = createEmptyStateCounts();
  let partitionCount = 0;

  for (const calibration of calibrations) {
    partitionCount += calibration.partitions.length;
    for (const partition of calibration.partitions) {
      instrumentIds.add(partition.instrumentId);
      const state = partition.status.state;
      stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    }
  }

  return {
    partitionCount,
    instrumentCount: instrumentIds.size,
    calibrationCount: calibrations.length,
    stateCounts
  } satisfies CalibrationPlanSummary;
}
