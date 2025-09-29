import './testEnv';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { queryRequestSchema } from '../src/query/types';

test('queryRequestSchema normalizes legacy partition key arrays', () => {
  const parsed = queryRequestSchema.parse({
    timeRange: {
      start: '2024-03-01T00:00:00.000Z',
      end: '2024-03-01T02:00:00.000Z'
    },
    filters: {
      partitionKey: {
        region: ['east', 'west']
      }
    }
  });

  const regionFilter = parsed.filters?.partitionKey?.region;
  assert.ok(regionFilter);
  assert.equal(regionFilter.type, 'string');
  assert.deepEqual(regionFilter.in, ['east', 'west']);
});

test('queryRequestSchema preserves numeric and timestamp predicates', () => {
  const parsed = queryRequestSchema.parse({
    timeRange: {
      start: '2024-03-01T00:00:00.000Z',
      end: '2024-03-01T02:00:00.000Z'
    },
    filters: {
      partitionKey: {
        shard: { type: 'number', gte: 2, lt: 10 },
        captured_at: {
          type: 'timestamp',
          gt: '2024-03-01T00:30:00.000Z'
        }
      }
    }
  });

  const shardFilter = parsed.filters?.partitionKey?.shard;
  assert.ok(shardFilter && shardFilter.type === 'number');
  assert.equal(shardFilter.gte, 2);
  assert.equal(shardFilter.lt, 10);

  const capturedFilter = parsed.filters?.partitionKey?.captured_at;
  assert.ok(capturedFilter && capturedFilter.type === 'timestamp');
  assert.equal(capturedFilter.gt, '2024-03-01T00:30:00.000Z');
});

test('queryRequestSchema rejects string filters without predicates', () => {
  assert.throws(
    () =>
      queryRequestSchema.parse({
        timeRange: {
          start: '2024-03-01T00:00:00.000Z',
          end: '2024-03-01T02:00:00.000Z'
        },
        filters: {
          partitionKey: {
            region: { type: 'string' }
          }
        }
      }),
    /string partition filters require eq or in predicates/
  );
});

test('queryRequestSchema rejects invalid timestamp literals', () => {
  assert.throws(
    () =>
      queryRequestSchema.parse({
        timeRange: {
          start: '2024-03-01T00:00:00.000Z',
          end: '2024-03-01T02:00:00.000Z'
        },
        filters: {
          partitionKey: {
            captured_at: {
              type: 'timestamp',
              eq: 'not-a-timestamp'
            }
          }
        }
      }),
    /partition timestamp filters must use ISO-8601 strings/
  );
});

test('queryRequestSchema rejects numeric filters without predicates', () => {
  assert.throws(
    () =>
      queryRequestSchema.parse({
        timeRange: {
          start: '2024-03-01T00:00:00.000Z',
          end: '2024-03-01T02:00:00.000Z'
        },
        filters: {
          partitionKey: {
            shard: { type: 'number' }
          }
        }
      }),
    /number partition filters require at least one predicate/
  );
});
