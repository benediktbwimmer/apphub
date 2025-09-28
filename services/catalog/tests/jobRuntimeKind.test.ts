import { describe, expect, test } from 'vitest';
import { resolveJobRuntime } from '../src/jobs/runtimeKind';
import type { JobDefinitionRecord, JsonValue } from '../src/db/types';

function makeDefinition(overrides: Partial<JobDefinitionRecord>): JobDefinitionRecord {
  const base: JobDefinitionRecord = {
    id: 'def-1',
    slug: 'sample-job',
    name: 'Sample Job',
    version: 1,
    type: 'batch',
    runtime: 'node',
    entryPoint: 'index.js',
    parametersSchema: {},
    defaultParameters: {},
    outputSchema: {},
    timeoutMs: null,
    retryPolicy: null,
    metadata: {},
    createdAt: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2024-01-01T00:00:00.000Z').toISOString()
  } satisfies JobDefinitionRecord;
  return { ...base, ...overrides } satisfies JobDefinitionRecord;
}

describe('resolveJobRuntime', () => {
  test('selects runtime from explicit definition field', () => {
    expect(resolveJobRuntime(makeDefinition({ runtime: 'node' }))).toBe('node');
    expect(resolveJobRuntime(makeDefinition({ runtime: 'python' }))).toBe('python');
    expect(resolveJobRuntime(makeDefinition({ runtime: 'docker' }))).toBe('docker');
  });

  test('ignores metadata when explicit runtime is node', () => {
    const metadata = { runtime: 'docker/v1' } satisfies JsonValue;
    const definition = makeDefinition({ runtime: 'node', metadata });
    expect(resolveJobRuntime(definition)).toBe('node');
  });

  test('ignores metadata when explicit runtime is python', () => {
    const metadata = { runtime: { type: 'docker' } } satisfies JsonValue;
    const definition = makeDefinition({ runtime: 'python', metadata });
    expect(resolveJobRuntime(definition)).toBe('python');
  });

  test('defaults to node when runtime metadata missing', () => {
    const definition = makeDefinition({ runtime: 'node', metadata: {} });
    expect(resolveJobRuntime(definition)).toBe('node');
  });
});
