import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import type { EventEnvelope } from '@apphub/event-bus';
import type { RecordStreamEvent } from '../../src/events/recordStream';
import type { MetastoreRecord } from '../../src/db/types';
import type { RecordAuditView } from '../../src/db/auditRepository';
import { createRecordService } from '../../src/services/recordService';
import { HttpError } from '../../src/errors/httpError';

function makeRecord(overrides: Partial<MetastoreRecord> = {}): MetastoreRecord {
  const now = new Date('2023-01-01T00:00:00.000Z');
  return {
    id: 1,
    namespace: 'analytics',
    key: 'pipeline-1',
    metadata: {},
    tags: [],
    owner: null,
    schemaHash: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    createdBy: null,
    updatedBy: null,
    ...overrides
  } satisfies MetastoreRecord;
}

function makeAuditEntry(overrides: Partial<RecordAuditView> = {}): RecordAuditView {
  return {
    id: 42,
    namespace: 'analytics',
    key: 'pipeline-1',
    version: 3,
    action: 'update',
    actor: 'user-1',
    metadata: { status: 'active' },
    previousMetadata: null,
    tags: ['prod'],
    previousTags: null,
    owner: 'team@apphub.dev',
    previousOwner: null,
    schemaHash: 'sha256:abc',
    previousSchemaHash: null,
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
    updatedAt: new Date('2023-01-01T00:00:00.000Z'),
    ...overrides
  } satisfies RecordAuditView;
}

type SetupImplementations = Partial<
  Record<
    | 'createRecord'
    | 'upsertRecord'
    | 'patchRecord'
    | 'softDeleteRecord'
    | 'hardDeleteRecord'
    | 'fetchRecord'
    | 'searchRecords'
    | 'restoreRecordFromAudit'
    | 'getRecordAuditById'
    | 'getRecordAuditByVersion',
    (...args: unknown[]) => Promise<unknown>
  >
>;

type SetupOptions = {
  record?: MetastoreRecord;
  audit?: RecordAuditView | null;
  implementations?: SetupImplementations;
};


function setupService(options?: SetupOptions) {
  const record = options?.record ?? makeRecord();
  const auditEntry = options?.audit ?? makeAuditEntry();
  const impls = options?.implementations ?? {};

  const events: RecordStreamEvent[] = [];
  const published: Array<{ action: string; payload: Record<string, unknown> }> = [];

  const withTransaction = mock.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({}));
  const withConnection = mock.fn(async (fn: (client: unknown) => Promise<unknown>) => fn({}));

  const createRecord = mock.fn(
    impls.createRecord ?? (async () => ({ record, created: true, idempotent: false }))
  );
  const upsertRecord = mock.fn(
    impls.upsertRecord
      ?? (async () => ({ record, created: true, mutated: true, idempotent: false }))
  );
  const patchRecord = mock.fn(
    impls.patchRecord ?? (async () => ({ record, mutated: true }))
  );
  const softDeleteRecord = mock.fn(
    impls.softDeleteRecord
      ?? (async () => ({
        record: { ...record, deletedAt: new Date('2023-01-02T00:00:00.000Z') },
        mutated: true
      }))
  );
  const hardDeleteRecord = mock.fn(
    impls.hardDeleteRecord ?? (async () => ({ record, mutated: true }))
  );
  const fetchRecord = mock.fn(impls.fetchRecord ?? (async () => record));
  const searchRecords = mock.fn(
    impls.searchRecords ?? (async () => ({ records: [record], total: 1 }))
  );
  const restoreRecordFromAudit = mock.fn(
    impls.restoreRecordFromAudit ?? (async () => ({ record, mutated: true }))
  );
  const getRecordAuditById = mock.fn(impls.getRecordAuditById ?? (async () => auditEntry));
  const getRecordAuditByVersion = mock.fn(impls.getRecordAuditByVersion ?? (async () => auditEntry));

  const emitRecordStreamEvent = mock.fn((event: Omit<RecordStreamEvent, 'id'>) => {
    const delivered = { ...event, id: String(events.length + 1) } satisfies RecordStreamEvent;
    events.push(delivered);
    return delivered;
  });

  const publishMetastoreRecordEvent = mock.fn(
    async (action: string, payload: Record<string, unknown>): Promise<EventEnvelope> => {
      published.push({ action, payload });
      return {
        id: `evt-${published.length}`,
        type: `metastore.record.${action}`,
        source: 'test',
        occurredAt: new Date().toISOString(),
        payload: {}
      } satisfies EventEnvelope;
    }
  );

  const logger = {
    error: mock.fn(),
    warn: mock.fn(),
    info: mock.fn(),
    debug: mock.fn(),
    trace: mock.fn(),
    fatal: mock.fn(),
    child() {
      return this;
    }
  } as unknown as import('fastify').FastifyBaseLogger;

  const service = createRecordService({
    db: {
      withTransaction,
      withConnection,
      createRecord,
      upsertRecord,
      patchRecord,
      softDeleteRecord,
      hardDeleteRecord,
      fetchRecord,
      searchRecords,
      restoreRecordFromAudit,
      getRecordAuditById,
      getRecordAuditByVersion
    },
    events: {
      emitRecordStreamEvent,
      publishMetastoreRecordEvent
    },
    clock: {
      now: () => new Date('2023-01-01T00:00:00.000Z')
    }
  });

  return {
    service,
    events,
    published,
    logger,
    searchRecords
  } as const;
}

test('searchRecords forwards full-text search term', async () => {
  const ctx = setupService();
  await ctx.service.searchRecords({ namespace: 'analytics', search: 'galaxy' });
  const call = ctx.searchRecords.mock.calls.at(-1);
  const options = call?.arguments?.[1] as { search?: string } | undefined;
  assert.equal(options?.search, 'galaxy');
});

test('createRecord emits created events when record is newly inserted', async () => {
  const ctx = setupService();
  const payload = {
    namespace: 'analytics',
    key: 'pipeline-1',
    metadata: { status: 'active' },
    tags: ['prod'],
    owner: 'team@apphub.dev',
    schemaHash: 'sha256:abc'
  };

  const result = await ctx.service.createRecord(payload, {
    actor: 'user-1',
    logger: ctx.logger
  });

  assert.equal(result.created, true);
  assert.equal(result.idempotent, false);
  assert.equal(ctx.events.length, 1);
  assert.equal(ctx.events[0]?.action, 'created');
  assert.equal(ctx.events[0]?.namespace, 'analytics');
  assert.equal(ctx.published.length, 1);
  assert.equal(ctx.published[0]?.action, 'created');
  assert.equal(ctx.published[0]?.payload.actor, 'user-1');
});

test('createRecord skips event emission when record already exists without deletion', async () => {
  const record = makeRecord();
  const ctx = setupService({
    record,
    implementations: {
      createRecord: async () => ({ record, created: false, idempotent: true })
    }
  });

  const payload = {
    namespace: 'analytics',
    key: 'pipeline-1',
    metadata: {},
    tags: [],
    owner: null,
    schemaHash: null
  };

  const result = await ctx.service.createRecord(payload, {
    actor: null,
    logger: ctx.logger
  });

  assert.equal(result.created, false);
  assert.equal(result.idempotent, true);
  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('createRecord fails when existing record is soft deleted', async () => {
  const deletedRecord = makeRecord({ deletedAt: new Date('2023-01-03T00:00:00.000Z') });
  const ctx = setupService({
    record: deletedRecord,
    implementations: {
      createRecord: async () => ({ record: deletedRecord, created: false, idempotent: false })
    }
  });

  await assert.rejects(
    () =>
      ctx.service.createRecord(
        {
          namespace: 'analytics',
          key: 'pipeline-1',
          metadata: {},
          tags: [],
          owner: null,
          schemaHash: null
        },
        { actor: 'user-2', logger: ctx.logger }
      ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, 'record_deleted');
      return true;
    }
  );
  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('upsertRecord emits updated event when record already exists', async () => {
  const record = makeRecord({ version: 2 });
  const ctx = setupService({
    record,
    implementations: {
      upsertRecord: async () => ({ record, created: false, mutated: true, idempotent: false })
    }
  });

  const result = await ctx.service.upsertRecord(
    'analytics',
    'pipeline-1',
    {
      metadata: { status: 'paused' },
      tags: ['prod'],
      owner: 'team@apphub.dev',
      schemaHash: 'sha256:def'
    },
    { actor: 'user-3', logger: ctx.logger }
  );

  assert.equal(result.created, false);
  assert.equal(result.idempotent, false);
  assert.equal(ctx.events.length, 1);
  assert.equal(ctx.events[0]?.action, 'updated');
  assert.equal(ctx.published[0]?.action, 'updated');
});

test('upsertRecord reports idempotent when repository skips mutation', async () => {
  const record = makeRecord({ version: 2 });
  const ctx = setupService({
    record,
    implementations: {
      upsertRecord: async () => ({ record, created: false, mutated: false, idempotent: true })
    }
  });

  const result = await ctx.service.upsertRecord(
    'analytics',
    'pipeline-1',
    {
      metadata: { status: 'paused' },
      tags: ['prod'],
      owner: 'team@apphub.dev',
      schemaHash: 'sha256:def'
    },
    { actor: 'user-7', logger: ctx.logger }
  );

  assert.equal(result.created, false);
  assert.equal(result.idempotent, true);
  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('patchRecord throws not_found when repository returns null', async () => {
  const ctx = setupService({
    implementations: {
      patchRecord: async () => null
    }
  });

  await assert.rejects(
    () =>
      ctx.service.patchRecord(
        'analytics',
        'pipeline-1',
        { metadata: { status: 'active' } },
        { actor: 'user-1', logger: ctx.logger }
      ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, 'not_found');
      return true;
    }
  );

  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('patchRecord marks idempotent when repository reports no mutation', async () => {
  const record = makeRecord({ metadata: { status: 'active' } });
  const ctx = setupService({
    record,
    implementations: {
      patchRecord: async () => ({ record, mutated: false })
    }
  });

  const result = await ctx.service.patchRecord(
    'analytics',
    'pipeline-1',
    { metadata: { status: 'active' } },
    { actor: 'user-8', logger: ctx.logger }
  );

  assert.equal(result.idempotent, true);
  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('softDeleteRecord emits deleted mutation with soft mode', async () => {
  const ctx = setupService();

  const result = await ctx.service.softDeleteRecord(
    'analytics',
    'pipeline-1',
    {},
    { actor: 'user-4', logger: ctx.logger }
  );

  assert.equal(result.deleted, true);
  assert.equal(result.idempotent, false);
  assert.equal(ctx.events.length, 1);
  assert.equal(ctx.events[0]?.mode, 'soft');
  assert.equal(ctx.published[0]?.payload.mode, 'soft');
});

test('softDeleteRecord reports idempotent when repository skips deletion', async () => {
  const deletedRecord = makeRecord({ deletedAt: new Date('2023-03-03T00:00:00.000Z') });
  const ctx = setupService({
    record: deletedRecord,
    implementations: {
      softDeleteRecord: async () => ({ record: deletedRecord, mutated: false })
    }
  });

  const result = await ctx.service.softDeleteRecord(
    'analytics',
    'pipeline-1',
    {},
    { actor: 'user-9', logger: ctx.logger }
  );

  assert.equal(result.deleted, false);
  assert.equal(result.idempotent, true);
  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('restoreRecord publishes restoredFrom metadata in event payload', async () => {
  const audit = makeAuditEntry({ id: 77, version: 5 });
  const ctx = setupService({ audit });

  const result = await ctx.service.restoreRecord(
    'analytics',
    'pipeline-1',
    { auditId: 77 },
    { actor: 'user-5', logger: ctx.logger }
  );

  assert.equal(result.restored, true);
  assert.equal(result.idempotent, false);
  assert.deepEqual(result.restoredFrom, { auditId: 77, version: 5 });
  assert.equal(ctx.published.length, 1);
  assert.deepEqual(ctx.published[0]?.payload.restoredFrom, { auditId: 77, version: 5 });
});

test('restoreRecord returns idempotent when repository does not change the record', async () => {
  const audit = makeAuditEntry({ id: 77, version: 5 });
  const record = makeRecord({ metadata: { status: 'active' } });
  const ctx = setupService({
    audit,
    record,
    implementations: {
      restoreRecordFromAudit: async () => ({ record, mutated: false })
    }
  });

  const result = await ctx.service.restoreRecord(
    'analytics',
    'pipeline-1',
    { auditId: 77 },
    { actor: 'user-10', logger: ctx.logger }
  );

  assert.equal(result.restored, false);
  assert.equal(result.idempotent, true);
  assert.equal(ctx.events.length, 0);
  assert.equal(ctx.published.length, 0);
});

test('bulkOperations returns per-operation statuses and emits events', async () => {
  const ctx = setupService({
    implementations: {
      upsertRecord: async (_client, input) => ({
        record: makeRecord({
          key: (input as { key: string }).key,
          metadata: (input as { metadata: Record<string, unknown> }).metadata
        }),
        created: (input as { key: string }).key === 'new-record',
        mutated: true,
        idempotent: false
      }),
      softDeleteRecord: async () => ({
        record: makeRecord({
          key: 'pipeline-1',
          deletedAt: new Date('2023-02-01T00:00:00.000Z')
        }),
        mutated: true
      })
    }
  });

  const results = await ctx.service.bulkOperations(
    {
      operations: [
        {
          namespace: 'analytics',
          key: 'new-record',
          metadata: { status: 'active' }
        },
        {
          type: 'delete',
          namespace: 'analytics',
          key: 'pipeline-1'
        }
      ]
    },
    { actor: 'user-6', logger: ctx.logger }
  );

  assert.equal(results.length, 2);
  const createResult = results.find((entry) => entry.status === 'ok' && entry.type === 'upsert');
  assert.ok(createResult);
  assert.equal((createResult as { created: boolean }).created, true);
  const deleteResult = results.find((entry) => entry.status === 'ok' && entry.type === 'delete');
  assert.ok(deleteResult);
  assert.equal(ctx.events.length, 2);
  assert.equal(ctx.published.length, 2);
});

test('bulkOperations continueOnError isolates failures', async () => {
  const ctx = setupService({
    implementations: {
      upsertRecord: async () => ({ record: null, created: false, mutated: false, idempotent: false })
    }
  });

  const results = await ctx.service.bulkOperations(
    {
      continueOnError: true,
      operations: [
        {
          namespace: 'analytics',
          key: 'pipeline-1',
          metadata: {}
        }
      ]
    },
    { actor: null, logger: ctx.logger }
  );

  assert.equal(results.length, 1);
  const errorResult = results[0];
  assert.equal(errorResult.status, 'error');
  assert.equal(errorResult.error?.code, 'upsert_failed');
  assert.equal(ctx.events.length, 0);
});
