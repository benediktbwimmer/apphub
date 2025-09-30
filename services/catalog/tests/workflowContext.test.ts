import './setupTestEnv';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildTemplateScope,
  mergeParameters,
  resolveJsonTemplates,
  resolveTemplateString,
  serializeContext,
  setSharedValue,
  templateValueToString,
  updateStepContext,
  withStepScope,
  type FanOutRuntimeMetadata,
  type WorkflowRuntimeContext,
  type WorkflowStepRuntimeContext
} from '../src/workflow/context';
import type { JsonValue, WorkflowRunRecord } from '../src/db/types';

function createRun(overrides: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  const now = new Date().toISOString();
  return {
    id: 'run-1',
    workflowDefinitionId: 'wf-1',
    status: 'pending',
    runKey: null,
    runKeyNormalized: null,
    parameters: {},
    context: {},
    output: null,
    errorMessage: null,
    currentStepId: null,
    currentStepIndex: null,
    metrics: null,
    triggeredBy: null,
    trigger: null,
    partitionKey: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    createdAt: now,
    updatedAt: now,
    retrySummary: { pendingSteps: 0, nextAttemptAt: null, overdueSteps: 0 },
    ...overrides
  } satisfies WorkflowRunRecord;
}

function createContext(initial?: Partial<WorkflowRuntimeContext>): WorkflowRuntimeContext {
  return {
    steps: {},
    lastUpdatedAt: new Date().toISOString(),
    shared: {},
    ...initial
  } satisfies WorkflowRuntimeContext;
}

describe('workflow context helpers', () => {
  it('resolves template strings against run, step, and shared scope', () => {
    const run = createRun({ parameters: { greeting: 'hello' } as JsonValue });
    const context = createContext({
      steps: {
        'step-1': {
          status: 'succeeded',
          jobRunId: null,
          result: 'world'
        } satisfies WorkflowStepRuntimeContext
      },
      shared: { adjective: 'calm' }
    });

    const baseScope = buildTemplateScope(run, context);
    const stepScope = withStepScope(baseScope, 'step-1', { tone: 'gentle' } as JsonValue);

    const resolved = resolveTemplateString('{{ steps.step-1.result }}', stepScope);
    assert.equal(resolved, 'world');

    const sharedResolved = resolveTemplateString('Value: {{ shared.adjective }}', stepScope);
    assert.equal(sharedResolved, 'Value: calm');
  });

  it('exposes fan-out metadata in the scope', () => {
    const run = createRun();
    const context = createContext();
    const scope = buildTemplateScope(run, context);
    const fanOutMeta: FanOutRuntimeMetadata = {
      parentStepId: 'parent',
      templateStepId: 'template',
      index: 2,
      item: 'item-3'
    };

    const scoped = withStepScope(scope, 'child', { value: 42 } as JsonValue, fanOutMeta);
    const resolvedItem = resolveTemplateString('Fan item: {{ fanout.item }}', scoped);
    assert.equal(resolvedItem, 'Fan item: item-3');
  });

  it('merges run and step parameters with step taking precedence', () => {
    const merged = mergeParameters(
      { base: 'run', override: 'run-only' } as JsonValue,
      { override: 'step', extra: 'step-only' } as JsonValue
    );

    assert.deepEqual(merged, { base: 'run', override: 'step', extra: 'step-only' });
  });

  it('updates step context immutably and tracks shared values', () => {
    const context = createContext();
    const updated = updateStepContext(context, 'step-1', {
      status: 'running',
      jobRunId: 'job-1'
    });

    assert.equal(context.steps['step-1'], undefined);
    assert.equal(updated.steps['step-1']?.status, 'running');

    const withShared = setSharedValue(updated, 'resultKey', 'value');
    assert.equal(withShared.shared?.resultKey, 'value');
  });

  it('resolves templated objects recursively', () => {
    const run = createRun({ parameters: { greeting: 'hello' } as JsonValue });
    const context = createContext({
      steps: {
        setup: {
          status: 'succeeded',
          jobRunId: null,
          result: { audience: 'team' } as JsonValue
        }
      }
    });

    const scope = withStepScope(buildTemplateScope(run, context), 'setup', {} as JsonValue);
    const templated = {
      message: 'Say {{ parameters.greeting }}',
      audience: '{{ steps.setup.result.audience }}'
    } as JsonValue;

    const resolved = resolveJsonTemplates(templated, scope);
    assert.deepEqual(resolved, { message: 'Say hello', audience: 'team' });
  });

  it('stringifies template values when required', () => {
    const value = templateValueToString({ nested: true });
    assert.equal(value, '{"nested":true}');
  });

  it('preserves stack traces and error metadata in serialized step context', () => {
    const context = createContext();
    const failureDetails = {
      stack: 'SampleError: boom\n    at handler (bundle.js:1:1)',
      name: 'SampleError',
      properties: { hint: 'check inputs' } as Record<string, JsonValue>
    };

    const failed = updateStepContext(context, 'step-1', {
      status: 'failed',
      jobRunId: 'job-1',
      errorMessage: 'boom',
      context: {
        stack: failureDetails.stack,
        errorName: failureDetails.name,
        properties: failureDetails.properties
      } as JsonValue,
      errorStack: failureDetails.stack,
      errorName: failureDetails.name,
      errorProperties: failureDetails.properties
    });

    const serialized = serializeContext(failed);
    assert(serialized && typeof serialized === 'object', 'serialized context should be an object');
    const serializedSteps = (serialized as { steps?: Record<string, Record<string, JsonValue>> }).steps;
    assert(serializedSteps, 'expected serialized steps to be present');
    const serializedStep = serializedSteps?.['step-1'];
    assert(serializedStep, 'expected serialized step entry');
    assert.equal(serializedStep?.errorStack, failureDetails.stack);
    assert.equal(serializedStep?.errorName, failureDetails.name);
    assert.deepEqual(serializedStep?.errorProperties, failureDetails.properties);

    const cleared = updateStepContext(failed, 'step-1', {
      status: 'running',
      errorMessage: null
    });
    const clearedStep = cleared.steps['step-1'];
    assert.equal(clearedStep?.errorStack, null);
    assert.equal(clearedStep?.errorName, null);
    assert.equal(clearedStep?.errorProperties, null);
  });
});
