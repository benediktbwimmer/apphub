import { z } from 'zod';

export const calibrationSnapshotSchema = z
  .object({
    calibrationId: z.string(),
    instrumentId: z.string(),
    effectiveAt: z.string(),
    createdAt: z.string().nullable(),
    revision: z.number().nullable(),
    offsets: z.record(z.number()),
    scales: z.record(z.number()).nullable(),
    notes: z.string().nullable(),
    metadata: z.record(z.unknown()),
    checksum: z.string().nullable(),
    metastoreVersion: z.number().nullable()
  })
  .strict();

export type CalibrationSnapshot = z.infer<typeof calibrationSnapshotSchema>;

export const calibrationPlanPartitionStateSchema = z.enum([
  'pending',
  'queued',
  'running',
  'succeeded',
  'failed',
  'skipped'
]);
export type CalibrationPlanPartitionState = z.infer<typeof calibrationPlanPartitionStateSchema>;

export const calibrationPlanPartitionStatusSchema = z
  .object({
    state: calibrationPlanPartitionStateSchema,
    runId: z.string().nullable().optional(),
    runStatus: z.string().nullable().optional(),
    runStartedAt: z.string().nullable().optional(),
    runCompletedAt: z.string().nullable().optional(),
    message: z.string().nullable().optional(),
    updatedAt: z.string(),
    attempts: z.number().int().nonnegative().optional(),
    lastErrorAt: z.string().nullable().optional()
  })
  .strict();

export type CalibrationPlanPartitionStatus = z.infer<typeof calibrationPlanPartitionStatusSchema>;

export const calibrationPlanRecordedCalibrationSchema = z
  .object({
    calibrationId: z.string().nullable().optional(),
    instrumentId: z.string().nullable().optional(),
    effectiveAt: z.string().nullable().optional(),
    metastoreVersion: z.number().nullable().optional()
  })
  .strict();

export const calibrationPlanTargetCalibrationSchema = z
  .object({
    calibrationId: z.string(),
    instrumentId: z.string(),
    effectiveAt: z.string(),
    metastoreVersion: z.number().nullable().optional()
  })
  .strict();

export const calibrationPlanLatestRunSchema = z
  .object({
    workflowRunId: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional()
  })
  .strict();

export const calibrationPlanPartitionSchema = z
  .object({
    partitionKey: z.string(),
    minute: z.string(),
    instrumentId: z.string(),
    datasetSlug: z.string(),
    recordedCalibration: calibrationPlanRecordedCalibrationSchema,
    target: calibrationPlanTargetCalibrationSchema,
    latestRun: calibrationPlanLatestRunSchema.nullable().optional(),
    parameters: z.record(z.unknown()).nullable().optional(),
    status: calibrationPlanPartitionStatusSchema,
    notes: z.string().nullable().optional()
  })
  .strict();

export type CalibrationPlanPartition = z.infer<typeof calibrationPlanPartitionSchema>;

export const calibrationPlanCalibrationSummarySchema = z
  .object({
    partitionCount: z.number().int().nonnegative(),
    stateCounts: z
      .record(calibrationPlanPartitionStateSchema, z.number().int().nonnegative())
      .nullable()
      .optional()
  })
  .strict();

export const calibrationPlanCalibrationSchema = z
  .object({
    target: calibrationPlanTargetCalibrationSchema,
    requestedAt: z.string(),
    effectiveFromMinute: z.string(),
    partitions: z.array(calibrationPlanPartitionSchema),
    summary: calibrationPlanCalibrationSummarySchema,
    notes: z.string().nullable().optional()
  })
  .strict();

export type CalibrationPlanCalibration = z.infer<typeof calibrationPlanCalibrationSchema>;

export const calibrationPlanDownstreamWorkflowSchema = z
  .object({
    workflowSlug: z.string(),
    description: z.string().optional(),
    assetIds: z.array(z.string()).optional()
  })
  .strict();

export type CalibrationPlanDownstreamWorkflow = z.infer<typeof calibrationPlanDownstreamWorkflowSchema>;

export const calibrationPlanSummarySchema = z
  .object({
    partitionCount: z.number().int().nonnegative(),
    instrumentCount: z.number().int().nonnegative(),
    calibrationCount: z.number().int().nonnegative(),
    stateCounts: z
      .record(calibrationPlanPartitionStateSchema, z.number().int().nonnegative())
      .nullable()
      .optional()
  })
  .strict();

export type CalibrationPlanSummary = z.infer<typeof calibrationPlanSummarySchema>;

export const calibrationPlanStorageSchema = z
  .object({
    plansPrefix: z.string().optional(),
    planPath: z.string(),
    nodeId: z.number().optional(),
    metastore: z
      .object({
        namespace: z.string(),
        recordKey: z.string()
      })
      .optional()
  })
  .strict();

export const calibrationPlanRecordSummarySchema = z
  .object({
    planId: z.string(),
    state: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    createdAt: z.string(),
    updatedAt: z.string(),
    partitionCount: z.number().int().nonnegative(),
    instrumentCount: z.number().int().nonnegative(),
    calibrationCount: z.number().int().nonnegative(),
    storage: calibrationPlanStorageSchema,
    summary: calibrationPlanSummarySchema,
    calibrations: z.array(
      z.object({
        calibrationId: z.string(),
        instrumentId: z.string(),
        effectiveAt: z.string(),
        metastoreVersion: z.number().nullable(),
        effectiveFromMinute: z.string(),
        partitionCount: z.number().int().nonnegative(),
        stateCounts: z
          .record(calibrationPlanPartitionStateSchema, z.number().int().nonnegative())
          .nullable()
          .optional()
      })
    ),
    downstreamWorkflows: z.array(calibrationPlanDownstreamWorkflowSchema)
  })
  .strict();

export type CalibrationPlanRecordSummary = z.infer<typeof calibrationPlanRecordSummarySchema>;

export const calibrationPlanStateSchema = z.enum(['pending', 'in_progress', 'completed', 'failed']);

export const calibrationPlanMetadataSchema = z
  .object({
    createdBy: z
      .object({
        workflowSlug: z.string().optional(),
        jobSlug: z.string().optional(),
        runId: z.string().optional()
      })
      .optional(),
    notes: z.string().optional()
  })
  .optional();

export const calibrationReprocessPlanSchema = z
  .object({
    planId: z.string(),
    planVersion: z.number().int().min(1),
    state: calibrationPlanStateSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    ingestWorkflowSlug: z.string(),
    ingestAssetId: z.string(),
    downstreamWorkflows: z.array(calibrationPlanDownstreamWorkflowSchema),
    calibrations: z.array(calibrationPlanCalibrationSchema),
    summary: calibrationPlanSummarySchema,
    storage: calibrationPlanStorageSchema,
    metadata: calibrationPlanMetadataSchema
  })
  .strict();

export type CalibrationReprocessPlan = z.infer<typeof calibrationReprocessPlanSchema>;

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
    counts[partition.status.state] += 1;
  }
  return counts;
}
