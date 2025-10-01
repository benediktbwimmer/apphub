import type { PoolClient } from 'pg';
import { withTransaction, withConnection } from '../db/client';
import { getBackendMountById } from '../db/backendMounts';
import {
  getNodeByPath,
  insertNode,
  insertNodeIfAbsent,
  ensureNoActiveChildren,
  updateNodeState,
  updateNodeMetadata,
  listNodeSubtreeByPath,
  updateNodeLocation,
  NodeRecord,
  getNodeById
} from '../db/nodes';
import { recordSnapshot } from '../db/snapshots';
import { filestoreCommandSchema, type FilestoreCommand } from './types';
import { normalizePath, getParentPath } from '../utils/path';
import { FilestoreError, assertUnreachable } from '../errors';
import { resolveExecutor } from '../executors/registry';
import type { CommandExecutor, ExecutorResult } from '../executors/types';
import type { BackendMountRecord } from '../db/backendMounts';
import { emitCommandCompleted } from '../events/bus';
import {
  applyRollupPlanWithinTransaction,
  finalizeRollupPlan,
  collectAncestorChain,
  computeContribution
} from '../rollup/manager';
import { createEmptyRollupPlan, type AppliedRollupPlan, type RollupPlan } from '../rollup/types';
import { loadServiceConfig } from '../config/serviceConfig';
import { pruneJournalEntriesOlderThan } from '../db/journal';

export type RunCommandOptions = {
  command: unknown;
  principal?: string;
  requestId?: string;
  idempotencyKey?: string;
  executors?: Map<string, CommandExecutor>;
};

export type CommandResultPayload = Record<string, unknown>;

export type RunCommandResult = {
  journalEntryId: number;
  command: FilestoreCommand;
  node?: NodeRecord | null;
  result: CommandResultPayload;
  idempotent: boolean;
};

type InternalCommandOutcome = {
  primaryNode: NodeRecord | null;
  affectedNodeIds: number[];
  backendMountId: number;
  result: CommandResultPayload;
  rollupPlan: RollupPlan;
  idempotent: boolean;
};

type Contribution = ReturnType<typeof computeContribution>;

function diffContribution(before: Contribution, after: Contribution) {
  return {
    sizeBytesDelta: after.sizeBytes - before.sizeBytes,
    fileCountDelta: after.fileCount - before.fileCount,
    directoryCountDelta: after.directoryCount - before.directoryCount,
    childCountDelta: (after.active ? 1 : 0) - (before.active ? 1 : 0)
  };
}

const MS_PER_DAY = 86_400_000;
let lastJournalPruneAt = 0;
let journalPruneInFlight: Promise<void> | null = null;

function toInteger(value: unknown, label: string): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    throw new Error(`${label} must be a finite integer`);
  }
  if (!Number.isSafeInteger(numeric)) {
    throw new Error(`${label} exceeds JavaScript safe integer range`);
  }
  return numeric;
}

function scheduleJournalPrune(): void {
  const config = loadServiceConfig();
  const retentionDays = config.journal.retentionDays;
  if (retentionDays <= 0) {
    return;
  }

  const now = Date.now();
  if (config.journal.pruneIntervalMs > 0 && now - lastJournalPruneAt < config.journal.pruneIntervalMs) {
    return;
  }

  if (journalPruneInFlight) {
    return;
  }

  lastJournalPruneAt = now;
  const cutoff = new Date(now - retentionDays * MS_PER_DAY);
  const limit = config.journal.pruneBatchSize;

  journalPruneInFlight = pruneJournalEntriesOlderThan(cutoff, limit)
    .then((deleted) => {
      if (deleted >= limit) {
        // If we hit the limit, immediately allow another pass so we don't lag behind.
        lastJournalPruneAt = 0;
      }
    })
    .catch((err) => {
      console.warn('[filestore] failed to prune journal entries', { err });
    })
    .finally(() => {
      journalPruneInFlight = null;
    });
}

async function applyCreateDirectory(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'createDirectory' },
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  const normalizedPath = normalizePath(command.path);

  const existing = await getNodeByPath(client, backend.id, normalizedPath, { forUpdate: true });
  if (existing && existing.state !== 'deleted') {
    throw new FilestoreError('Node already exists at target path', 'NODE_EXISTS', {
      backendMountId: backend.id,
      path: normalizedPath
    });
  }

  const parentPath = getParentPath(normalizedPath);
  let parentId: number | null = null;
  let parent: NodeRecord | null = null;
  if (parentPath) {
    const resolvedParent = await getNodeByPath(client, backend.id, parentPath, { forUpdate: true });
    if (!resolvedParent) {
      throw new FilestoreError('Parent directory not found', 'PARENT_NOT_FOUND', {
        backendMountId: backend.id,
        path: parentPath
      });
    }
    if (resolvedParent.kind !== 'directory') {
      throw new FilestoreError('Parent is not a directory', 'NOT_A_DIRECTORY', {
        backendMountId: backend.id,
        path: parentPath
      });
    }
    parent = resolvedParent;
    parentId = resolvedParent.id;
  }

  const executorResult = await executor.execute(command, { backend });
  const metadata = {
    ...(command.metadata ?? {}),
    ...(executorResult.metadata ?? {})
  };

  const baseMetadata = {
    checksum: executorResult.checksum ?? null,
    contentHash: executorResult.contentHash ?? null,
    sizeBytes: executorResult.sizeBytes ?? 0,
    metadata,
    lastModifiedAt: executorResult.lastModifiedAt ?? new Date()
  } as const;

  let node: NodeRecord;
  if (existing && existing.state === 'deleted') {
    node = await updateNodeState(client, existing.id, 'active', {
      checksum: baseMetadata.checksum,
      contentHash: baseMetadata.contentHash,
      sizeBytes: baseMetadata.sizeBytes,
      metadata: metadata,
      lastModifiedAt: baseMetadata.lastModifiedAt
    });
  } else {
    node = await insertNode(client, {
      backendMountId: backend.id,
      parentId,
      path: normalizedPath,
      kind: 'directory',
      sizeBytes: baseMetadata.sizeBytes,
      checksum: baseMetadata.checksum,
      contentHash: baseMetadata.contentHash,
      metadata,
      lastModifiedAt: baseMetadata.lastModifiedAt,
      state: 'active'
    });
  }

  await recordSnapshot(client, node);

  const rollupPlan: RollupPlan = {
    ensure: [node.id],
    increments: [],
    invalidate: [],
    touchedNodeIds: [node.id],
    scheduleCandidates: []
  };

  const beforeContribution = computeContribution(existing && existing.state === 'active' ? existing : null);
  const afterContribution = computeContribution(node);
  const contributionDiff = diffContribution(beforeContribution, afterContribution);

  if (parent) {
    const ancestors = await collectAncestorChain(client, parent);
    ancestors.forEach((ancestor, index) => {
      const childCountDelta = index === 0 ? contributionDiff.childCountDelta : 0;
      if (
        contributionDiff.sizeBytesDelta !== 0 ||
        contributionDiff.fileCountDelta !== 0 ||
        contributionDiff.directoryCountDelta !== 0 ||
        childCountDelta !== 0
      ) {
        rollupPlan.increments.push({
          nodeId: ancestor.id,
          sizeBytesDelta: contributionDiff.sizeBytesDelta,
          fileCountDelta: contributionDiff.fileCountDelta,
          directoryCountDelta: contributionDiff.directoryCountDelta,
          childCountDelta,
          markPending: false
        });
        rollupPlan.touchedNodeIds.push(ancestor.id);
        if (index === 0) {
          rollupPlan.scheduleCandidates.push({
            nodeId: ancestor.id,
            backendMountId: backend.id,
            reason: 'mutation',
            depth: ancestor.depth,
            childCountDelta
          });
        }
      }
    });
  }

  return {
    primaryNode: node,
    affectedNodeIds: [node.id],
    backendMountId: backend.id,
    result: buildResultPayload(node, command.type),
    rollupPlan,
    idempotent: false
  };
}

async function applyUploadFile(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'uploadFile' },
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  const normalizedPath = normalizePath(command.path);

  const existing = await getNodeByPath(client, backend.id, normalizedPath, { forUpdate: true });
  if (existing && existing.state !== 'deleted') {
    throw new FilestoreError('Node already exists at target path', 'NODE_EXISTS', {
      backendMountId: backend.id,
      path: normalizedPath
    });
  }

  const parentPath = getParentPath(normalizedPath);
  let parent: NodeRecord | null = null;
  if (parentPath) {
    parent = await getNodeByPath(client, backend.id, parentPath, { forUpdate: true });
    if (!parent || parent.state === 'deleted') {
      throw new FilestoreError('Parent directory not found', 'PARENT_NOT_FOUND', {
        backendMountId: backend.id,
        path: parentPath
      });
    }
    if (parent.kind !== 'directory') {
      throw new FilestoreError('Parent is not a directory', 'NOT_A_DIRECTORY', {
        backendMountId: backend.id,
        path: parentPath
      });
    }
  }

  const executorResult = await executor.execute(command, { backend });
  const mergedMetadata = {
    ...(existing?.metadata ?? {}),
    ...(executorResult.metadata ?? {}),
    ...(command.metadata ?? {})
  };

  const checksum = command.checksum ?? executorResult.checksum ?? null;
  const contentHash = command.contentHash ?? executorResult.contentHash ?? null;
  const sizeBytes = executorResult.sizeBytes ?? command.sizeBytes ?? 0;
  const lastModifiedAt = executorResult.lastModifiedAt ?? new Date();

  let node: NodeRecord;
  if (existing && existing.state === 'deleted') {
    node = await updateNodeState(client, existing.id, 'active', {
      checksum,
      contentHash,
      sizeBytes,
      metadata: mergedMetadata,
      lastModifiedAt
    });
  } else {
    node = await insertNode(client, {
      backendMountId: backend.id,
      parentId: parent ? parent.id : null,
      path: normalizedPath,
      kind: 'file',
      sizeBytes,
      checksum,
      contentHash,
      metadata: mergedMetadata,
      lastModifiedAt,
      state: 'active'
    });
  }

  await recordSnapshot(client, node);

  const rollupPlan: RollupPlan = {
    ensure: [],
    increments: [],
    invalidate: [],
    touchedNodeIds: [node.id],
    scheduleCandidates: []
  };

  if (parent) {
    const beforeContribution = computeContribution(existing && existing.state === 'active' ? existing : null);
    const afterContribution = computeContribution(node);
    const contributionDiff = diffContribution(beforeContribution, afterContribution);

    const ancestors = await collectAncestorChain(client, parent);
    ancestors.forEach((ancestor, index) => {
      const childCountDelta = index === 0 ? contributionDiff.childCountDelta : 0;
      if (
        contributionDiff.sizeBytesDelta !== 0 ||
        contributionDiff.fileCountDelta !== 0 ||
        contributionDiff.directoryCountDelta !== 0 ||
        childCountDelta !== 0
      ) {
        rollupPlan.increments.push({
          nodeId: ancestor.id,
          sizeBytesDelta: contributionDiff.sizeBytesDelta,
          fileCountDelta: contributionDiff.fileCountDelta,
          directoryCountDelta: contributionDiff.directoryCountDelta,
          childCountDelta,
          markPending: false
        });
        rollupPlan.touchedNodeIds.push(ancestor.id);
        if (index === 0) {
          rollupPlan.scheduleCandidates.push({
            nodeId: ancestor.id,
            backendMountId: backend.id,
            reason: 'mutation',
            depth: ancestor.depth,
            childCountDelta
          });
        }
      }
    });
  }

  return {
    primaryNode: node,
    affectedNodeIds: [node.id],
    backendMountId: backend.id,
    result: {
      ...buildResultPayload(node, command.type),
      sizeBytes: node.sizeBytes,
      checksum: node.checksum,
      contentHash: node.contentHash,
      mimeType: command.mimeType ?? null,
      originalName: command.originalName ?? null
    },
    rollupPlan,
    idempotent: false
  };
}

async function applyWriteFile(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'writeFile' },
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  const normalizedPath = normalizePath(command.path);
  const existing = await getNodeById(client, command.nodeId, { forUpdate: true });
  if (!existing || existing.backendMountId !== backend.id) {
    throw new FilestoreError('Node not found on backend', 'NODE_NOT_FOUND', {
      nodeId: command.nodeId,
      backendMountId: backend.id
    });
  }

  if (existing.kind !== 'file') {
    throw new FilestoreError('Only file nodes can be written', 'NOT_A_DIRECTORY', {
      backendMountId: backend.id,
      nodeId: existing.id,
      kind: existing.kind
    });
  }

  if (existing.path !== normalizedPath) {
    throw new FilestoreError('Write path does not match tracked node path', 'INVALID_PATH', {
      expectedPath: existing.path,
      providedPath: normalizedPath
    });
  }

  const parent = existing.parentId ? await getNodeById(client, existing.parentId, { forUpdate: true }) : null;

  const executorResult = await executor.execute(command, { backend });

  const mergedMetadata = {
    ...(existing.metadata ?? {}),
    ...(executorResult.metadata ?? {}),
    ...(command.metadata ?? {})
  };

  const checksum = command.checksum ?? executorResult.checksum ?? existing.checksum;
  const contentHash = command.contentHash ?? executorResult.contentHash ?? existing.contentHash;
  const sizeBytes = executorResult.sizeBytes ?? command.sizeBytes ?? existing.sizeBytes;
  const lastModifiedAt = executorResult.lastModifiedAt ?? new Date();

  const updated = await updateNodeState(client, existing.id, 'active', {
    checksum,
    contentHash,
    sizeBytes,
    metadata: mergedMetadata,
    lastModifiedAt
  });

  await recordSnapshot(client, updated);

  const rollupPlan: RollupPlan = {
    ensure: [],
    increments: [],
    invalidate: [],
    touchedNodeIds: [updated.id],
    scheduleCandidates: []
  };

  if (parent) {
    const beforeContribution = computeContribution(existing);
    const afterContribution = computeContribution(updated);
    const contributionDiff = diffContribution(beforeContribution, afterContribution);

    if (
      contributionDiff.sizeBytesDelta !== 0 ||
      contributionDiff.fileCountDelta !== 0 ||
      contributionDiff.directoryCountDelta !== 0
    ) {
      const ancestors = await collectAncestorChain(client, parent);
      ancestors.forEach((ancestor, index) => {
        const childCountDelta = index === 0 ? contributionDiff.childCountDelta : 0;
        if (
          contributionDiff.sizeBytesDelta !== 0 ||
          contributionDiff.fileCountDelta !== 0 ||
          contributionDiff.directoryCountDelta !== 0 ||
          childCountDelta !== 0
        ) {
          rollupPlan.increments.push({
            nodeId: ancestor.id,
            sizeBytesDelta: contributionDiff.sizeBytesDelta,
            fileCountDelta: contributionDiff.fileCountDelta,
            directoryCountDelta: contributionDiff.directoryCountDelta,
            childCountDelta,
            markPending: false
          });
          rollupPlan.touchedNodeIds.push(ancestor.id);
          if (index === 0) {
            rollupPlan.scheduleCandidates.push({
              nodeId: ancestor.id,
              backendMountId: backend.id,
              reason: 'mutation',
              depth: ancestor.depth,
              childCountDelta
            });
          }
        }
      });
    }
  }

  return {
    primaryNode: updated,
    affectedNodeIds: [updated.id],
    backendMountId: backend.id,
    result: {
      ...buildResultPayload(updated, command.type),
      sizeBytes: updated.sizeBytes,
      checksum: updated.checksum,
      contentHash: updated.contentHash,
      mimeType: command.mimeType ?? null,
      originalName: command.originalName ?? null,
      previousVersion: existing.version,
      previousSizeBytes: existing.sizeBytes
    },
    rollupPlan,
    idempotent: false
  };
}

async function applyDeleteNode(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'deleteNode' },
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  const normalizedPath = normalizePath(command.path);
  const existing = await getNodeByPath(client, backend.id, normalizedPath, { forUpdate: true });
  if (!existing) {
    throw new FilestoreError('Node not found at path', 'NODE_NOT_FOUND', {
      backendMountId: backend.id,
      path: normalizedPath
    });
  }

  if (existing.kind === 'directory' && command.recursive !== true) {
    await ensureNoActiveChildren(client, existing.id);
  }

  const parentNode = existing.parentId ? await getNodeById(client, existing.parentId, { forUpdate: true }) : null;

  await executor.execute(command, { backend });

  if (existing.state === 'deleted') {
    return {
      primaryNode: existing,
      affectedNodeIds: [existing.id],
      backendMountId: backend.id,
      result: buildResultPayload(existing, command.type),
      rollupPlan: {
        ensure: [],
        increments: [],
        invalidate: [],
        touchedNodeIds: [],
        scheduleCandidates: []
      },
      idempotent: true
    };
  }

  const updated = await updateNodeState(client, existing.id, 'deleted', {
    sizeBytes: 0,
    checksum: null,
    contentHash: null,
    metadata: existing.metadata,
    lastModifiedAt: new Date()
  });

  await recordSnapshot(client, updated);

  const rollupPlan: RollupPlan = {
    ensure: [],
    increments: [],
    invalidate: [{ nodeId: updated.id, state: 'invalid' }],
    touchedNodeIds: [updated.id],
    scheduleCandidates: []
  };

  const beforeContribution = computeContribution(existing);
  const afterContribution = computeContribution(null);
  const contributionDiff = diffContribution(beforeContribution, afterContribution);

  if (parentNode) {
    const ancestors = await collectAncestorChain(client, parentNode);
    ancestors.forEach((ancestor, index) => {
      const childCountDelta = index === 0 ? contributionDiff.childCountDelta : 0;
      if (
        contributionDiff.sizeBytesDelta !== 0 ||
        contributionDiff.fileCountDelta !== 0 ||
        contributionDiff.directoryCountDelta !== 0 ||
        childCountDelta !== 0
      ) {
        rollupPlan.increments.push({
          nodeId: ancestor.id,
          sizeBytesDelta: contributionDiff.sizeBytesDelta,
          fileCountDelta: contributionDiff.fileCountDelta,
          directoryCountDelta: contributionDiff.directoryCountDelta,
          childCountDelta,
          markPending: false
        });
        rollupPlan.touchedNodeIds.push(ancestor.id);
        if (index === 0) {
          rollupPlan.scheduleCandidates.push({
            nodeId: ancestor.id,
            backendMountId: backend.id,
            reason: 'mutation',
            depth: ancestor.depth,
            childCountDelta
          });
        }
      }
    });
  }

  return {
    primaryNode: updated,
    affectedNodeIds: [updated.id],
    backendMountId: backend.id,
    result: buildResultPayload(updated, command.type),
    rollupPlan,
    idempotent: false
  };
}

function buildResultPayload(node: NodeRecord, commandType: string): CommandResultPayload {
  return {
    commandType,
    nodeId: node.id,
    backendMountId: node.backendMountId,
    path: node.path,
    kind: node.kind,
    state: node.state,
    sizeBytes: node.sizeBytes,
    version: node.version
  };
}

async function applyMoveNode(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'moveNode' },
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  const normalizedSource = normalizePath(command.path);
  const targetBackendId = command.targetBackendMountId ?? backend.id;

  if (targetBackendId !== backend.id) {
    throw new FilestoreError('Cross-backend moves are not supported yet', 'NOT_SUPPORTED', {
      backendMountId: backend.id,
      targetBackendMountId: targetBackendId
    });
  }

  const normalizedTarget = normalizePath(command.targetPath);
  if (normalizedSource === normalizedTarget) {
    const node = await getNodeByPath(client, backend.id, normalizedSource);
    if (!node) {
      throw new FilestoreError('Node not found at path', 'NODE_NOT_FOUND', {
        backendMountId: backend.id,
        path: normalizedSource
      });
    }
    return {
      primaryNode: node,
      affectedNodeIds: [node.id],
      backendMountId: backend.id,
      result: buildResultPayload(node, command.type),
      rollupPlan: {
        ensure: [],
        increments: [],
        invalidate: [],
        touchedNodeIds: [node.id],
        scheduleCandidates: []
      },
      idempotent: true
    };
  }

  const existing = await getNodeByPath(client, backend.id, normalizedSource, { forUpdate: true });
  if (!existing || existing.state === 'deleted') {
    throw new FilestoreError('Node not found at path', 'NODE_NOT_FOUND', {
      backendMountId: backend.id,
      path: normalizedSource
    });
  }

  const existingTarget = await getNodeByPath(client, backend.id, normalizedTarget, { forUpdate: true });
  if (existingTarget && existingTarget.state !== 'deleted') {
    throw new FilestoreError('Node already exists at target path', 'NODE_EXISTS', {
      backendMountId: backend.id,
      path: normalizedTarget
    });
  }

  const targetParentPath = getParentPath(normalizedTarget);
  let targetParent: NodeRecord | null = null;
  if (targetParentPath) {
    targetParent = await getNodeByPath(client, backend.id, targetParentPath, { forUpdate: true });
    if (!targetParent || targetParent.state === 'deleted') {
      throw new FilestoreError('Target parent directory not found', 'PARENT_NOT_FOUND', {
        backendMountId: backend.id,
        path: targetParentPath
      });
    }
    if (targetParent.kind !== 'directory') {
      throw new FilestoreError('Target parent is not a directory', 'NOT_A_DIRECTORY', {
        backendMountId: backend.id,
        path: targetParentPath
      });
    }
  }

  const sourceParent = existing.parentId ? await getNodeById(client, existing.parentId, { forUpdate: true }) : null;

  const executorCommand = {
    ...command,
    path: normalizedSource,
    targetPath: normalizedTarget,
    nodeKind: command.nodeKind ?? existing.kind
  } as FilestoreCommand;
  await executor.execute(executorCommand, { backend });

  const subtree = await listNodeSubtreeByPath(client, backend.id, normalizedSource);
  const deltaDepth = (targetParent ? targetParent.depth + 1 : 1) - existing.depth;

  const updatedNodes = new Map<number, NodeRecord>();

  for (const node of subtree) {
    const relativePath = node.path === normalizedSource ? '' : node.path.slice(normalizedSource.length + 1);
    const newPath = relativePath ? `${normalizedTarget}/${relativePath}` : normalizedTarget;
    const newDepth = node.depth + deltaDepth;
    const newParentId = node.id === existing.id ? (targetParent ? targetParent.id : null) : node.parentId;

    const updated = await updateNodeLocation(client, node.id, {
      path: newPath,
      depth: newDepth,
      parentId: newParentId,
      backendMountId: backend.id
    });
    updatedNodes.set(node.id, updated);
  }

  const updatedRoot = updatedNodes.get(existing.id)!;
  await recordSnapshot(client, updatedRoot);

  const rollupPlan: RollupPlan = {
    ensure: [],
    increments: [],
    invalidate: [],
    touchedNodeIds: [updatedRoot.id],
    scheduleCandidates: []
  };

  const contribution = computeContribution(updatedRoot);

  if (sourceParent) {
    const ancestors = await collectAncestorChain(client, sourceParent);
    const removalDiff = diffContribution(contribution, computeContribution(null));
    ancestors.forEach((ancestor, index) => {
      const childCountDelta = index === 0 ? removalDiff.childCountDelta : 0;
      if (
        removalDiff.sizeBytesDelta !== 0 ||
        removalDiff.fileCountDelta !== 0 ||
        removalDiff.directoryCountDelta !== 0 ||
        childCountDelta !== 0
      ) {
        rollupPlan.increments.push({
          nodeId: ancestor.id,
          sizeBytesDelta: removalDiff.sizeBytesDelta,
          fileCountDelta: removalDiff.fileCountDelta,
          directoryCountDelta: removalDiff.directoryCountDelta,
          childCountDelta,
          markPending: false
        });
        rollupPlan.touchedNodeIds.push(ancestor.id);
        if (index === 0) {
          rollupPlan.scheduleCandidates.push({
            nodeId: ancestor.id,
            backendMountId: backend.id,
            reason: 'mutation',
            depth: ancestor.depth,
            childCountDelta
          });
        }
      }
    });
  }

  if (targetParent) {
    const ancestors = await collectAncestorChain(client, targetParent);
    const additionDiff = diffContribution(computeContribution(null), contribution);
    ancestors.forEach((ancestor, index) => {
      const childCountDelta = index === 0 ? additionDiff.childCountDelta : 0;
      if (
        additionDiff.sizeBytesDelta !== 0 ||
        additionDiff.fileCountDelta !== 0 ||
        additionDiff.directoryCountDelta !== 0 ||
        childCountDelta !== 0
      ) {
        rollupPlan.increments.push({
          nodeId: ancestor.id,
          sizeBytesDelta: additionDiff.sizeBytesDelta,
          fileCountDelta: additionDiff.fileCountDelta,
          directoryCountDelta: additionDiff.directoryCountDelta,
          childCountDelta,
          markPending: false
        });
        rollupPlan.touchedNodeIds.push(ancestor.id);
        if (index === 0) {
          rollupPlan.scheduleCandidates.push({
            nodeId: ancestor.id,
            backendMountId: backend.id,
            reason: 'mutation',
            depth: ancestor.depth,
            childCountDelta
          });
        }
      }
    });
  }

  const affectedIds = Array.from(updatedNodes.keys());

  return {
    primaryNode: updatedRoot,
    affectedNodeIds: affectedIds,
    backendMountId: backend.id,
    result: {
      ...buildResultPayload(updatedRoot, command.type),
      movedFrom: normalizedSource
    },
    rollupPlan,
    idempotent: false
  };
}

async function applyUpdateNodeMetadata(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'updateNodeMetadata' }
): Promise<InternalCommandOutcome> {
  const existing = await getNodeById(client, command.nodeId, { forUpdate: true });
  if (!existing || existing.backendMountId !== backend.id) {
    throw new FilestoreError('Node not found on backend', 'NODE_NOT_FOUND', {
      nodeId: command.nodeId,
      backendMountId: backend.id
    });
  }

  const nextMetadata: Record<string, unknown> = { ...(existing.metadata ?? {}) };
  if (command.set) {
    for (const [key, value] of Object.entries(command.set)) {
      nextMetadata[key] = value;
    }
  }
  if (command.unset) {
    for (const key of command.unset) {
      delete nextMetadata[key];
    }
  }

  const updated = await updateNodeMetadata(client, existing.id, nextMetadata);
  await recordSnapshot(client, updated);

  const rollupPlan: RollupPlan = {
    ensure: [],
    increments: [],
    invalidate: [],
    touchedNodeIds: [updated.id],
    scheduleCandidates: []
  };

  return {
    primaryNode: updated,
    affectedNodeIds: [updated.id],
    backendMountId: backend.id,
    result: buildResultPayload(updated, command.type),
    rollupPlan,
    idempotent: false
  };
}

async function applyCopyNode(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand & { type: 'copyNode' },
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  const normalizedSource = normalizePath(command.path);
  const targetBackendId = command.targetBackendMountId ?? backend.id;

  if (targetBackendId !== backend.id) {
    throw new FilestoreError('Cross-backend copies are not supported yet', 'NOT_SUPPORTED', {
      backendMountId: backend.id,
      targetBackendMountId: targetBackendId
    });
  }

  const normalizedTarget = normalizePath(command.targetPath);
  if (normalizedSource === normalizedTarget) {
    throw new FilestoreError('Source and target paths must differ for copy', 'INVALID_PATH', {
      path: normalizedSource
    });
  }

  const existing = await getNodeByPath(client, backend.id, normalizedSource, { forUpdate: true });
  if (!existing || existing.state === 'deleted') {
    throw new FilestoreError('Node not found at path', 'NODE_NOT_FOUND', {
      backendMountId: backend.id,
      path: normalizedSource
    });
  }

  const existingTarget = await getNodeByPath(client, backend.id, normalizedTarget, { forUpdate: true });
  if (existingTarget && existingTarget.state !== 'deleted' && !command.overwrite) {
    const rollupPlan = createEmptyRollupPlan();
    return {
      primaryNode: existingTarget,
      affectedNodeIds: [],
      backendMountId: backend.id,
      result: {
        ...buildResultPayload(existingTarget, command.type),
        copiedFrom: normalizedSource,
        idempotent: true
      },
      rollupPlan,
      idempotent: true
    } satisfies InternalCommandOutcome;
  }

  const targetParentPath = getParentPath(normalizedTarget);
  let targetParent: NodeRecord | null = null;
  if (targetParentPath) {
    targetParent = await getNodeByPath(client, backend.id, targetParentPath, { forUpdate: true });
    if (!targetParent || targetParent.state === 'deleted') {
      throw new FilestoreError('Target parent directory not found', 'PARENT_NOT_FOUND', {
        backendMountId: backend.id,
        path: targetParentPath
      });
    }
    if (targetParent.kind !== 'directory') {
      throw new FilestoreError('Target parent is not a directory', 'NOT_A_DIRECTORY', {
        backendMountId: backend.id,
        path: targetParentPath
      });
    }
  }

  const executorCommand = {
    ...command,
    path: normalizedSource,
    targetPath: normalizedTarget,
    nodeKind: command.nodeKind ?? existing.kind
  } as FilestoreCommand;
  await executor.execute(executorCommand, { backend });

  const subtree = await listNodeSubtreeByPath(client, backend.id, normalizedSource);
  const newNodeMap = new Map<number, NodeRecord>();
  const createdNodes: NodeRecord[] = [];
  const createdNodeIds: number[] = [];

  for (const node of subtree) {
    const relativePath = node.path === normalizedSource ? '' : node.path.slice(normalizedSource.length + 1);
    const newPath = relativePath ? `${normalizedTarget}/${relativePath}` : normalizedTarget;

    const parentId =
      node.id === existing.id
        ? targetParent?.id ?? null
        : newNodeMap.get(node.parentId ?? -1)?.id ?? null;

    if (node.id !== existing.id && parentId === null) {
      throw new FilestoreError('Failed to resolve copied parent', 'NODE_NOT_FOUND', {
        parentId: node.parentId
      });
    }

    const metadataClone = node.metadata ? JSON.parse(JSON.stringify(node.metadata)) : {};
    const { node: inserted, created } = await insertNodeIfAbsent(client, {
      backendMountId: backend.id,
      parentId,
      path: newPath,
      kind: node.kind,
      sizeBytes: node.sizeBytes,
      checksum: node.checksum,
      contentHash: node.contentHash,
      metadata: metadataClone,
      lastModifiedAt: node.lastModifiedAt ?? new Date(),
      state: node.state,
      isSymlink: node.isSymlink
    });

    if (created) {
      await recordSnapshot(client, inserted);
      createdNodes.push(inserted);
      createdNodeIds.push(inserted.id);
    }
    newNodeMap.set(node.id, inserted);
  }

  const copiedRoot = newNodeMap.get(existing.id)!;

  if (createdNodes.length === 0) {
    const rollupPlan = createEmptyRollupPlan();
    return {
      primaryNode: copiedRoot,
      affectedNodeIds: [],
      backendMountId: backend.id,
      result: {
        ...buildResultPayload(copiedRoot, command.type),
        copiedFrom: normalizedSource,
        idempotent: true
      },
      rollupPlan,
      idempotent: true
    } satisfies InternalCommandOutcome;
  }

  const rollupPlan: RollupPlan = {
    ensure: Array.from(new Set(createdNodeIds)),
    increments: [],
    invalidate: [],
    touchedNodeIds: Array.from(new Set(createdNodeIds)),
    scheduleCandidates: []
  };

  const totals = createdNodes.reduce(
    (acc, node) => {
      const contribution = computeContribution(node);
      acc.sizeBytes += contribution.sizeBytes;
      acc.fileCount += contribution.fileCount;
      acc.directoryCount += contribution.directoryCount;
      return acc;
    },
    { sizeBytes: 0, fileCount: 0, directoryCount: 0 }
  );

  if (targetParent) {
    const ancestors = await collectAncestorChain(client, targetParent);
    const rootCreated = createdNodeIds.includes(copiedRoot.id);
    ancestors.forEach((ancestor, index) => {
      if (totals.sizeBytes === 0 && totals.fileCount === 0 && totals.directoryCount === 0) {
        return;
      }
      rollupPlan.increments.push({
        nodeId: ancestor.id,
        sizeBytesDelta: totals.sizeBytes,
        fileCountDelta: totals.fileCount,
        directoryCountDelta: totals.directoryCount,
        childCountDelta: index === 0 && rootCreated && copiedRoot.state === 'active' ? 1 : 0,
        markPending: false
      });
      rollupPlan.touchedNodeIds.push(ancestor.id);
      if (index === 0) {
        rollupPlan.scheduleCandidates.push({
          nodeId: ancestor.id,
          backendMountId: backend.id,
          reason: 'mutation',
          depth: ancestor.depth,
          childCountDelta: index === 0 && copiedRoot.state === 'active' ? 1 : 0
        });
      }
    });
  }

  rollupPlan.scheduleCandidates.push({
    nodeId: copiedRoot.id,
    backendMountId: backend.id,
    reason: 'mutation',
    depth: copiedRoot.depth,
    childCountDelta: 0
  });
  rollupPlan.touchedNodeIds.push(copiedRoot.id);

  rollupPlan.ensure = Array.from(new Set(rollupPlan.ensure));
  rollupPlan.touchedNodeIds = Array.from(new Set(rollupPlan.touchedNodeIds));

  const affectedIds = Array.from(new Set(createdNodeIds));

  return {
    primaryNode: copiedRoot,
    affectedNodeIds: affectedIds,
    backendMountId: backend.id,
    result: {
      ...buildResultPayload(copiedRoot, command.type),
      copiedFrom: normalizedSource
    },
    rollupPlan,
    idempotent: false
  };
}

async function executeCommand(
  client: PoolClient,
  backend: BackendMountRecord,
  command: FilestoreCommand,
  executor: CommandExecutor
): Promise<InternalCommandOutcome> {
  switch (command.type) {
    case 'createDirectory':
      return applyCreateDirectory(client, backend, command, executor);
    case 'deleteNode':
      return applyDeleteNode(client, backend, command, executor);
    case 'moveNode':
      return applyMoveNode(client, backend, command, executor);
    case 'updateNodeMetadata':
      return applyUpdateNodeMetadata(client, backend, command);
    case 'copyNode':
      return applyCopyNode(client, backend, command, executor);
    case 'uploadFile':
      return applyUploadFile(client, backend, command, executor);
    case 'writeFile':
      return applyWriteFile(client, backend, command, executor);
    default:
      return assertUnreachable(command);
  }
}

async function findIdempotentResult(
  client: PoolClient,
  commandType: string,
  idempotencyKey: string
): Promise<{ journalEntryId: number; result: CommandResultPayload; node?: NodeRecord | null } | null> {
  const result = await client.query<{
    id: number;
    status: string;
    result: CommandResultPayload | null;
  }>(
    `SELECT id, status, result
       FROM journal_entries
      WHERE command = $1
        AND idempotency_key = $2
      ORDER BY created_at DESC
      LIMIT 1`,
    [commandType, idempotencyKey]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];
  if (row.status !== 'succeeded') {
    throw new FilestoreError('Command with this idempotency key is not available', 'IDEMPOTENCY_CONFLICT', {
      status: row.status
    });
  }

  const payload = row.result ?? {};
  let node: NodeRecord | null = null;
  const rawNodeId = payload.nodeId as unknown;
  const nodeId =
    rawNodeId === undefined || rawNodeId === null
      ? null
      : toInteger(rawNodeId, 'nodeId');
  if (nodeId !== null) {
    node = await getNodeById(client, nodeId);
  }

  return {
    journalEntryId: toInteger(row.id, 'journalEntryId'),
    result: payload,
    node
  };
}

export async function runCommand(options: RunCommandOptions): Promise<RunCommandResult> {
  const parsed = filestoreCommandSchema.parse(options.command);

  if (options.idempotencyKey) {
    const existing = await withConnection((client) =>
      findIdempotentResult(client, parsed.type, options.idempotencyKey as string)
    );
    if (existing) {
      const idemOutcome: RunCommandResult = {
        journalEntryId: existing.journalEntryId,
        command: parsed,
        node: existing.node ?? null,
        result: existing.result,
        idempotent: true
      };
      return idemOutcome;
    }
  }

  let emitted: InternalCommandOutcome | null = null;
  let runtimeExecutor: CommandExecutor | undefined;
  let appliedRollupPlan: AppliedRollupPlan = { updated: new Map() };
  let rollupPlan: RollupPlan = createEmptyRollupPlan();

  const outcome: RunCommandResult = await withTransaction(async (client) => {
    const backend = await getBackendMountById(client, parsed.backendMountId);
    if (!backend) {
      throw new FilestoreError('Backend mount not found', 'BACKEND_NOT_FOUND', {
        backendMountId: parsed.backendMountId
      });
    }

    runtimeExecutor = resolveExecutor(backend.backendKind, options.executors);
    if (!runtimeExecutor) {
      throw new FilestoreError('No executor registered for backend kind', 'EXECUTOR_NOT_FOUND', {
        backendKind: backend.backendKind
      });
    }

    const journalInsert = await client.query<{
      id: number;
    }>(
      `INSERT INTO journal_entries (
         command,
         status,
         executor_kind,
         principal,
         request_id,
         idempotency_key,
         parameters,
         started_at
       ) VALUES ($1, 'running', $2, $3, $4, $5, $6::jsonb, NOW())
       RETURNING id`,
      [
        parsed.type,
        runtimeExecutor.kind,
        options.principal ?? null,
        options.requestId ?? null,
        options.idempotencyKey ?? null,
        JSON.stringify(parsed)
      ]
    );

    const journalEntryId = toInteger(journalInsert.rows[0].id, 'journalEntryId');
    const startTime = process.hrtime.bigint();

    const execution = await executeCommand(client, backend, parsed, runtimeExecutor);
    emitted = execution;
    rollupPlan = execution.rollupPlan;
    appliedRollupPlan = await applyRollupPlanWithinTransaction(client, rollupPlan);

    const durationNs = Number(process.hrtime.bigint() - startTime);
    const durationMs = Math.round(durationNs / 1_000_000);

    const resultWithDuration: CommandResultPayload = {
      ...execution.result,
      durationMs
    };
    if (execution.idempotent && resultWithDuration.idempotent !== true) {
      resultWithDuration.idempotent = true;
    }
    execution.result = resultWithDuration;

    await client.query(
      `UPDATE journal_entries
          SET status = 'succeeded',
              result = $1::jsonb,
              affected_node_ids = $2,
              completed_at = NOW(),
              duration_ms = $3
        WHERE id = $4`,
      [
        JSON.stringify(resultWithDuration),
        execution.affectedNodeIds,
        durationMs,
        journalEntryId
      ]
    );

    const runResult: RunCommandResult = {
      journalEntryId,
      node: execution.primaryNode,
      result: resultWithDuration,
      idempotent: execution.idempotent,
      command: parsed
    };
    return runResult;
  });

  if (emitted !== null) {
    await finalizeRollupPlan(rollupPlan, appliedRollupPlan);
    const eventDetails: InternalCommandOutcome = emitted;
    const eventPath =
      outcome.node?.path ??
      (outcome.result.path as string | undefined) ??
      (parsed as any).path ??
      '';
    emitCommandCompleted({
      command: parsed.type,
      journalId: outcome.journalEntryId,
      backendMountId: eventDetails.backendMountId,
      nodeId: outcome.node?.id ?? null,
      path: eventPath,
      idempotencyKey: options.idempotencyKey,
      principal: options.principal ?? null,
      node: outcome.node ?? null,
      result: outcome.result
    });
    scheduleJournalPrune();
  }

  return outcome;
}
