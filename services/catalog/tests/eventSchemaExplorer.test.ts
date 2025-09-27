import assert from 'node:assert/strict';
import { buildWorkflowEventSchema } from '../src/eventSchemaExplorer';
import type { WorkflowEventRecord } from '../src/db/types';

function buildEvent(overrides: Partial<WorkflowEventRecord> = {}): WorkflowEventRecord {
  const base: WorkflowEventRecord = {
    id: 'evt-base',
    type: 'demo.event.created',
    source: 'demo.service',
    occurredAt: '2024-01-01T00:00:00.000Z',
    receivedAt: '2024-01-01T00:00:01.000Z',
    payload: {},
    correlationId: null,
    ttlMs: null,
    metadata: null
  } satisfies WorkflowEventRecord;
  return { ...base, ...overrides } satisfies WorkflowEventRecord;
}

async function run(): Promise<void> {
  const events: WorkflowEventRecord[] = [
    buildEvent({
      id: 'evt-1',
      payload: {
        user: {
          id: 'user-1',
          roles: ['admin', 'viewer']
        },
        flags: {
          beta: true
        }
      },
      metadata: {
        tenant: 'alpha'
      }
    }),
    buildEvent({
      id: 'evt-2',
      payload: {
        user: {
          id: 'user-2',
          roles: ['editor']
        },
        location: {
          country: 'US'
        }
      },
      metadata: {
        tenant: 'beta'
      }
    })
  ];

  const schema = buildWorkflowEventSchema(events);

  assert.equal(schema.totalSamples, 2);

  const userIdField = schema.fields.find((field) => field.jsonPath === '$.payload.user.id');
  assert.ok(userIdField, 'expected payload.user.id field');
  assert.deepEqual(userIdField.types, ['string']);
  assert.equal(userIdField.liquidPath, 'event.payload.user.id');
  assert.equal(userIdField.occurrences, 2);
  assert.ok(userIdField.examples.includes('user-1'));

  const rolesField = schema.fields.find((field) => field.jsonPath === '$.payload.user.roles[*]');
  assert.ok(rolesField, 'expected payload.user.roles[*] field');
  assert.equal(rolesField.liquidPath, 'event.payload.user.roles[0]');
  assert.equal(rolesField.occurrences, 2, 'array occurrence counted once per event');
  assert.ok(rolesField.examples.some((example) => example === 'admin' || example === 'editor'));

  const tenantField = schema.fields.find((field) => field.jsonPath === '$.metadata.tenant');
  assert.ok(tenantField, 'expected metadata.tenant field');
  assert.equal(tenantField.liquidPath, 'event.metadata.tenant');
  assert.deepEqual(tenantField.types, ['string']);
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
