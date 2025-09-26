import { promises as fs } from 'node:fs';
import type { Stats } from 'node:fs';
import path from 'node:path';
import type { PoolClient } from 'pg';
import type { BackendMountRecord } from '../../db/backendMounts';
import {
  getNodeById,
  getNodeByPath,
  insertNode,
  updateNodeState,
  type ConsistencyState,
  type NodeRecord
} from '../../db/nodes';
import { recordSnapshot } from '../../db/snapshots';
import { FilestoreError } from '../../errors';
import { getParentPath } from '../../utils/path';
import {
  applyRollupPlanWithinTransaction,
  collectAncestorChain,
  computeContribution
} from '../../rollup/manager';
import { createEmptyRollupPlan, type RollupPlan } from '../../rollup/types';
import type { ReconciliationJobPayload, ReconciliationJobSummary } from '../types';

type AppliedPlan = Awaited<ReturnType<typeof applyRollupPlanWithinTransaction>>;

function ensureLocalBackend(
  backend: BackendMountRecord
): asserts backend is BackendMountRecord & { backendKind: 'local'; rootPath: string } {
  if (backend.backendKind !== 'local') {
    throw new FilestoreError('Expected local backend for local reconciliation strategy', 'BACKEND_NOT_FOUND');
  }
  if (!backend.rootPath) {
    throw new FilestoreError('Local backend missing root path', 'BACKEND_NOT_FOUND', { backendId: backend.id });
  }
}

async function statOptional(target: string): Promise<Stats | null> {
  try {
    return await fs.stat(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

type Contribution = ReturnType<typeof computeContribution>;

function diffContribution(before: Contribution, after: Contribution) {
  return {
    sizeBytesDelta: after.sizeBytes - before.sizeBytes,
    fileCountDelta: after.fileCount - before.fileCount,
    directoryCountDelta: after.directoryCount - before.directoryCount,
    childCountDelta: (after.active ? 1 : 0) - (before.active ? 1 : 0)
  };
}

async function buildAncestorPlan(
  client: PoolClient,
  node: NodeRecord,
  contributionDiff: ReturnType<typeof diffContribution>,
  plan: RollupPlan
): Promise<void> {
  if (!node.parentId) {
    return;
  }
  const parent = await getNodeById(client, node.parentId, { forUpdate: true });
  if (!parent) {
    return;
  }
  const ancestors = await collectAncestorChain(client, parent);
  ancestors.forEach((ancestor, index) => {
    const childCountDelta = index === 0 ? contributionDiff.childCountDelta : 0;
    if (
      contributionDiff.sizeBytesDelta !== 0 ||
      contributionDiff.fileCountDelta !== 0 ||
      contributionDiff.directoryCountDelta !== 0 ||
      childCountDelta !== 0
    ) {
      plan.increments.push({
        nodeId: ancestor.id,
        sizeBytesDelta: contributionDiff.sizeBytesDelta,
        fileCountDelta: contributionDiff.fileCountDelta,
        directoryCountDelta: contributionDiff.directoryCountDelta,
        childCountDelta,
        markPending: false
      });
      plan.touchedNodeIds.push(ancestor.id);
      if (index === 0) {
        plan.scheduleCandidates.push({
          nodeId: ancestor.id,
          backendMountId: ancestor.backendMountId,
          reason: 'mutation',
          depth: ancestor.depth,
          childCountDelta
        });
      }
    }
  });
}

function buildMetadata(node: NodeRecord | null, stats: Stats): Record<string, unknown> {
  const base = node?.metadata ?? {};
  return {
    ...base,
    mode: stats.mode,
    uid: stats.uid,
    gid: stats.gid
  };
}

function detectNodeKind(stats: Stats): NodeRecord['kind'] {
  if (stats.isDirectory()) {
    return 'directory';
  }
  return 'file';
}

export async function reconcileLocal(
  client: PoolClient,
  backend: BackendMountRecord,
  job: ReconciliationJobPayload
): Promise<ReconciliationJobSummary> {
  ensureLocalBackend(backend);

  const normalizedPath = job.path.trim();
  if (!normalizedPath) {
    return { status: 'skipped', reason: job.reason };
  }

  const root = path.resolve(backend.rootPath);
  const resolvedPath = path.resolve(root, normalizedPath);
  if (!resolvedPath.startsWith(root)) {
    throw new FilestoreError('Resolved path escapes backend root during reconciliation', 'INVALID_PATH', {
      root,
      requestedPath: normalizedPath
    });
  }

  const node = job.nodeId
    ? await getNodeById(client, job.nodeId, { forUpdate: true })
    : await getNodeByPath(client, backend.id, normalizedPath, { forUpdate: true });

  const stats = await statOptional(resolvedPath);
  const plan = createEmptyRollupPlan();
  const now = new Date();

  if (!stats) {
    if (!node) {
      return { status: 'skipped', reason: job.reason };
    }

    const beforeContribution = computeContribution(node);
    const updated = await updateNodeState(client, node.id, 'missing', {
      sizeBytes: node.sizeBytes,
      metadata: node.metadata,
      lastModifiedAt: node.lastModifiedAt,
      consistencyState: 'missing',
      consistencyCheckedAt: now,
      lastReconciledAt: node.lastReconciledAt ?? null
    });
    await recordSnapshot(client, updated);

    plan.touchedNodeIds.push(updated.id);
    const afterContribution = computeContribution(updated);
    const contributionDiff = diffContribution(beforeContribution, afterContribution);
    plan.invalidate.push({ nodeId: updated.id, state: 'invalid' });
    await buildAncestorPlan(client, updated, contributionDiff, plan);
    let appliedPlan: AppliedPlan | null = null;
    if (
      plan.ensure.length > 0 ||
      plan.increments.length > 0 ||
      plan.invalidate.length > 0 ||
      plan.touchedNodeIds.length > 0
    ) {
      appliedPlan = await applyRollupPlanWithinTransaction(client, plan);
    }

    return {
      status: 'missing',
      reason: job.reason,
      node: updated,
      previousNode: node,
      plan,
      appliedPlan,
      emittedEvent: {
        type: 'filestore.node.missing',
        node: updated,
        previousState: node.state
      }
    } satisfies ReconciliationJobSummary;
  }

  const metadata = buildMetadata(node ?? null, stats);
  const sizeBytes = stats.isDirectory() ? 0 : stats.size;
  const kind = detectNodeKind(stats);
  const consistencyState: ConsistencyState = 'active';

  if (!node) {
    const parentPath = getParentPath(normalizedPath);
    let parentId: number | null = null;
    if (parentPath) {
      const parent = await getNodeByPath(client, backend.id, parentPath, { forUpdate: true });
      if (!parent) {
        throw new FilestoreError('Parent directory not tracked for reconciled node', 'PARENT_NOT_FOUND', {
          backendMountId: backend.id,
          path: parentPath
        });
      }
      parentId = parent.id;
    }

    const inserted = await insertNode(client, {
      backendMountId: backend.id,
      parentId,
      path: normalizedPath,
      kind,
      sizeBytes,
      metadata,
      lastModifiedAt: stats.mtime,
      state: 'active',
      consistencyState,
      consistencyCheckedAt: now,
      lastReconciledAt: now
    });
    await recordSnapshot(client, inserted);

    plan.ensure.push(inserted.id);
    plan.touchedNodeIds.push(inserted.id);
    const beforeContribution = computeContribution(null);
    const afterContribution = computeContribution(inserted);
    const contributionDiff = diffContribution(beforeContribution, afterContribution);
    await buildAncestorPlan(client, inserted, contributionDiff, plan);
    let appliedPlan: AppliedPlan | null = null;
    if (
      plan.ensure.length > 0 ||
      plan.increments.length > 0 ||
      plan.invalidate.length > 0 ||
      plan.touchedNodeIds.length > 0
    ) {
      appliedPlan = await applyRollupPlanWithinTransaction(client, plan);
    }

    return {
      status: 'reconciled',
      reason: job.reason,
      node: inserted,
      previousNode: null,
      plan,
      appliedPlan,
      emittedEvent: {
        type: 'filestore.node.reconciled',
        node: inserted
      }
    } satisfies ReconciliationJobSummary;
  }

  const previousContribution = computeContribution(node);
  const updated = await updateNodeState(client, node.id, 'active', {
    sizeBytes,
    metadata,
    lastModifiedAt: stats.mtime,
    consistencyState,
    consistencyCheckedAt: now,
    lastReconciledAt: now
  });
  await recordSnapshot(client, updated);

  plan.ensure.push(updated.id);
  plan.touchedNodeIds.push(updated.id);
  const afterContribution = computeContribution(updated);
  const contributionDiff = diffContribution(previousContribution, afterContribution);
  await buildAncestorPlan(client, updated, contributionDiff, plan);
  let appliedPlan: AppliedPlan | null = null;
  if (
    plan.ensure.length > 0 ||
    plan.increments.length > 0 ||
    plan.invalidate.length > 0 ||
    plan.touchedNodeIds.length > 0
  ) {
    appliedPlan = await applyRollupPlanWithinTransaction(client, plan);
  }

  return {
    status: 'reconciled',
    reason: job.reason,
    node: updated,
    previousNode: node,
    plan,
    appliedPlan,
    emittedEvent: {
      type: 'filestore.node.reconciled',
      node: updated
    }
  } satisfies ReconciliationJobSummary;
}
