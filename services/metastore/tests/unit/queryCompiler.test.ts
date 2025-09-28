import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileQueryString } from '../../src/search/queryCompiler';

test('parses multi-clause AND query', () => {
  const filter = compileQueryString('key:foo owner=ops');
  assert.equal(filter.type, 'group');
  if (filter.type !== 'group') {
    throw new Error('Expected group node');
  }
  assert.equal(filter.operator, 'and');
  assert.equal(filter.filters.length, 2);
  const [first, second] = filter.filters;
  assert.equal(first.type, 'condition');
  assert.equal(first.type === 'condition' ? first.condition.field : 'missing', 'key');
  assert.equal(first.type === 'condition' ? first.condition.operator : 'missing', 'eq');
  assert.equal(first.type === 'condition' ? first.condition.value : 'missing', 'foo');
  assert.equal(second.type, 'condition');
  assert.equal(second.type === 'condition' ? second.condition.field : 'missing', 'owner');
  assert.equal(second.type === 'condition' ? second.condition.value : 'missing', 'ops');
});

test('parses quoted value and metadata shorthands', () => {
  const filter = compileQueryString('status:"in progress" tags=analytics');
  assert.equal(filter.type, 'group');
  if (filter.type !== 'group') {
    throw new Error('Expected group node');
  }
  const [statusNode] = filter.filters;
  assert.equal(statusNode.type, 'condition');
  if (statusNode.type !== 'condition') {
    throw new Error('Expected condition node');
  }
  assert.equal(statusNode.condition.field, 'metadata.status');
  assert.equal(statusNode.condition.value, 'in progress');
});

test('parses numeric comparison operators', () => {
  const filter = compileQueryString('version>=10 metadata.thresholds.latencyMs<250');
  assert.equal(filter.type, 'group');
  if (filter.type !== 'group') {
    throw new Error('Expected group node');
  }
  const versionNode = filter.filters.find((node) => node.type === 'condition' && node.condition.field === 'version');
  assert.ok(versionNode && versionNode.type === 'condition');
  assert.equal(versionNode.condition.operator, 'gte');
  assert.equal(versionNode.condition.value, 10);
  const latencyNode = filter.filters.find(
    (node) => node.type === 'condition' && node.condition.field === 'metadata.thresholds.latencyMs'
  );
  assert.ok(latencyNode && latencyNode.type === 'condition');
  assert.equal(latencyNode.condition.operator, 'lt');
});

test('throws for invalid query segments', () => {
  assert.throws(() => compileQueryString('namespace'), {
    message: /missing a comparison operator/
  });
});

test('supports inequality and null handling', () => {
  const filter = compileQueryString('owner!=null deletedAt:null');
  assert.equal(filter.type, 'group');
  if (filter.type !== 'group') {
    throw new Error('Expected group node');
  }
  const ownerNode = filter.filters.find((node) => node.type === 'condition' && node.condition.field === 'owner');
  assert.ok(ownerNode && ownerNode.type === 'condition');
  assert.equal(ownerNode.condition.operator, 'neq');
  assert.equal(ownerNode.condition.value, null);
  const deletedNode = filter.filters.find((node) => node.type === 'condition' && node.condition.field === 'deletedAt');
  assert.ok(deletedNode && deletedNode.type === 'condition');
  assert.equal(deletedNode.condition.operator, 'eq');
  assert.equal(deletedNode.condition.value, null);
});
