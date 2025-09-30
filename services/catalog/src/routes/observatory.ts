import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  listCalibrationSnapshots,
  getCalibrationSnapshot,
  listCalibrationPlans,
  getCalibrationPlanSummary
} from '../observatory/metastore';
import {
  uploadCalibrationFile,
  loadPlanArtifact
} from '../observatory/filestore';
import {
  calibrationFileSchema,
  normalizeCalibrationDocument,
  buildCalibrationFilename,
  calibrationReprocessPlanSchema,
  computePartitionStateCounts,
  buildPlanSummary,
  type CalibrationReprocessPlan
} from '../observatory/calibrationTypes';
import { requireOperatorScopes } from './shared/operatorAuth';
import {
  OBSERVATORY_READ_SCOPES,
  OBSERVATORY_WRITE_SCOPES,
  OBSERVATORY_REPROCESS_SCOPES
} from './shared/scopes';
import { getObservatoryCalibrationConfig } from '../config/observatory';
import {
  getWorkflowDefinitionBySlug,
  createWorkflowRun,
  updateWorkflowRun,
  getActiveWorkflowRunByKey
} from '../db/index';
import { isRunKeyConflict } from '../db/workflows';
import { collectPartitionedAssetsFromSteps, validatePartitionKey } from '../workflows/partitioning';
import { computeRunKeyColumns } from '../workflows/runKey';
import { enqueueWorkflowRun } from '../queue';
import { serializeWorkflowRun } from './shared/serializers';

const calibrationListQuerySchema = z
  .object({
    instrumentId: z.string().min(1).optional(),
    limit: z
      .string()
      .transform((value) => Number.parseInt(value, 10))
      .refine((value) => Number.isFinite(value) && value > 0, 'limit must be positive')
      .optional()
  })
  .partial();

const calibrationIdParamsSchema = z.object({ calibrationId: z.string().min(1) }).strict();

const calibrationUploadSchema = calibrationFileSchema.extend({
  filename: z.string().min(1).optional(),
  overwrite: z.boolean().optional()
});

const planIdParamsSchema = z.object({ planId: z.string().min(1) }).strict();

const planReprocessRequestSchema = z
  .object({
    mode: z.enum(['all', 'selected']).default('all'),
    selectedPartitions: z.array(z.string().min(1)).optional(),
    maxConcurrency: z.number().int().min(1).max(10).optional(),
    pollIntervalMs: z.number().int().min(250).max(10_000).optional(),
    runKey: z.string().min(1).optional(),
    triggeredBy: z.string().min(1).optional()
  })
  .strict();

function buildCalibrationResponsePayload(plan: CalibrationReprocessPlan) {
  const partitionCounts = computePartitionStateCounts(
    plan.calibrations.flatMap((entry) => entry.partitions)
  );
  return {
    plan,
    summary: buildPlanSummary(plan.calibrations),
    partitionStateCounts: partitionCounts
  };
}

export async function registerObservatoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/observatory/calibrations', async (request, reply) => {
    const auth = await requireOperatorScopes(request, reply, {
      action: 'observatory.calibrations.list',
      resource: 'observatory:calibrations',
      requiredScopes: OBSERVATORY_READ_SCOPES
    });
    if (!auth.ok) {
      return { error: auth.error };
    }

    const parsedQuery = calibrationListQuerySchema.safeParse(request.query ?? {});
    if (!parsedQuery.success) {
      reply.status(400);
      await auth.auth.log('failed', { reason: 'invalid_query', details: parsedQuery.error.flatten() });
      return { error: parsedQuery.error.flatten() };
    }

    try {
      const calibrations = await listCalibrationSnapshots({
        instrumentId: parsedQuery.data.instrumentId,
        limit: parsedQuery.data.limit
      });
      await auth.auth.log('succeeded', {
        instrumentId: parsedQuery.data.instrumentId ?? null,
        count: calibrations.length
      });
      return { data: { calibrations } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, 'Failed to list calibrations');
      reply.status(502);
      await auth.auth.log('failed', { reason: 'metastore_error', message });
      return { error: message };
    }
  });

  app.get('/observatory/calibrations/:calibrationId', async (request, reply) => {
    const auth = await requireOperatorScopes(request, reply, {
      action: 'observatory.calibrations.get',
      resource: 'observatory:calibrations',
      requiredScopes: OBSERVATORY_READ_SCOPES
    });
    if (!auth.ok) {
      return { error: auth.error };
    }

    const parsedParams = calibrationIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      reply.status(400);
      await auth.auth.log('failed', { reason: 'invalid_params', details: parsedParams.error.flatten() });
      return { error: parsedParams.error.flatten() };
    }

    try {
      const calibration = await getCalibrationSnapshot(parsedParams.data.calibrationId);
      if (!calibration) {
        reply.status(404);
        await auth.auth.log('failed', {
          reason: 'calibration_not_found',
          calibrationId: parsedParams.data.calibrationId
        });
        return { error: 'calibration not found' };
      }
      await auth.auth.log('succeeded', {
        calibrationId: calibration.calibrationId,
        instrumentId: calibration.instrumentId
      });
      return { data: calibration };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, 'Failed to load calibration');
      reply.status(502);
      await auth.auth.log('failed', {
        reason: 'metastore_error',
        calibrationId: parsedParams.data.calibrationId,
        message
      });
      return { error: message };
    }
  });

  app.post('/observatory/calibrations/upload', async (request, reply) => {
    const auth = await requireOperatorScopes(request, reply, {
      action: 'observatory.calibrations.upload',
      resource: 'observatory:calibrations',
      requiredScopes: OBSERVATORY_WRITE_SCOPES
    });
    if (!auth.ok) {
      return { error: auth.error };
    }

    const parsedBody = calibrationUploadSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      reply.status(400);
      await auth.auth.log('failed', { reason: 'invalid_payload', details: parsedBody.error.flatten() });
      return { error: parsedBody.error.flatten() };
    }

    try {
      const { filename, overwrite, ...calibrationRaw } = parsedBody.data;
      const calibration = calibrationFileSchema.parse({
        ...calibrationRaw,
        createdAt: calibrationRaw.createdAt ?? new Date().toISOString()
      });
      const serialized = `${JSON.stringify(calibration, null, 2)}\n`;
      const normalized = normalizeCalibrationDocument(calibration, serialized);
      const targetFilename = filename?.trim() || buildCalibrationFilename(calibration.instrumentId, normalized.effectiveAt);
      const { command, path } = await uploadCalibrationFile(serialized, targetFilename, {
        overwrite: overwrite ?? false
      });

      await auth.auth.log('succeeded', {
        calibrationId: normalized.calibrationId,
        instrumentId: normalized.instrumentId,
        effectiveAt: normalized.effectiveAt,
        path,
        nodeId: command.node?.id ?? null
      });

      reply.status(201);
      return {
        data: {
          calibrationId: normalized.calibrationId,
          instrumentId: normalized.instrumentId,
          effectiveAt: normalized.effectiveAt,
          path,
          nodeId: command.node?.id ?? null,
          checksum: normalized.checksum
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, 'Failed to upload calibration file');
      reply.status(502);
      await auth.auth.log('failed', { reason: 'filestore_error', message });
      return { error: message };
    }
  });

  app.get('/observatory/plans', async (request, reply) => {
    const auth = await requireOperatorScopes(request, reply, {
      action: 'observatory.plans.list',
      resource: 'observatory:plans',
      requiredScopes: OBSERVATORY_READ_SCOPES
    });
    if (!auth.ok) {
      return { error: auth.error };
    }

    const limitRaw = (request.query as Record<string, unknown> | undefined)?.limit;
    let limit: number | undefined;
    if (typeof limitRaw === 'string' && limitRaw.trim().length > 0) {
      const parsed = Number.parseInt(limitRaw.trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
    }

    try {
      const plans = await listCalibrationPlans({ limit });
      await auth.auth.log('succeeded', { count: plans.length });
      return { data: { plans } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, 'Failed to list calibration plans');
      reply.status(502);
      await auth.auth.log('failed', { reason: 'metastore_error', message });
      return { error: message };
    }
  });

  app.get('/observatory/plans/:planId', async (request, reply) => {
    const auth = await requireOperatorScopes(request, reply, {
      action: 'observatory.plans.get',
      resource: 'observatory:plans',
      requiredScopes: OBSERVATORY_READ_SCOPES
    });
    if (!auth.ok) {
      return { error: auth.error };
    }

    const parsedParams = planIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      reply.status(400);
      await auth.auth.log('failed', { reason: 'invalid_params', details: parsedParams.error.flatten() });
      return { error: parsedParams.error.flatten() };
    }

    try {
      const planSummary = await getCalibrationPlanSummary(parsedParams.data.planId);
      if (!planSummary) {
        reply.status(404);
        await auth.auth.log('failed', {
          reason: 'plan_not_found',
          planId: parsedParams.data.planId
        });
        return { error: 'plan not found' };
      }

      const artifact = await loadPlanArtifact(planSummary.storage, {});
      if (!artifact) {
        reply.status(502);
        await auth.auth.log('failed', {
          reason: 'plan_artifact_missing',
          planId: planSummary.planId
        });
        return { error: 'plan artifact missing' };
      }

      let parsedPlan: CalibrationReprocessPlan;
      try {
        const parsedJson = JSON.parse(artifact.content) as unknown;
        parsedPlan = calibrationReprocessPlanSchema.parse(parsedJson);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.status(502);
        await auth.auth.log('failed', {
          reason: 'plan_parse_failed',
          planId: planSummary.planId,
          message
        });
        return { error: `Failed to parse plan artifact: ${message}` };
      }

      await auth.auth.log('succeeded', {
        planId: planSummary.planId,
        state: planSummary.state,
        partitionCount: planSummary.partitionCount
      });

      const payload = buildCalibrationResponsePayload(parsedPlan);

      return {
        data: {
          plan: payload.plan,
          summary: planSummary,
          artifact: {
            path: artifact.path,
            nodeId: artifact.nodeId
          },
          computed: {
            partitionStateCounts: payload.partitionStateCounts,
            summary: payload.summary
          }
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, 'Failed to load calibration plan');
      reply.status(502);
      await auth.auth.log('failed', {
        reason: 'plan_load_failed',
        planId: parsedParams.success ? parsedParams.data.planId : null,
        message
      });
      return { error: message };
    }
  });

  app.post('/observatory/plans/:planId/reprocess', async (request, reply) => {
    const candidatePlanId = typeof (request.params as Record<string, unknown> | undefined)?.planId === 'string'
      ? (request.params as Record<string, unknown>).planId!
      : 'unknown';

    const auth = await requireOperatorScopes(request, reply, {
      action: 'observatory.plans.reprocess',
      resource: `observatory:plan:${candidatePlanId}`,
      requiredScopes: OBSERVATORY_REPROCESS_SCOPES
    });
    if (!auth.ok) {
      return { error: auth.error };
    }

    const parsedParams = planIdParamsSchema.safeParse(request.params ?? {});
    if (!parsedParams.success) {
      reply.status(400);
      await auth.auth.log('failed', { reason: 'invalid_params', details: parsedParams.error.flatten() });
      return { error: parsedParams.error.flatten() };
    }

    const parsedBody = planReprocessRequestSchema.safeParse(request.body ?? {});
    if (!parsedBody.success) {
      reply.status(400);
      await auth.auth.log('failed', { reason: 'invalid_payload', details: parsedBody.error.flatten() });
      return { error: parsedBody.error.flatten() };
    }

    const config = await getObservatoryCalibrationConfig();

    try {
      const planSummary = await getCalibrationPlanSummary(parsedParams.data.planId);
      if (!planSummary) {
        reply.status(404);
        await auth.auth.log('failed', {
          reason: 'plan_not_found',
          planId: parsedParams.data.planId
        });
        return { error: 'plan not found' };
      }

      const artifact = await loadPlanArtifact(planSummary.storage, {});
      if (!artifact) {
        reply.status(502);
        await auth.auth.log('failed', {
          reason: 'plan_artifact_missing',
          planId: planSummary.planId
        });
        return { error: 'plan artifact missing' };
      }

      let parsedPlan: CalibrationReprocessPlan;
      try {
        parsedPlan = calibrationReprocessPlanSchema.parse(JSON.parse(artifact.content) as unknown);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reply.status(502);
        await auth.auth.log('failed', {
          reason: 'plan_parse_failed',
          planId: planSummary.planId,
          message
        });
        return { error: `Failed to parse plan artifact: ${message}` };
      }

      const selectedMode = parsedBody.data.mode;
      const requestedPartitions = parsedBody.data.selectedPartitions ?? [];
      const availablePartitions = new Set(
        parsedPlan.calibrations.flatMap((entry) =>
          entry.partitions.map((partition) => partition.partitionKey || partition.minute)
        )
      );

      let selectedPartitions: string[] = [];
      if (selectedMode === 'selected') {
        if (requestedPartitions.length === 0) {
          reply.status(400);
          await auth.auth.log('failed', {
            reason: 'selected_partitions_required',
            planId: planSummary.planId
          });
          return { error: 'selectedPartitions is required when mode is "selected"' };
        }
        const missing = requestedPartitions.filter((partition) => !availablePartitions.has(partition));
        if (missing.length > 0) {
          reply.status(400);
          await auth.auth.log('failed', {
            reason: 'unknown_partition_keys',
            planId: planSummary.planId,
            missing
          });
          return { error: `Unknown partition keys: ${missing.join(', ')}` };
        }
        selectedPartitions = requestedPartitions;
      }

      const workflow = await getWorkflowDefinitionBySlug(config.workflows.reprocessSlug);
      if (!workflow) {
        reply.status(500);
        await auth.auth.log('failed', {
          reason: 'workflow_missing',
          workflowSlug: config.workflows.reprocessSlug
        });
        return { error: `Reprocess workflow ${config.workflows.reprocessSlug} is not registered` };
      }

      const partitionedAssets = collectPartitionedAssetsFromSteps(workflow.steps);
      let partitionKey: string | null = null;
      const planPartitionKeyCandidate = planSummary.planId;
      if (partitionedAssets.size > 0) {
        for (const partitioning of partitionedAssets.values()) {
          const validation = validatePartitionKey(partitioning ?? null, planPartitionKeyCandidate);
          if (!validation.ok) {
            reply.status(400);
            await auth.auth.log('failed', {
              reason: 'invalid_partition_key',
              planId: planSummary.planId,
              message: validation.error
            });
            return { error: `Invalid partition key for workflow: ${validation.error}` };
          }
          partitionKey = validation.key;
        }
      } else {
        partitionKey = planPartitionKeyCandidate;
      }

      const runKeyCandidate = parsedBody.data.runKey?.trim() || `${planSummary.planId}-${Date.now()}`;
      let runKeyColumns: { runKey: string | null; runKeyNormalized: string | null };
      try {
        runKeyColumns = computeRunKeyColumns(runKeyCandidate);
      } catch (error) {
        reply.status(400);
        await auth.auth.log('failed', {
          reason: 'invalid_run_key',
          planId: planSummary.planId,
          message: (error as Error).message
        });
        return { error: (error as Error).message };
      }

      const parameters = {
        planPath: artifact.path,
        planNodeId: artifact.nodeId,
        planId: planSummary.planId,
        mode: selectedMode,
        selectedPartitions,
        maxConcurrency: parsedBody.data.maxConcurrency ?? config.defaults.maxConcurrency,
        pollIntervalMs: parsedBody.data.pollIntervalMs ?? config.defaults.pollIntervalMs,
        catalogBaseUrl: config.catalog.baseUrl,
        catalogApiToken: config.catalog.apiToken,
        filestoreBaseUrl: config.filestore.runtime.baseUrl,
        filestoreBackendId: config.filestore.backendId,
        filestoreToken: config.filestore.runtime.token ?? null,
        filestorePrincipal: config.filestore.reprocessPrincipal,
        metastoreBaseUrl: config.metastore.runtime.baseUrl,
        metastoreNamespace: config.metastore.planNamespace,
        metastoreAuthToken: config.metastore.runtime.token ?? null
      } satisfies Record<string, unknown>;

      const triggeredBy =
        parsedBody.data.triggeredBy?.trim() || `observatory-calibration-ops:${auth.auth.identity.subject}`;

      let run;
      try {
        run = await createWorkflowRun(workflow.id, {
          parameters,
          triggeredBy,
          partitionKey,
          runKey: runKeyColumns.runKey
        });
      } catch (error) {
        if (runKeyColumns.runKeyNormalized && isRunKeyConflict(error)) {
          const existing = await getActiveWorkflowRunByKey(workflow.id, runKeyColumns.runKeyNormalized);
          if (existing) {
            reply.status(409);
            await auth.auth.log('failed', {
              reason: 'run_key_conflict',
              planId: planSummary.planId,
              runKey: runKeyColumns.runKey,
              existingRunId: existing.id
            });
            return {
              error: 'workflow run with the provided runKey is already pending or running',
              data: serializeWorkflowRun(existing)
            };
          }
        }
        throw error;
      }

      try {
        await enqueueWorkflowRun(run.id, { runKey: run.runKey ?? runKeyColumns.runKey ?? null });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to enqueue observatory reprocess run');
        const message = error instanceof Error ? error.message : 'Failed to enqueue workflow run';
        await updateWorkflowRun(run.id, {
          status: 'failed',
          errorMessage: message,
          completedAt: new Date().toISOString(),
          durationMs: 0
        });
        reply.status(502);
        await auth.auth.log('failed', {
          reason: 'enqueue_failed',
          planId: planSummary.planId,
          runId: run.id,
          message
        });
        return { error: message };
      }

      await auth.auth.log('succeeded', {
        planId: planSummary.planId,
        runId: run.id,
        mode: selectedMode,
        selectedCount: selectedPartitions.length,
        partitionKey
      });

      reply.status(202);
      return {
        data: {
          run: serializeWorkflowRun(run),
          workflowSlug: workflow.slug,
          planId: planSummary.planId,
          mode: selectedMode,
          selectedPartitions,
          parameters
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      request.log.error({ err: error }, 'Failed to initiate calibration reprocess');
      reply.status(502);
      await auth.auth.log('failed', {
        reason: 'reprocess_failed',
        planId: parsedParams.data.planId,
        message
      });
      return { error: message };
    }
  });
}
