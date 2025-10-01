import assert from 'node:assert/strict';
import { ZodError } from 'zod';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const validation = require('../src/workflows/liquidTemplateValidation') as typeof import('../src/workflows/liquidTemplateValidation');
const { validateTriggerTemplates, assertNoTemplateIssues } = validation;

type TriggerContextInput = Parameters<typeof validateTriggerTemplates>[1]['trigger'];

type SampleEventInput = NonNullable<Parameters<typeof validateTriggerTemplates>[1]['sampleEvent']>;

function buildTriggerContext(overrides: Partial<TriggerContextInput> = {}): TriggerContextInput {
  return {
    workflowDefinitionId: 'wf-test',
    name: 'test trigger',
    description: null,
    eventType: 'test.event',
    eventSource: null,
  predicates: [],
  parameterTemplate: null,
  runKeyTemplate: null,
  idempotencyKeyExpression: null,
    metadata: null,
    throttleWindowMs: null,
    throttleCount: null,
    maxConcurrency: null,
    status: 'active',
    ...overrides
  } satisfies TriggerContextInput;
}

function buildSampleEvent(overrides: Partial<SampleEventInput> = {}): SampleEventInput {
  return {
    id: 'evt-123',
    type: 'test.event',
    source: 'test.source',
    occurredAt: '2024-01-01T00:00:00.000Z',
    payload: {},
    metadata: {},
    ...overrides
  } satisfies SampleEventInput;
}

async function expectTemplateError(
  parameterTemplate: unknown,
  idempotencyKeyExpression: string | null,
  runKeyTemplate: string | null,
  options: { sampleEvent?: SampleEventInput | null; parameters?: Record<string, unknown> | null } = {}
): Promise<void> {
  const issues = await validateTriggerTemplates(
    {
      parameterTemplate: (parameterTemplate ?? null) as unknown,
      idempotencyKeyExpression: idempotencyKeyExpression ?? null,
      runKeyTemplate: runKeyTemplate ?? null
    },
    {
      trigger: buildTriggerContext({
        parameterTemplate: (parameterTemplate ?? null) as unknown,
        idempotencyKeyExpression: idempotencyKeyExpression ?? null,
        runKeyTemplate: runKeyTemplate ?? null
      }),
      sampleEvent: options.sampleEvent ?? null,
      parameters: options.parameters ?? null
    }
  );
  assert.ok(issues.length > 0, 'expected validation issues');
  assert.throws(() => assertNoTemplateIssues(issues), ZodError);
}

async function expectTemplateSuccess(
  parameterTemplate: unknown,
  idempotencyKeyExpression: string | null,
  runKeyTemplate: string | null,
  options: { sampleEvent?: SampleEventInput | null; parameters?: Record<string, unknown> | null } = {}
): Promise<void> {
  const issues = await validateTriggerTemplates(
    {
      parameterTemplate: (parameterTemplate ?? null) as unknown,
      idempotencyKeyExpression: idempotencyKeyExpression ?? null,
      runKeyTemplate: runKeyTemplate ?? null
    },
    {
      trigger: buildTriggerContext({
        parameterTemplate: (parameterTemplate ?? null) as unknown,
        idempotencyKeyExpression: idempotencyKeyExpression ?? null,
        runKeyTemplate: runKeyTemplate ?? null
      }),
      sampleEvent: options.sampleEvent ?? null,
      parameters: options.parameters ?? null
    }
  );
  assert.deepEqual(issues, []);
  assert.doesNotThrow(() => assertNoTemplateIssues(issues));
}

async function run(): Promise<void> {
  await expectTemplateError('{{ event.payload.id ', null, null);

  await expectTemplateError(
    '{{ event.payload.id | unknown_filter }}',
    null,
    null
  );

  await expectTemplateSuccess(
    { namespace: '{{ event.payload.namespace | downcase }}' },
    '{{ event.id }}',
    null,
    { sampleEvent: buildSampleEvent({ payload: { namespace: 'DATA' } }) }
  );

  await expectTemplateError(
    { detail: '{{ event.payload.missing }}' },
    null,
    null,
    { sampleEvent: buildSampleEvent({ payload: { present: 'value' } }) }
  );

  await expectTemplateSuccess(
    { identifier: '{{ trigger.id }}' },
    '{{ event.source }}',
    null
  );

  await expectTemplateSuccess(
    { namespace: '{{ event.payload.namespace }}' },
    null,
    '{{ parameters.namespace }}-{{ event.id }}',
    {
      sampleEvent: buildSampleEvent({ payload: { namespace: 'DATA' } }),
      parameters: { namespace: 'DATA' }
    }
  );

  await expectTemplateError(
    null,
    null,
    '{{ parameters.missing }}',
    {
      sampleEvent: buildSampleEvent({ payload: {} })
    }
  );
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
