import type { PoolClient } from 'pg';
import { withTransaction, withConnection } from '../db/client';
import { getBackendMountById } from '../db/backendMounts';
import {
  getNodeByPath,
  insertNode,
  ensureNoActiveChildren,
  updateNodeState,
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
};

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
  if (parentPath) {
    const parent = await getNodeByPath(client, backend.id, parentPath, { forUpdate: true });
    if (!parent) {
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
    parentId = parent.id;
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

  return {
    primaryNode: node,
    affectedNodeIds: [node.id],
    backendMountId: backend.id,
    result: buildResultPayload(node, command.type)
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

  await executor.execute(command, { backend });

  if (existing.state === 'deleted') {
    return {
      primaryNode: existing,
      affectedNodeIds: [existing.id],
      backendMountId: backend.id,
      result: buildResultPayload(existing, command.type)
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

  return {
    primaryNode: updated,
    affectedNodeIds: [updated.id],
    backendMountId: backend.id,
    result: buildResultPayload(updated, command.type)
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
  const nodeId = typeof payload.nodeId === 'number' ? payload.nodeId : null;
  if (nodeId) {
    node = await getNodeById(client, nodeId);
  }

  return {
    journalEntryId: row.id,
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

    const journalEntryId = journalInsert.rows[0].id;
    const startTime = process.hrtime.bigint();

    emitted = await executeCommand(client, backend, parsed, runtimeExecutor);

    const durationNs = Number(process.hrtime.bigint() - startTime);
    const durationMs = Math.round(durationNs / 1_000_000);

    await client.query(
      `UPDATE journal_entries
          SET status = 'succeeded',
              result = $1::jsonb,
              affected_node_ids = $2,
              completed_at = NOW(),
              duration_ms = $3
        WHERE id = $4`,
      [
        JSON.stringify(emitted.result),
        emitted.affectedNodeIds,
        durationMs,
        journalEntryId
      ]
    );

    const runResult: RunCommandResult = {
      journalEntryId,
      node: emitted.primaryNode,
      result: emitted.result,
      idempotent: false,
      command: parsed
    };
    return runResult;
  });

  if (emitted !== null) {
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
      result: outcome.result
    });
  }

  return outcome;
}
