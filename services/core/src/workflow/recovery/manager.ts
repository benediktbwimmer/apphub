import { logger } from '../../observability/logger';
import {
  ensureAssetRecoveryRequest as ensureAssetRecoveryRequestRecord,
  findAssetProducer,
  getWorkflowAssetProvenance,
  updateAssetRecoveryRequest
} from '../../db/assetRecovery';
import { getWorkflowAssetPartitionParameters, createWorkflowRun } from '../../db/workflows';
import type {
  JsonValue,
  WorkflowDefinitionRecord,
  WorkflowRunRecord,
  WorkflowRunStepRecord,
  WorkflowStepDefinition,
  WorkflowAssetRecoveryRequestRecord
} from '../../db/types';
import { buildRunKeyFromParts } from '../../workflows/runKey';
import { enqueueWorkflowRun } from '../../queue';
import { recordAssetRecoveryFailed, recordAssetRecoveryScheduled } from '../../observability/recoveryMetrics';

const RECOVERY_POLL_DELAY_MS = Math.max(15_000, Number(process.env.ASSET_RECOVERY_POLL_INTERVAL_MS ?? 30_000));

export type AssetRecoveryDescriptor = {
  assetId: string;
  partitionKey: string | null;
  capability?: string | null;
  resource?: string | null;
};

export type RecoveryRequestOutcome = {
  request: WorkflowAssetRecoveryRequestRecord;
  producerWorkflowDefinitionId: string;
};

function normalizePartitionKey(value: string | null): { raw: string | null; normalized: string } {
  if (value) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return { raw: trimmed, normalized: trimmed.toLowerCase() };
    }
  }
  return { raw: null, normalized: '' };
}

function buildRecoveryMetadata(options: {
  descriptor: AssetRecoveryDescriptor;
  failingDefinition: WorkflowDefinitionRecord;
  failingRun: WorkflowRunRecord;
  step: WorkflowStepDefinition;
  stepRecord: WorkflowRunStepRecord;
}): JsonValue {
  return {
    asset: {
      assetId: options.descriptor.assetId,
      partitionKey: options.descriptor.partitionKey,
      capability: options.descriptor.capability ?? null,
      resource: options.descriptor.resource ?? null
    },
    consumer: {
      workflowDefinitionId: options.failingDefinition.id,
      workflowSlug: options.failingDefinition.slug,
      workflowRunId: options.failingRun.id,
      stepId: options.step.id,
      workflowRunStepId: options.stepRecord.id
    }
  } satisfies JsonValue;
}

export async function ensureAssetRecoveryRequest(
  options: {
    descriptor: AssetRecoveryDescriptor;
    failingDefinition: WorkflowDefinitionRecord;
    failingRun: WorkflowRunRecord;
    step: WorkflowStepDefinition;
    stepRecord: WorkflowRunStepRecord;
  }
): Promise<RecoveryRequestOutcome | null> {
  const { descriptor, failingDefinition, failingRun, step, stepRecord } = options;
  const partition = normalizePartitionKey(descriptor.partitionKey);

  let producerDefinitionId: string | null = null;

  try {
    const provenance = await getWorkflowAssetProvenance({
      assetId: descriptor.assetId,
      partitionKey: partition.raw
    });
    if (provenance) {
      producerDefinitionId = provenance.workflowDefinitionId;
    }
  } catch (err) {
    logger.warn('workflow.recovery.provenance_lookup_failed', {
      assetId: descriptor.assetId,
      partitionKey: partition.raw,
      error: err instanceof Error ? err.message : 'unknown'
    });
  }

  if (!producerDefinitionId) {
    try {
      const producer = await findAssetProducer(descriptor.assetId);
      if (producer) {
        producerDefinitionId = producer.workflowDefinitionId;
      }
    } catch (err) {
      logger.warn('workflow.recovery.producer_lookup_failed', {
        assetId: descriptor.assetId,
        partitionKey: partition.raw,
        error: err instanceof Error ? err.message : 'unknown'
      });
    }
  }

  if (!producerDefinitionId) {
    producerDefinitionId = failingDefinition.id;
  }

  const metadata = buildRecoveryMetadata({ descriptor, failingDefinition, failingRun, step, stepRecord });

  const request = await ensureAssetRecoveryRequestRecord({
    assetId: descriptor.assetId,
    workflowDefinitionId: producerDefinitionId,
    partitionKey: partition.raw,
    requestedByWorkflowRunId: failingRun.id,
    requestedByWorkflowRunStepId: stepRecord.id,
    requestedByStepId: step.id,
    metadata
  });

  if (request.status === 'pending' && !request.recoveryWorkflowRunId) {
    const now = new Date().toISOString();
    try {
      const partitionParams = await getWorkflowAssetPartitionParameters(
        producerDefinitionId,
        descriptor.assetId,
        partition.raw
      );

      const runParameters = (partitionParams?.parameters ?? failingRun.parameters) as JsonValue;

      const runKey = buildRunKeyFromParts('asset-recovery', descriptor.assetId, partition.normalized);
      const recoveryRun = await createWorkflowRun(producerDefinitionId, {
        parameters: runParameters,
        triggeredBy: 'system:asset-recovery',
        trigger: {
          reason: 'asset_recovery',
          assetId: descriptor.assetId,
          partitionKey: partition.raw,
          requestedByRunId: failingRun.id,
          capability: descriptor.capability ?? null,
          resource: descriptor.resource ?? null
        } satisfies JsonValue,
        partitionKey: partition.raw,
        runKey
      });

      await enqueueWorkflowRun(recoveryRun.id, {
        runKey: recoveryRun.runKey ?? runKey ?? null
      });

      const updated = await updateAssetRecoveryRequest(request.id, {
        status: 'running',
        recoveryWorkflowDefinitionId: producerDefinitionId,
        recoveryWorkflowRunId: recoveryRun.id,
        attempts: request.attempts + 1,
        lastAttemptAt: now
      });

      recordAssetRecoveryScheduled();

      return {
        request: updated ?? request,
        producerWorkflowDefinitionId: producerDefinitionId
      } satisfies RecoveryRequestOutcome;
    } catch (err) {
      logger.error('workflow.recovery.schedule_failed', {
        assetId: descriptor.assetId,
        partitionKey: partition.raw,
        workflowDefinitionId: producerDefinitionId,
        error: err instanceof Error ? err.message : 'unknown'
      });
      const failed = await updateAssetRecoveryRequest(request.id, {
        status: 'failed',
        lastError: err instanceof Error ? err.message : 'unknown',
        completedAt: now
      });
      recordAssetRecoveryFailed('schedule_error');
      return failed
        ? { request: failed, producerWorkflowDefinitionId: producerDefinitionId }
        : { request, producerWorkflowDefinitionId: producerDefinitionId };
    }
  }

  return {
    request,
    producerWorkflowDefinitionId: producerDefinitionId
  } satisfies RecoveryRequestOutcome;
}

export function getRecoveryPollDelayMs(): number {
  return RECOVERY_POLL_DELAY_MS;
}
