import './setupTestEnv';
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeAssetPartitioning,
  normalizeAssetDeclarations,
  normalizeWorkflowDependsOn
} from '../src/workflows/http/normalizers';

import { normalizeAnalyticsQuery } from '../src/workflows/http/analyticsQuery';

test('normalizeAssetPartitioning trims and validates static keys', () => {
  const partitioning = normalizeAssetPartitioning({
    type: 'static',
    keys: ['  date ', 'region', ''],
  } as any);
  assert.deepEqual(partitioning, { type: 'static', keys: ['date', 'region'] });

  const empty = normalizeAssetPartitioning({ type: 'static', keys: ['   '] });
  assert.equal(empty, undefined);
});

test('normalizeAssetDeclarations deduplicates assets and keeps metadata', () => {
  const declarations = normalizeAssetDeclarations([
    {
      assetId: 'Dataset.A',
      schema: { fields: [] },
      freshness: { maxLagMinutes: 30 },
      autoMaterialize: { policy: 'eager' },
      partitioning: { type: 'static', keys: ['date'] },
    },
    {
      assetId: 'dataset.a',
      schema: { fields: [1] },
    },
  ] as any);

  assert.ok(declarations);
  assert.equal(declarations?.length, 1);
  assert.equal(declarations?.[0].assetId, 'Dataset.A');
  assert.deepEqual(declarations?.[0].partitioning, { type: 'static', keys: ['date'] });
});

test('normalizeWorkflowDependsOn removes blanks and deduplicates', () => {
  const depends = normalizeWorkflowDependsOn(['step-a', 'Step-A', '  ', 'step-b']);
  assert.deepEqual(depends, ['step-a', 'Step-A', 'step-b']);

  const empty = normalizeWorkflowDependsOn([]);
  assert.equal(empty, undefined);
});

test('normalizeAnalyticsQuery validates ranges and bucket selections', () => {
  const result = normalizeAnalyticsQuery({ range: '7d', bucket: 'hour' });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.bucketKey, 'hour');
    assert.ok(result.value.options.bucketInterval);
  }

  const invalid = normalizeAnalyticsQuery({ from: 'not-a-date' });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) {
    assert.equal(invalid.error, 'invalid_from');
  }
});
