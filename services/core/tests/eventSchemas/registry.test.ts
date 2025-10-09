import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

function stableStringify(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function computeSchemaHash(schema: unknown): string {
  return createHash('sha256').update(stableStringify(schema)).digest('hex');
}

test('registerEventSchemaDefinition inserts a new version when none exists', async (t) => {
  const rawRegistryModule = await import('../../src/eventSchemas');
  const registryModule = (rawRegistryModule.default ?? rawRegistryModule) as Record<string, any>;
  const registerEventSchemaDefinition = registryModule.registerEventSchemaDefinition as (
    input: any
  ) => Promise<any>;
  const setOverrides = registryModule.__setEventSchemaRegistryTestOverrides as (
    overrides?: Record<string, any>
  ) => void;
  const annotateEventEnvelopeSchema = registryModule.annotateEventEnvelopeSchema as (
    input: any
  ) => Promise<any>;

  const getEventSchemaMock = t.mock.fn(async () => null);
  const getNextVersionMock = t.mock.fn(async () => 1);
  const insertMock = t.mock.fn(async (payload: any) => ({
    eventType: payload.eventType,
    version: payload.version,
    status: payload.status,
    schema: payload.schema,
    schemaHash: payload.schemaHash,
    metadata: payload.metadata ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: payload.createdBy ?? null,
    updatedBy: payload.updatedBy ?? null
  }));
  const updateStatusMock = t.mock.fn(async () => null);

  setOverrides({
    getEventSchema: getEventSchemaMock,
    getNextEventSchemaVersion: getNextVersionMock,
    insertEventSchema: insertMock,
    updateEventSchemaStatus: updateStatusMock
  });

  const schemaDefinition = {
    type: 'object',
    properties: {
      foo: { type: 'string' }
    },
    required: ['foo']
  };

  const record = await registerEventSchemaDefinition({
    eventType: 'core.example.created',
    schema: schemaDefinition,
    status: 'active',
    author: 'tester@apphub'
  });

  assert.equal(record.eventType, 'core.example.created');
  assert.equal(record.version, 1);
  assert.equal(record.status, 'active');
  assert.equal(insertMock.mock.calls.length, 1);
  assert.equal(getEventSchemaMock.mock.calls.length, 1);
  assert.equal(getNextVersionMock.mock.calls.length, 1);
  assert.equal(updateStatusMock.mock.calls.length, 0);

  setOverrides();
});

test('registerEventSchemaDefinition returns existing version when schema matches', async (t) => {
  const rawRegistryModule = await import('../../src/eventSchemas');
  const registryModule = (rawRegistryModule.default ?? rawRegistryModule) as Record<string, any>;
  const registerEventSchemaDefinition = registryModule.registerEventSchemaDefinition as (
    input: any
  ) => Promise<any>;
  const setOverrides = registryModule.__setEventSchemaRegistryTestOverrides as (
    overrides?: Record<string, any>
  ) => void;
  const schemaDefinition = {
    type: 'object',
    properties: {
      foo: { type: 'string' }
    },
    required: ['foo']
  };
  const schemaHash = computeSchemaHash(schemaDefinition);

  const existingRecord = {
    eventType: 'core.example.created',
    version: 2,
    status: 'active' as const,
    schema: schemaDefinition,
    schemaHash,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null
  };

  const getEventSchemaMock = t.mock.fn(async () => existingRecord);
  const getNextVersionMock = t.mock.fn(async () => 3);
  const insertMock = t.mock.fn(async () => existingRecord);
  const updateStatusMock = t.mock.fn(async () => null);

  setOverrides({
    getEventSchema: getEventSchemaMock,
    getNextEventSchemaVersion: getNextVersionMock,
    insertEventSchema: insertMock,
    updateEventSchemaStatus: updateStatusMock
  });

  const result = await registerEventSchemaDefinition({
    eventType: 'core.example.created',
    schema: schemaDefinition,
    version: 2
  });

  assert.equal(result.version, 2);
  assert.equal(result.schemaHash, schemaHash);
  assert.equal(insertMock.mock.calls.length, 0);
  assert.equal(getEventSchemaMock.mock.calls.length, 1);
  assert.equal(getNextVersionMock.mock.calls.length, 0);
  assert.equal(updateStatusMock.mock.calls.length, 0);

  setOverrides();
});

test('registerEventSchemaDefinition updates status when schema is unchanged', async (t) => {
  const rawRegistryModule = await import('../../src/eventSchemas');
  const registryModule = (rawRegistryModule.default ?? rawRegistryModule) as Record<string, any>;
  const registerEventSchemaDefinition = registryModule.registerEventSchemaDefinition as (
    input: any
  ) => Promise<any>;
  const setOverrides = registryModule.__setEventSchemaRegistryTestOverrides as (
    overrides?: Record<string, any>
  ) => void;
  const schemaDefinition = {
    type: 'object',
    properties: {
      foo: { type: 'string' }
    },
    required: ['foo']
  };
  const schemaHash = computeSchemaHash(schemaDefinition);

  const existingRecord = {
    eventType: 'core.example.created',
    version: 3,
    status: 'draft' as const,
    schema: schemaDefinition,
    schemaHash,
    metadata: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: null,
    updatedBy: null
  };

  const getEventSchemaMock = t.mock.fn(async () => existingRecord);
  const updateStatusMock = t.mock.fn(async () => ({
    ...existingRecord,
    status: 'active' as const,
    updatedBy: 'tester@apphub'
  }));
  const insertMock = t.mock.fn(async () => existingRecord);
  const getNextVersionMock = t.mock.fn(async () => 4);

  setOverrides({
    getEventSchema: getEventSchemaMock,
    updateEventSchemaStatus: updateStatusMock,
    insertEventSchema: insertMock,
    getNextEventSchemaVersion: getNextVersionMock
  });

  const result = await registerEventSchemaDefinition({
    eventType: 'core.example.created',
    schema: schemaDefinition,
    version: 3,
    status: 'active',
    author: 'tester@apphub'
  });

  assert.equal(result.status, 'active');
  assert.equal(updateStatusMock.mock.calls.length, 1);
  assert.equal(insertMock.mock.calls.length, 0);
  assert.equal(getNextVersionMock.mock.calls.length, 0);
  assert.equal(getEventSchemaMock.mock.calls.length, 1);

  setOverrides();
});

test('annotateEventEnvelopeSchema applies schema metadata and validates payload', async (t) => {
  const rawRegistryModule = await import('../../src/eventSchemas');
  const registryModule = (rawRegistryModule.default ?? rawRegistryModule) as Record<string, any>;
  const setOverrides = registryModule.__setEventSchemaRegistryTestOverrides as (
    overrides?: Record<string, any>
  ) => void;
  const annotateEventEnvelopeSchema = registryModule.annotateEventEnvelopeSchema as (
    input: any
  ) => Promise<any>;

  const schemaDefinition = {
    type: 'object',
    properties: { foo: { type: 'string' } },
    required: ['foo']
  };
  const schemaHash = computeSchemaHash(schemaDefinition);

  setOverrides({
    getEventSchema: async () => ({
      eventType: 'core.example.created',
      version: 5,
      status: 'active',
      schema: schemaDefinition,
      schemaHash,
      metadata: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: null,
      updatedBy: null
    })
  });

  const result = await annotateEventEnvelopeSchema({
    eventType: 'core.example.created',
    payload: { foo: 'bar' },
    schemaVersion: 5,
    metadata: { existing: 'value' }
  });

  assert.equal(result.schemaVersion, 5);
  assert.equal(result.schemaHash, schemaHash);
  assert.ok(result.metadata && typeof result.metadata === 'object');
  assert.deepEqual((result.metadata as Record<string, unknown>).__apphubSchema, {
    version: 5,
    hash: schemaHash
  });

  await assert.rejects(
    annotateEventEnvelopeSchema({
      eventType: 'core.example.created',
      payload: { foo: 42 },
      schemaVersion: 5
    }),
    /failed schema validation/i
  );

  setOverrides();
});
