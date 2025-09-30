import type { FastifyBaseLogger } from 'fastify';
import type { PoolClient } from 'pg';
import {
  createRecord as createRecordRepo,
  fetchRecord as fetchRecordRepo,
  hardDeleteRecord as hardDeleteRecordRepo,
  patchRecord as patchRecordRepo,
  restoreRecordFromAudit as restoreRecordFromAuditRepo,
  searchRecords as searchRecordsRepo,
  softDeleteRecord as softDeleteRecordRepo,
  upsertRecord as upsertRecordRepo
} from '../db/recordsRepository';
import { withConnection, withTransaction } from '../db/client';
import type {
  BulkOperationPayload,
  BulkRequestPayload,
  CreateRecordPayload,
  DeleteRecordPayload,
  PatchRecordPayload,
  PurgeRecordPayload,
  RestoreRecordPayload,
  UpdateRecordPayload
} from '../schemas/records';
import { serializeRecord, type SerializedRecord } from '../routes/serializers';
import { HttpError } from '../errors/httpError';
import type { FilterNode, SortField } from '../search/types';
import { emitRecordStreamEvent, type RecordStreamAction } from '../events/recordStream';
import { publishMetastoreRecordEvent } from '../events/publisher';
import {
  getRecordAuditById,
  getRecordAuditByVersion,
  type RecordAuditView
} from '../db/auditRepository';
import type { MetastoreRecord } from '../db/types';

export type OperationContext = {
  actor: string | null;
  logger: FastifyBaseLogger;
};

export type SearchParams = {
  namespace: string;
  includeDeleted?: boolean;
  filter?: FilterNode;
  limit?: number;
  offset?: number;
  sort?: SortField[];
  projection?: string[];
};

export type BulkOperationResult =
  | ({ status: 'ok' } & (BulkUpsertResult | BulkDeleteResult))
  | {
      status: 'error';
      namespace: string;
      key: string;
      error: {
        statusCode: number;
        code: string;
        message: string;
      };
    };

type BulkUpsertResult = {
  type: 'upsert';
  namespace: string;
  key: string;
  created: boolean;
  record: SerializedRecord;
  idempotent: boolean;
  mutated: boolean;
};

type BulkDeleteResult = {
  type: 'delete';
  namespace: string;
  key: string;
  record: SerializedRecord;
  idempotent: boolean;
  mutated: boolean;
};

type PendingMutation = {
  action: RecordStreamAction;
  record: SerializedRecord;
  mode?: 'soft' | 'hard';
  payload: Record<string, unknown>;
  logMessage?: string;
};

type RestoreResult = {
  restored: boolean;
  idempotent: boolean;
  record: SerializedRecord;
  restoredFrom: { auditId: number; version: number | null };
};

type DeleteResult = {
  deleted: boolean;
  idempotent: boolean;
  record: SerializedRecord;
};

type PurgeResult = {
  purged: boolean;
  idempotent: boolean;
  record: SerializedRecord;
};

type UpsertResult = {
  created: boolean;
  idempotent: boolean;
  record: SerializedRecord;
};

type CreateResult = {
  created: boolean;
  idempotent: boolean;
  record: SerializedRecord;
};

type SearchResult = Awaited<ReturnType<typeof searchRecordsRepo>>;

type FetchOptions = {
  includeDeleted?: boolean;
};

type RecordServiceDependencies = {
  db?: {
    withTransaction?: typeof withTransaction;
    withConnection?: typeof withConnection;
    createRecord?: typeof createRecordRepo;
    upsertRecord?: typeof upsertRecordRepo;
    patchRecord?: typeof patchRecordRepo;
    softDeleteRecord?: typeof softDeleteRecordRepo;
    hardDeleteRecord?: typeof hardDeleteRecordRepo;
    fetchRecord?: typeof fetchRecordRepo;
    searchRecords?: typeof searchRecordsRepo;
    restoreRecordFromAudit?: typeof restoreRecordFromAuditRepo;
    getRecordAuditById?: typeof getRecordAuditById;
    getRecordAuditByVersion?: typeof getRecordAuditByVersion;
  };
  events?: {
    emitRecordStreamEvent?: typeof emitRecordStreamEvent;
    publishMetastoreRecordEvent?: typeof publishMetastoreRecordEvent;
  };
  clock?: {
    now: () => Date;
  };
};

type ExecuteOperationDependencies = {
  client: PoolClient;
  context: OperationContext;
  pendingMutations: PendingMutation[];
};

type MutationOptions = {
  mode?: 'soft' | 'hard';
  logMessage?: string;
  extra?: Record<string, unknown>;
};

type MutationPayload = PendingMutation['payload'];

type BulkOperation = BulkOperationPayload;
type BulkDeleteOperation = Extract<BulkOperation, { type: 'delete' }>;
type BulkWriteOperation = Exclude<BulkOperation, { type: 'delete' }>;

function isDeleteOperation(operation: BulkOperation): operation is BulkDeleteOperation {
  return operation.type === 'delete';
}

export function createRecordService(deps: RecordServiceDependencies = {}) {
  const {
    withTransaction: runWithTransaction = withTransaction,
    withConnection: runWithConnection = withConnection,
    createRecord: createRecordDb = createRecordRepo,
    upsertRecord: upsertRecordDb = upsertRecordRepo,
    patchRecord: patchRecordDb = patchRecordRepo,
    softDeleteRecord: softDeleteRecordDb = softDeleteRecordRepo,
    hardDeleteRecord: hardDeleteRecordDb = hardDeleteRecordRepo,
    fetchRecord: fetchRecordDb = fetchRecordRepo,
    searchRecords: searchRecordsDb = searchRecordsRepo,
    restoreRecordFromAudit: restoreRecordFromAuditDb = restoreRecordFromAuditRepo,
    getRecordAuditById: getRecordAuditByIdDb = getRecordAuditById,
    getRecordAuditByVersion: getRecordAuditByVersionDb = getRecordAuditByVersion
  } = deps.db ?? {};

  const {
    emitRecordStreamEvent: emitStreamEvent = emitRecordStreamEvent,
    publishMetastoreRecordEvent: publishRecordEvent = publishMetastoreRecordEvent
  } = deps.events ?? {};

  const now = deps.clock?.now ?? (() => new Date());

  function toSerializedRecord(record: MetastoreRecord): SerializedRecord {
    return serializeRecord(record) as SerializedRecord;
  }

  function buildDefaultLogMessage(action: RecordStreamAction, mode?: 'soft' | 'hard'): string {
    if (action === 'deleted' && mode === 'hard') {
      return 'Failed to publish metastore record.purged event';
    }
    return `Failed to publish metastore record.${action} event`;
  }

  function buildEventPayload(
    action: RecordStreamAction,
    record: SerializedRecord,
    context: OperationContext,
    options?: MutationOptions
  ): PendingMutation {
    const payload: MutationPayload = {
      namespace: record.namespace,
      key: record.key,
      actor: context.actor,
      record
    };

    if (options?.mode) {
      payload.mode = options.mode;
    }

    if (options?.extra) {
      Object.assign(payload, options.extra);
    }

    return {
      action,
      record,
      mode: options?.mode,
      payload,
      logMessage: options?.logMessage ?? buildDefaultLogMessage(action, options?.mode)
    } satisfies PendingMutation;
  }

  async function emitMutation(
    mutation: PendingMutation,
    context: OperationContext
  ): Promise<void> {
    emitStreamEvent({
      action: mutation.action,
      namespace: mutation.record.namespace,
      key: mutation.record.key,
      version: typeof mutation.record.version === 'number' ? mutation.record.version : null,
      occurredAt: now().toISOString(),
      updatedAt: typeof mutation.record.updatedAt === 'string' ? mutation.record.updatedAt : null,
      deletedAt: mutation.record.deletedAt ?? null,
      actor: context.actor,
      mode: mutation.mode
    });

    try {
      await publishRecordEvent(mutation.action, mutation.payload);
    } catch (err) {
      context.logger.error(
        { err, namespace: mutation.record.namespace, key: mutation.record.key },
        mutation.logMessage ?? buildDefaultLogMessage(mutation.action, mutation.mode)
      );
    }
  }

  async function createRecord(
    payload: CreateRecordPayload,
    context: OperationContext
  ): Promise<CreateResult> {
    const result = await runWithTransaction((client) =>
      createRecordDb(client, {
        namespace: payload.namespace,
        key: payload.key,
        metadata: payload.metadata,
        tags: payload.tags,
        owner: payload.owner,
        schemaHash: payload.schemaHash,
        actor: context.actor,
        idempotencyKey: payload.idempotencyKey
      })
    );

    if (!result.created && result.record.deletedAt) {
      throw new HttpError(
        409,
        'record_deleted',
        'Record exists in soft-deleted state. Use PUT to restore or supply `includeDeleted`.'
      );
    }

    const serialized = toSerializedRecord(result.record);
    const response: CreateResult = {
      created: result.created,
      idempotent: result.created ? false : result.idempotent,
      record: serialized
    };

    if (result.created) {
      const mutation = buildEventPayload('created', serialized, context);
      await emitMutation(mutation, context);
    }

    return response;
  }

  async function upsertRecord(
    namespace: string,
    key: string,
    payload: UpdateRecordPayload,
    context: OperationContext
  ): Promise<UpsertResult> {
    const result = await runWithTransaction((client) =>
      upsertRecordDb(client, {
        namespace,
        key,
        metadata: payload.metadata,
        tags: payload.tags,
        owner: payload.owner,
        schemaHash: payload.schemaHash,
        expectedVersion: payload.expectedVersion,
        actor: context.actor,
        idempotencyKey: payload.idempotencyKey
      })
    );

    if (!result.record) {
      throw new HttpError(500, 'upsert_failed', 'Failed to upsert record');
    }

    const serialized = toSerializedRecord(result.record);
    if (result.mutated) {
      const mutation = buildEventPayload(result.created ? 'created' : 'updated', serialized, context);
      await emitMutation(mutation, context);
    }

    return {
      created: result.created,
      idempotent: result.idempotent,
      record: serialized
    } satisfies UpsertResult;
  }

  async function patchRecord(
    namespace: string,
    key: string,
    payload: PatchRecordPayload,
    context: OperationContext
  ): Promise<{ record: SerializedRecord; idempotent: boolean }> {
    const result = await runWithTransaction((client) =>
      patchRecordDb(client, {
        namespace,
        key,
        metadataPatch: payload.metadata,
        metadataUnset: payload.metadataUnset,
        tags: payload.tags,
        owner: payload.owner,
        schemaHash: payload.schemaHash,
        expectedVersion: payload.expectedVersion,
        actor: context.actor,
        idempotencyKey: payload.idempotencyKey
      })
    );

    if (!result) {
      throw new HttpError(404, 'not_found', 'Record not found');
    }

    const serialized = toSerializedRecord(result.record);
    if (result.mutated) {
      const mutation = buildEventPayload('updated', serialized, context);
      await emitMutation(mutation, context);
    }

    return { record: serialized, idempotent: !result.mutated };
  }

  async function fetchRecord(
    namespace: string,
    key: string,
    options?: FetchOptions
  ) {
    return runWithConnection((client) => fetchRecordDb(client, namespace, key, options));
  }

  async function softDeleteRecord(
    namespace: string,
    key: string,
    payload: DeleteRecordPayload,
    context: OperationContext
  ): Promise<DeleteResult> {
    const record = await runWithTransaction((client) =>
      softDeleteRecordDb(client, {
        namespace,
        key,
        expectedVersion: payload.expectedVersion,
        actor: context.actor,
        idempotencyKey: payload.idempotencyKey
      })
    );

    if (!record) {
      throw new HttpError(404, 'not_found', 'Record not found');
    }

    const serialized = toSerializedRecord(record.record);
    if (record.mutated) {
      const mutation = buildEventPayload('deleted', serialized, context, {
        mode: 'soft',
        logMessage: 'Failed to publish metastore record.deleted event'
      });
      await emitMutation(mutation, context);
    }

    return { deleted: record.mutated, idempotent: !record.mutated, record: serialized } satisfies DeleteResult;
  }

  async function hardDeleteRecord(
    namespace: string,
    key: string,
    payload: PurgeRecordPayload,
    context: OperationContext
  ): Promise<PurgeResult> {
    const record = await runWithTransaction((client) =>
      hardDeleteRecordDb(client, {
        namespace,
        key,
        expectedVersion: payload.expectedVersion,
        idempotencyKey: payload.idempotencyKey
      })
    );

    if (!record) {
      throw new HttpError(404, 'not_found', 'Record not found');
    }

    const serialized = toSerializedRecord(record.record);
    if (record.mutated) {
      const mutation = buildEventPayload('deleted', serialized, context, {
        mode: 'hard',
        logMessage: 'Failed to publish metastore record.purged event'
      });
      await emitMutation(mutation, context);
    }

    return { purged: record.mutated, idempotent: !record.mutated, record: serialized } satisfies PurgeResult;
  }

  async function restoreRecord(
    namespace: string,
    key: string,
    payload: RestoreRecordPayload,
    context: OperationContext
  ): Promise<RestoreResult> {
    const auditEntry = await resolveAuditEntry(namespace, key, payload);

    if (!auditEntry) {
      throw new HttpError(404, 'not_found', 'Audit entry not found');
    }

    const restored = await runWithTransaction((client) =>
      restoreRecordFromAuditDb(client, {
        namespace,
        key,
        expectedVersion: payload.expectedVersion,
        actor: context.actor,
        snapshot: {
          metadata: auditEntry.metadata,
          tags: auditEntry.tags,
          owner: auditEntry.owner,
          schemaHash: auditEntry.schemaHash
        }
      })
    );

    if (!restored) {
      throw new HttpError(404, 'not_found', 'Record not found');
    }

    const serialized = toSerializedRecord(restored.record);
    if (restored.mutated) {
      const mutation = buildEventPayload('updated', serialized, context, {
        logMessage: 'Failed to publish metastore record.restore event',
        extra: {
          restoredFrom: {
            auditId: auditEntry.id,
            version: auditEntry.version
          }
        }
      });
      await emitMutation(mutation, context);
    }

    return {
      restored: restored.mutated,
      idempotent: !restored.mutated,
      record: serialized,
      restoredFrom: {
        auditId: auditEntry.id,
        version: auditEntry.version
      }
    } satisfies RestoreResult;
  }

  async function resolveAuditEntry(
    namespace: string,
    key: string,
    payload: RestoreRecordPayload
  ): Promise<RecordAuditView | null> {
    if (payload.auditId !== undefined) {
      return runWithConnection((client) =>
        getRecordAuditByIdDb(client, { namespace, key, id: payload.auditId! })
      );
    }

    if (payload.version !== undefined) {
      return runWithConnection((client) =>
        getRecordAuditByVersionDb(client, { namespace, key, version: payload.version! })
      );
    }

    return null;
  }

  async function searchRecords(params: SearchParams): Promise<SearchResult> {
    return runWithConnection((client) =>
      searchRecordsDb(client, {
        namespace: params.namespace,
        includeDeleted: params.includeDeleted,
        filter: params.filter,
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
        projection: params.projection
      })
    );
  }

  async function bulkOperations(
    payload: BulkRequestPayload,
    context: OperationContext
  ): Promise<BulkOperationResult[]> {
    const normalizedOperations = payload.operations.map((op) => ({
      ...op,
      type: op.type ?? 'upsert'
    })) as BulkOperation[];

    if (payload.continueOnError) {
      const responses: BulkOperationResult[] = [];
      for (const operation of normalizedOperations) {
        const pendingMutations: PendingMutation[] = [];
        try {
          const result = await runWithTransaction((client) =>
            executeBulkOperation({ client, context, pendingMutations }, operation)
          );
          responses.push({ status: 'ok', ...result });
          await emitMutations(pendingMutations, context);
        } catch (err) {
          const httpError = mapBulkError(err);
          responses.push({
            status: 'error',
            namespace: operation.namespace,
            key: operation.key,
            error: {
              statusCode: httpError.statusCode,
              code: httpError.code,
              message: httpError.message
            }
          });
        }
      }
      return responses;
    }

    const pendingMutations: PendingMutation[] = [];
    const results = await runWithTransaction(async (client) => {
      const aggregated: Array<BulkDeleteResult | BulkUpsertResult> = [];
      for (const operation of normalizedOperations) {
        const result = await executeBulkOperation({ client, context, pendingMutations }, operation);
        aggregated.push(result);
      }
      return aggregated;
    });

    await emitMutations(pendingMutations, context);

    return results.map((entry) => ({ status: 'ok', ...entry }));
  }

  async function emitMutations(
    pendingMutations: PendingMutation[],
    context: OperationContext
  ): Promise<void> {
    for (const mutation of pendingMutations) {
      await emitMutation(mutation, context);
    }
  }

  async function executeBulkOperation(
    deps: ExecuteOperationDependencies,
    operation: BulkOperation
  ): Promise<BulkDeleteResult | BulkUpsertResult> {
    if (isDeleteOperation(operation)) {
      return performBulkDelete(deps, operation);
    }
    return performBulkUpsert(deps, operation);
  }

  async function performBulkDelete(
    { client, context, pendingMutations }: ExecuteOperationDependencies,
    operation: BulkDeleteOperation
  ): Promise<BulkDeleteResult> {
    const result = await softDeleteRecordDb(client, {
      namespace: operation.namespace,
      key: operation.key,
      expectedVersion: operation.expectedVersion,
      actor: context.actor,
      idempotencyKey: operation.idempotencyKey
    });

    if (!result) {
      throw new HttpError(404, 'not_found', `Record ${operation.namespace}/${operation.key} not found`);
    }

    const serialized = toSerializedRecord(result.record);
    if (result.mutated) {
      pendingMutations.push(
        buildEventPayload('deleted', serialized, context, {
          mode: 'soft',
          logMessage: 'Failed to publish metastore record.deleted event'
        })
      );
    }

    return {
      type: 'delete',
      namespace: operation.namespace,
      key: operation.key,
      record: serialized,
      idempotent: !result.mutated,
      mutated: result.mutated
    } satisfies BulkDeleteResult;
  }

  async function performBulkUpsert(
    { client, context, pendingMutations }: ExecuteOperationDependencies,
    operation: BulkWriteOperation
  ): Promise<BulkUpsertResult> {
    const result = await upsertRecordDb(client, {
      namespace: operation.namespace,
      key: operation.key,
      metadata: operation.metadata,
      tags: operation.tags,
      owner: operation.owner,
      schemaHash: operation.schemaHash,
      expectedVersion: operation.expectedVersion,
      actor: context.actor,
      idempotencyKey: operation.idempotencyKey
    });

    if (!result.record) {
      throw new HttpError(
        500,
        'upsert_failed',
        `Failed to upsert record ${operation.namespace}/${operation.key}`
      );
    }

    const serialized = toSerializedRecord(result.record);
    if (result.mutated) {
      pendingMutations.push(
        buildEventPayload(result.created ? 'created' : 'updated', serialized, context)
      );
    }

    return {
      type: 'upsert',
      namespace: operation.namespace,
      key: operation.key,
      created: result.created,
      record: serialized,
      idempotent: result.idempotent,
      mutated: result.mutated
    } satisfies BulkUpsertResult;
  }

  function mapBulkError(err: unknown): HttpError {
    if (err instanceof HttpError) {
      return err;
    }
    return new HttpError(
      500,
      'internal_error',
      err instanceof Error ? err.message : 'Unknown error during bulk operation'
    );
  }

  return {
    createRecord,
    upsertRecord,
    patchRecord,
    fetchRecord,
    softDeleteRecord,
    hardDeleteRecord,
    restoreRecord,
    searchRecords,
    bulkOperations
  };
}

export type RecordService = ReturnType<typeof createRecordService>;
