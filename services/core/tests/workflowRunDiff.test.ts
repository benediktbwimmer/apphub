import './setupTestEnv';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diffJson,
  diffStatusTransitions,
  diffProducedAssets,
  computeStaleAssetWarnings
} from '../src/workflows/runDiff';
import type {
  WorkflowExecutionHistoryRecord,
  WorkflowRunStepAssetRecord,
  WorkflowAssetStalePartitionRecord
} from '../src/db/types';

test('diffJson identifies nested additions, removals, and changes', () => {
  const before = {
    foo: 1,
    nested: {
      keep: true,
      removed: 'old'
    },
    items: [1, 2]
  } as const;

  const after = {
    foo: 2,
    nested: {
      keep: true,
      added: 'new'
    },
    items: [1, 2, 3]
  } as const;

  const diff = diffJson(before, after);
  const byPath = new Map(diff.map((entry) => [entry.path, entry]));

  const fooDiff = byPath.get('foo');
  assert.ok(fooDiff);
  assert.equal(fooDiff.change, 'changed');
  assert.equal(fooDiff.before, 1);
  assert.equal(fooDiff.after, 2);

  const removedDiff = byPath.get('nested.removed');
  assert.ok(removedDiff);
  assert.equal(removedDiff.change, 'removed');

  const addedDiff = byPath.get('nested.added');
  assert.ok(addedDiff);
  assert.equal(addedDiff.change, 'added');
  assert.equal(addedDiff.after, 'new');

  const arrayDiff = byPath.get('items[2]');
  assert.ok(arrayDiff);
  assert.equal(arrayDiff.change, 'added');
  assert.equal(arrayDiff.after, 3);
});

test('diffStatusTransitions aligns history entries by index', () => {
  const base: WorkflowExecutionHistoryRecord[] = [
    {
      id: 'h1',
      workflowRunId: 'runA',
      workflowRunStepId: null,
      stepId: null,
      eventType: 'run.start',
      eventPayload: { status: 'running' },
      createdAt: '2024-01-01T00:00:00.000Z'
    },
    {
      id: 'h2',
      workflowRunId: 'runA',
      workflowRunStepId: null,
      stepId: null,
      eventType: 'run.update',
      eventPayload: { currentStepId: 'extract' },
      createdAt: '2024-01-01T00:05:00.000Z'
    }
  ];

  const compare: WorkflowExecutionHistoryRecord[] = [
    {
      id: 'h1b',
      workflowRunId: 'runB',
      workflowRunStepId: null,
      stepId: null,
      eventType: 'run.start',
      eventPayload: { status: 'running' },
      createdAt: '2024-01-02T00:00:00.000Z'
    },
    {
      id: 'h2b',
      workflowRunId: 'runB',
      workflowRunStepId: null,
      stepId: null,
      eventType: 'run.update',
      eventPayload: { currentStepId: 'transform' },
      createdAt: '2024-01-02T00:05:00.000Z'
    },
    {
      id: 'h3b',
      workflowRunId: 'runB',
      workflowRunStepId: null,
      stepId: null,
      eventType: 'run.complete',
      eventPayload: { status: 'succeeded' },
      createdAt: '2024-01-02T00:15:00.000Z'
    }
  ];

  const diff = diffStatusTransitions(base, compare);
  assert.equal(diff.length, 3);
  assert.equal(diff[0]?.change, 'identical');
  assert.equal(diff[1]?.change, 'changed');
  assert.equal(diff[1]?.base?.eventPayload?.currentStepId, 'extract');
  assert.equal(diff[1]?.compare?.eventPayload?.currentStepId, 'transform');
  assert.equal(diff[2]?.change, 'compareOnly');
  assert.equal(diff[2]?.compare?.eventType, 'run.complete');
});

test('diffProducedAssets detects changed, removed, and added assets', () => {
  const baseAssets: WorkflowRunStepAssetRecord[] = [
    {
      id: 'asset-1a',
      workflowDefinitionId: 'wf',
      workflowRunId: 'runA',
      workflowRunStepId: 'step-1a',
      stepId: 'extract',
      assetId: 'dataset.users',
      payload: { version: 1 },
      schema: null,
      freshness: null,
      partitionKey: '2024-01-01',
      producedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:01.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z'
    },
    {
      id: 'asset-2a',
      workflowDefinitionId: 'wf',
      workflowRunId: 'runA',
      workflowRunStepId: 'step-2a',
      stepId: 'transform',
      assetId: 'dataset.metrics',
      payload: { checksum: 'abc' },
      schema: null,
      freshness: null,
      partitionKey: null,
      producedAt: '2024-01-01T00:10:00.000Z',
      createdAt: '2024-01-01T00:10:01.000Z',
      updatedAt: '2024-01-01T00:10:01.000Z'
    }
  ];

  const compareAssets: WorkflowRunStepAssetRecord[] = [
    {
      id: 'asset-1b',
      workflowDefinitionId: 'wf',
      workflowRunId: 'runB',
      workflowRunStepId: 'step-1b',
      stepId: 'extract',
      assetId: 'dataset.users',
      payload: { version: 2 },
      schema: null,
      freshness: null,
      partitionKey: '2024-01-01',
      producedAt: '2024-01-02T00:00:00.000Z',
      createdAt: '2024-01-02T00:00:01.000Z',
      updatedAt: '2024-01-02T00:00:01.000Z'
    },
    {
      id: 'asset-3b',
      workflowDefinitionId: 'wf',
      workflowRunId: 'runB',
      workflowRunStepId: 'step-3b',
      stepId: 'load',
      assetId: 'dataset.reports',
      payload: { checksum: 'xyz' },
      schema: null,
      freshness: null,
      partitionKey: null,
      producedAt: '2024-01-02T00:20:00.000Z',
      createdAt: '2024-01-02T00:20:01.000Z',
      updatedAt: '2024-01-02T00:20:01.000Z'
    }
  ];

  const diff = diffProducedAssets(baseAssets, compareAssets);
  assert.equal(diff.length, 3);

  const changed = diff.find((entry) => entry.change === 'changed');
  assert.ok(changed);
  assert.equal(changed.assetId, 'dataset.users');
  assert.equal(changed.base?.payload?.version, 1);
  assert.equal(changed.compare?.payload?.version, 2);

  const baseOnly = diff.find((entry) => entry.change === 'baseOnly');
  assert.ok(baseOnly);
  assert.equal(baseOnly.assetId, 'dataset.metrics');

  const compareOnly = diff.find((entry) => entry.change === 'compareOnly');
  assert.ok(compareOnly);
  assert.equal(compareOnly.assetId, 'dataset.reports');
});

test('computeStaleAssetWarnings matches stale partitions against produced assets', () => {
  const assets: WorkflowRunStepAssetRecord[] = [
    {
      id: 'asset-1',
      workflowDefinitionId: 'wf',
      workflowRunId: 'runA',
      workflowRunStepId: 'step-1',
      stepId: 'extract',
      assetId: 'dataset.users',
      payload: null,
      schema: null,
      freshness: null,
      partitionKey: '2024-01-01',
      producedAt: '2024-01-01T00:00:00.000Z',
      createdAt: '2024-01-01T00:00:01.000Z',
      updatedAt: '2024-01-01T00:00:01.000Z'
    },
    {
      id: 'asset-2',
      workflowDefinitionId: 'wf',
      workflowRunId: 'runA',
      workflowRunStepId: 'step-2',
      stepId: 'transform',
      assetId: 'dataset.metrics',
      payload: null,
      schema: null,
      freshness: null,
      partitionKey: null,
      producedAt: '2024-01-01T00:10:00.000Z',
      createdAt: '2024-01-01T00:10:01.000Z',
      updatedAt: '2024-01-01T00:10:01.000Z'
    }
  ];

  const stale: WorkflowAssetStalePartitionRecord[] = [
    {
      workflowDefinitionId: 'wf',
      assetId: 'dataset.users',
      partitionKey: '2024-01-01',
      partitionKeyNormalized: '2024-01-01',
      requestedAt: '2024-01-02T00:00:00.000Z',
      requestedBy: 'ops@example.com',
      note: 'Detected schema drift'
    },
    {
      workflowDefinitionId: 'wf',
      assetId: 'dataset.other',
      partitionKey: null,
      partitionKeyNormalized: '',
      requestedAt: '2024-01-02T00:00:00.000Z',
      requestedBy: null,
      note: null
    }
  ];

  const warnings = computeStaleAssetWarnings(assets, stale);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.assetId, 'dataset.users');
  assert.equal(warnings[0]?.partitionKey, '2024-01-01');
  assert.equal(warnings[0]?.requestedBy, 'ops@example.com');
  assert.equal(warnings[0]?.note, 'Detected schema drift');
});
