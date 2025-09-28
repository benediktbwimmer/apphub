import { randomUUID } from 'node:crypto';
import type { LifecycleAuditLogInput, PartitionWithTarget } from '../db/metadata';
import { replacePartitionsInManifest, getPartitionsWithTargetsForManifest } from '../db/metadata';
import { refreshManifestCache } from '../cache/manifestCache';
import { createDefaultRetentionPolicy, type RetentionPolicy } from './types';
import type { LifecycleJobContext, LifecycleOperationExecutionResult } from './types';
import { publishTimestoreEvent } from '../events/publisher';
import { invalidateSqlRuntimeCache } from '../sql/runtime';

export async function enforceRetention(
  context: LifecycleJobContext,
  partitions: PartitionWithTarget[]
): Promise<LifecycleOperationExecutionResult> {
  const policy = context.retentionPolicy ?? createDefaultRetentionPolicy(context.config);
  const graceMinutes = policy.deleteGraceMinutes ?? context.config.lifecycle.retention.deleteGraceMinutes;
  const graceMs = graceMinutes * 60_000;
  const nowMs = Date.now();
  const deletions = new Map<string, PartitionWithTarget>();

  const maxAgeHours = policy.rules.maxAgeHours;
  if (maxAgeHours && maxAgeHours > 0) {
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    const effectiveThreshold = nowMs - maxAgeMs;
    for (const partition of partitions) {
      const endMs = new Date(partition.endTime).getTime();
      if (Number.isFinite(endMs) && endMs + graceMs <= effectiveThreshold) {
        deletions.set(partition.id, partition);
      }
    }
  }

  const maxTotalBytes = policy.rules.maxTotalBytes;
  if (maxTotalBytes && maxTotalBytes > 0) {
    let totalBytes = partitions.reduce((acc, partition) => acc + (partition.fileSizeBytes ?? 0), 0);
    if (totalBytes > maxTotalBytes) {
      const sorted = [...partitions]
        .filter((partition) => !deletions.has(partition.id))
        .sort((a, b) => new Date(a.endTime).getTime() - new Date(b.endTime).getTime());

      for (const partition of sorted) {
        if (totalBytes <= maxTotalBytes) {
          break;
        }
        deletions.set(partition.id, partition);
        totalBytes -= partition.fileSizeBytes ?? 0;
      }
    }
  }

  if (deletions.size === 0) {
    return {
      operation: 'retention',
      status: 'skipped',
      message: 'no partitions met retention criteria'
    };
  }

  const summaryPayload = {
    appliedAt: new Date().toISOString(),
    removedPartitionIds: Array.from(deletions.keys()),
    policy: {
      maxAgeHours: policy.rules.maxAgeHours,
      maxTotalBytes: policy.rules.maxTotalBytes
    }
  } as Record<string, unknown>;

  const metadataPayload = {
    appliedAt: new Date().toISOString(),
    previousManifestId: context.manifest.id,
    removedCount: deletions.size
  } as Record<string, unknown>;

  const summaryPatch = {
    lifecycle: {
      retention: summaryPayload
    }
  } as Record<string, unknown>;

  const metadataPatch = {
    lifecycle: {
      retention: metadataPayload
    }
  } as Record<string, unknown>;

  const manifestAfterUpdate = await replacePartitionsInManifest({
    datasetId: context.dataset.id,
    manifestId: context.manifest.id,
    removePartitionIds: Array.from(deletions.keys()),
    addPartitions: [],
    summaryPatch,
    metadataPatch
  });

  try {
    const partitionsWithTargets = await getPartitionsWithTargetsForManifest(manifestAfterUpdate.id);
    const { partitions: _cachedPartitions, ...manifestRecord } = manifestAfterUpdate;
    await refreshManifestCache(
      { id: context.dataset.id, slug: context.dataset.slug },
      manifestRecord,
      partitionsWithTargets
    );
  } catch (err) {
    console.warn('[timestore] failed to refresh manifest cache after retention', err);
  }

  const auditEvents: LifecycleAuditLogInput[] = [];
  let bytesDeleted = 0;

  for (const partition of deletions.values()) {
    bytesDeleted += partition.fileSizeBytes ?? 0;
    auditEvents.push({
      id: `la-${randomUUID()}`,
      datasetId: context.dataset.id,
      manifestId: context.manifest.id,
      eventType: 'retention.partition.deleted',
      payload: {
        datasetId: context.dataset.id,
        partitionId: partition.id,
        storageTargetId: partition.storageTargetId,
        bytes: partition.fileSizeBytes ?? 0,
        reason: buildRetentionReason(partition, policy, graceMs, nowMs)
      }
    });
  }

  if (deletions.size > 0) {
    try {
      await publishTimestoreEvent(
        'timestore.partition.deleted',
        {
          datasetId: context.dataset.id,
          datasetSlug: context.dataset.slug,
          manifestId: context.manifest.id,
          partitions: Array.from(deletions.values()).map((partition) => ({
            id: partition.id,
            storageTargetId: partition.storageTargetId,
            partitionKey: partition.partitionKey ?? null,
            startTime: partition.startTime,
            endTime: partition.endTime,
            filePath: partition.filePath,
            fileSizeBytes: partition.fileSizeBytes ?? null,
            reason: buildRetentionReason(partition, policy, graceMs, nowMs)
          }))
        },
        'timestore.lifecycle'
      );
    } catch (err) {
      console.error('[timestore] failed to publish partition.deleted event', err);
    }
  }

  invalidateSqlRuntimeCache();

  return {
    operation: 'retention',
    status: 'completed',
    manifest: manifestAfterUpdate,
    auditEvents,
    totals: {
      partitions: deletions.size,
      bytes: bytesDeleted
    },
    partitionsToDelete: Array.from(deletions.values())
  };
}

function buildRetentionReason(
  partition: PartitionWithTarget,
  policy: RetentionPolicy,
  graceMs: number,
  nowMs: number
): Record<string, unknown> {
  const reasons: Record<string, unknown> = {};

  if (policy.rules.maxAgeHours) {
    const maxAgeMs = policy.rules.maxAgeHours * 60 * 60 * 1000;
    const threshold = nowMs - maxAgeMs;
    const endMs = new Date(partition.endTime).getTime();
    if (Number.isFinite(endMs) && endMs + graceMs <= threshold) {
      reasons.maxAgeHours = policy.rules.maxAgeHours;
    }
  }

  if (policy.rules.maxTotalBytes) {
    reasons.maxTotalBytes = policy.rules.maxTotalBytes;
  }

  return reasons;
}
