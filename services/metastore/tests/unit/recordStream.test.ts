import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emitRecordStreamEvent,
  formatRecordStreamEventFrame,
  formatRecordStreamComment,
  getRecordStreamSubscriberCount,
  subscribeToRecordStream
} from '../../src/events/recordStream';

test('formatRecordStreamEventFrame renders SSE payload with id and event name', () => {
  const event = emitRecordStreamEvent({
    action: 'created',
    namespace: 'analytics',
    key: 'pipeline-42',
    version: 3,
    occurredAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    deletedAt: null,
    actor: 'tester'
  });

  const frame = formatRecordStreamEventFrame(event);
  assert.ok(frame.includes('event: metastore.record.created'));
  assert.ok(frame.includes(`id: ${event.id}`));
  assert.ok(frame.includes('"namespace":"analytics"'));
  assert.ok(frame.endsWith('\n\n'));

  const comment = formatRecordStreamComment('ping');
  assert.equal(comment, ':ping\n\n');
});

test('subscribeToRecordStream tracks subscriber totals', () => {
  const before = getRecordStreamSubscriberCount();
  const unsubscribe = subscribeToRecordStream(() => undefined);
  const during = getRecordStreamSubscriberCount();
  assert.equal(during, before + 1);
  unsubscribe();
  assert.equal(getRecordStreamSubscriberCount(), before);
});
