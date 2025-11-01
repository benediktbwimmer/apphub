import { z } from 'zod';
import { createApiClient, type AuthorizedFetch } from '../lib/apiClient';
import {
  calibrationSnapshotSchema,
  calibrationPlanRecordSummarySchema,
  calibrationReprocessPlanSchema,
  calibrationPlanSummarySchema,
  type CalibrationSnapshot,
  type CalibrationPlanRecordSummary,
  type CalibrationReprocessPlan
} from './types';

type CalibrationUploadPayload = z.infer<typeof calibrationUploadSchema>;

type PlanReprocessPayload = z.infer<typeof planReprocessRequestSchema>;

type CalibrationPlanDetailResponse = {
  plan: CalibrationReprocessPlan;
  summary: z.infer<typeof calibrationPlanRecordSummarySchema>;
  artifact: {
    path: string;
    nodeId: number | null;
  };
  computed: {
    partitionStateCounts: Record<string, number>;
    summary: z.infer<typeof calibrationPlanSummarySchema>;
  };
};

const calibrationUploadSchema = z
  .object({
    instrumentId: z.string(),
    effectiveAt: z.string(),
    createdAt: z.string().optional(),
    revision: z.number().optional(),
    offsets: z.record(z.string(), z.number()).optional(),
    scales: z.record(z.string(), z.number()).optional(),
    notes: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    filename: z.string().optional(),
    overwrite: z.boolean().optional()
  })
  .strict();

const planReprocessRequestSchema = z
  .object({
    mode: z.enum(['all', 'selected']).optional(),
    selectedPartitions: z.array(z.string()).optional(),
    maxConcurrency: z.number().optional(),
    pollIntervalMs: z.number().optional(),
    runKey: z.string().optional(),
    triggeredBy: z.string().optional()
  })
  .strict();

function createClient(fetcher: AuthorizedFetch) {
  return createApiClient(fetcher);
}

function dataEnvelope<T extends z.ZodTypeAny>(schema: T) {
  return z.object({ data: schema }).transform(({ data }) => data);
}

export async function fetchCalibrations(
  fetcher: AuthorizedFetch,
  params: { instrumentId?: string; limit?: number } = {}
): Promise<CalibrationSnapshot[]> {
  const client = createClient(fetcher);
  const schema = dataEnvelope(z.object({ calibrations: z.array(calibrationSnapshotSchema) }));
  return client.request('/observatory/calibrations', {
    query: {
      instrumentId: params.instrumentId,
      limit: params.limit
    },
    schema,
    transform: (payload) => {
      if (!payload) {
        throw new Error('Missing calibration response payload');
      }
      return payload.calibrations;
    }
  });
}

export async function uploadCalibration(
  fetcher: AuthorizedFetch,
  payload: CalibrationUploadPayload
): Promise<{
  calibrationId: string;
  instrumentId: string;
  effectiveAt: string;
  path: string;
  nodeId: number | null;
  checksum: string;
}> {
  const client = createClient(fetcher);
  const schema = dataEnvelope(
    z.object({
      calibrationId: z.string(),
      instrumentId: z.string(),
      effectiveAt: z.string(),
      path: z.string(),
      nodeId: z.number().nullable(),
      checksum: z.string()
    })
  );
  return client.request('/observatory/calibrations/upload', {
    method: 'POST',
    json: payload,
    schema
  });
}

export async function fetchCalibrationPlans(
  fetcher: AuthorizedFetch,
  params: { limit?: number } = {}
): Promise<CalibrationPlanRecordSummary[]> {
  const client = createClient(fetcher);
  const schema = dataEnvelope(z.object({ plans: z.array(calibrationPlanRecordSummarySchema) }));
  return client.request('/observatory/plans', {
    query: { limit: params.limit },
    schema,
    transform: (payload) => {
      if (!payload) {
        throw new Error('Missing calibration plans payload');
      }
      return payload.plans;
    }
  });
}

export async function fetchCalibrationPlanDetail(
  fetcher: AuthorizedFetch,
  planId: string
): Promise<CalibrationPlanDetailResponse> {
  const client = createClient(fetcher);
  const schema = dataEnvelope(
    z.object({
      plan: calibrationReprocessPlanSchema,
      summary: calibrationPlanRecordSummarySchema,
      artifact: z.object({ path: z.string(), nodeId: z.number().nullable() }),
      computed: z.object({
        partitionStateCounts: z.record(z.string(), z.number()),
        summary: calibrationPlanSummarySchema
      })
    })
  );
  return client.request(`/observatory/plans/${encodeURIComponent(planId)}`, {
    schema
  });
}

export async function triggerCalibrationPlanReprocess(
  fetcher: AuthorizedFetch,
  planId: string,
  payload: PlanReprocessPayload
): Promise<{
  run: WorkflowRunSummary;
  workflowSlug: string;
  planId: string;
  mode: 'all' | 'selected';
  selectedPartitions: string[];
  parameters: Record<string, unknown>;
}> {
  const client = createClient(fetcher);
  const schema = dataEnvelope(
    z.object({
      run: serializeRunSchema,
      workflowSlug: z.string(),
      planId: z.string(),
      mode: z.enum(['all', 'selected']),
      selectedPartitions: z.array(z.string()),
      parameters: z.record(z.string(), z.unknown())
    })
  );
  return client.request(`/observatory/plans/${encodeURIComponent(planId)}/reprocess`, {
    method: 'POST',
    json: payload,
    schema
  });
}

const serializeRunSchema = z
  .object({
    id: z.string(),
    workflowDefinitionId: z.string(),
    status: z.string(),
    runKey: z.string().nullable(),
    parameters: z.unknown(),
    context: z.unknown(),
    output: z.unknown(),
    errorMessage: z.string().nullable(),
    currentStepId: z.string().nullable(),
    currentStepIndex: z.number().nullable(),
    metrics: z.unknown(),
    triggeredBy: z.string().nullable(),
    trigger: z.unknown(),
    partitionKey: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    durationMs: z.number().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    retrySummary: z
      .object({
        pendingSteps: z.number(),
        nextAttemptAt: z.string().nullable(),
        overdueSteps: z.number()
      })
      .optional(),
    health: z.string().optional()
  })
  .strict();

export type WorkflowRunSummary = z.infer<typeof serializeRunSchema>;

export function toCalibrationUploadPayload(form: {
  instrumentId: string;
  effectiveAt: string;
  createdAt?: string;
  revision?: number | null;
  offsets?: Record<string, number> | null;
  scales?: Record<string, number> | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  filename?: string | null;
  overwrite?: boolean;
}): CalibrationUploadPayload {
  return calibrationUploadSchema.parse({
    instrumentId: form.instrumentId,
    effectiveAt: form.effectiveAt,
    createdAt: form.createdAt,
    revision: form.revision ?? undefined,
    offsets: form.offsets ?? undefined,
    scales: form.scales ?? undefined,
    notes: form.notes ?? undefined,
    metadata: form.metadata ?? undefined,
    filename: form.filename ?? undefined,
    overwrite: form.overwrite ?? undefined
  });
}

export function toPlanReprocessPayload(form: {
  mode: 'all' | 'selected';
  selectedPartitions?: string[];
  maxConcurrency?: number;
  pollIntervalMs?: number;
  runKey?: string;
  triggeredBy?: string;
}): PlanReprocessPayload {
  return planReprocessRequestSchema.parse({
    mode: form.mode,
    selectedPartitions: form.selectedPartitions,
    maxConcurrency: form.maxConcurrency,
    pollIntervalMs: form.pollIntervalMs,
    runKey: form.runKey,
    triggeredBy: form.triggeredBy
  });
}
