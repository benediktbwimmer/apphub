import { Liquid } from 'liquidjs';
import { ZodError, ZodIssueCode } from 'zod';
import type { JsonValue } from '../db/types';

export type TemplateValidationIssue = {
  path: Array<string | number>;
  message: string;
};

export type TriggerTemplateValues = {
  parameterTemplate: JsonValue | null;
  idempotencyKeyExpression: string | null;
  runKeyTemplate: string | null;
};

export type TriggerTemplateContext = {
  trigger: Record<string, unknown>;
  sampleEvent?: Record<string, unknown> | null;
  parameters?: Record<string, unknown> | null;
};

const syntaxEngine = new Liquid({ cache: false, strictFilters: true, strictVariables: false });
const strictEngine = new Liquid({ cache: false, strictFilters: true, strictVariables: true });

function cloneContext<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function hasLiquidSyntax(value: string): boolean {
  return value.includes('{{') || value.includes('{%');
}

function formatLiquidError(err: unknown): string {
  if (err instanceof Error) {
    const line = (err as { line?: number }).line;
    const column = (err as { column?: number; col?: number }).column ?? (err as { column?: number; col?: number }).col;
    if (line && column) {
      return `${err.message} (line ${line}, column ${column})`;
    }
    if (line) {
      return `${err.message} (line ${line})`;
    }
    return err.message;
  }
  return 'Failed to compile Liquid template';
}

async function validateStringTemplate(
  value: string,
  path: Array<string | number>,
  baseContext: Record<string, unknown>,
  strictContext: Record<string, unknown> | null,
  issues: TemplateValidationIssue[]
): Promise<void> {
  if (!hasLiquidSyntax(value)) {
    return;
  }
  try {
    await syntaxEngine.parseAndRender(value, baseContext);
  } catch (err) {
    issues.push({ path, message: formatLiquidError(err) });
    return;
  }
  if (!strictContext) {
    return;
  }
  try {
    await strictEngine.parseAndRender(value, strictContext);
  } catch (err) {
    issues.push({ path, message: formatLiquidError(err) });
  }
}

async function validateJsonTemplate(
  value: JsonValue | null,
  path: Array<string | number>,
  baseContext: Record<string, unknown>,
  strictContext: Record<string, unknown> | null,
  issues: TemplateValidationIssue[]
): Promise<void> {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'string') {
    await validateStringTemplate(value, path, baseContext, strictContext, issues);
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index] as JsonValue;
      await validateJsonTemplate(entry, [...path, index], baseContext, strictContext, issues);
    }
    return;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, JsonValue>);
    for (const [key, entry] of entries) {
      await validateStringTemplate(key, [...path, '$key', key], baseContext, strictContext, issues);
      await validateJsonTemplate(entry, [...path, key], baseContext, strictContext, issues);
    }
  }
}

function buildContextSkeleton(): Record<string, unknown> {
  return {
    event: {
      id: 'preview-event',
      type: 'preview.event',
      source: 'preview.source',
      occurredAt: '1970-01-01T00:00:00.000Z',
      payload: {},
      metadata: {},
      correlationId: null,
      ttl: null
    },
    trigger: {
      id: 'preview-trigger',
      workflowDefinitionId: 'preview-workflow',
      name: null,
      description: null,
      eventType: 'preview.event',
      eventSource: null,
      predicates: [],
      parameterTemplate: null,
      runKeyTemplate: null,
      idempotencyKeyExpression: null,
      throttleWindowMs: null,
      throttleCount: null,
      maxConcurrency: null,
      status: 'active',
      metadata: null,
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z'
    },
    parameters: {},
    now: '1970-01-01T00:00:00.000Z'
  } satisfies Record<string, unknown>;
}

function mergeContext(
  skeleton: Record<string, unknown>,
  override: TriggerTemplateContext,
  useStrict: boolean
): { base: Record<string, unknown>; strict: Record<string, unknown> | null } {
  const baseContext = cloneContext(skeleton) as Record<string, unknown>;
  const trigger = override.trigger ?? {};
  baseContext.trigger = {
    ...(baseContext.trigger as Record<string, unknown>),
    ...trigger
  };
  if (override.parameters && typeof override.parameters === 'object') {
    baseContext.parameters = {
      ...(baseContext.parameters as Record<string, unknown>),
      ...override.parameters
    } satisfies Record<string, unknown>;
  }
  const eventOverride = override.sampleEvent;
  if (eventOverride && typeof eventOverride === 'object') {
    baseContext.event = {
      ...(baseContext.event as Record<string, unknown>),
      ...eventOverride
    } satisfies Record<string, unknown>;
  } else if (eventOverride === null) {
    baseContext.event = {
      ...(baseContext.event as Record<string, unknown>),
      payload: null
    } satisfies Record<string, unknown>;
  }

  if (!useStrict || !eventOverride) {
    return { base: baseContext, strict: null };
  }

  const strictContext = cloneContext(baseContext) as Record<string, unknown>;
  if (override.parameters && typeof override.parameters === 'object') {
    strictContext.parameters = {
      ...(strictContext.parameters as Record<string, unknown>),
      ...override.parameters
    } satisfies Record<string, unknown>;
  }
  return { base: baseContext, strict: strictContext };
}

export async function validateTriggerTemplates(
  values: TriggerTemplateValues,
  context: TriggerTemplateContext
): Promise<TemplateValidationIssue[]> {
  const skeleton = buildContextSkeleton();
  const useStrict = Boolean(context.sampleEvent);
  const { base, strict } = mergeContext(skeleton, context, useStrict);
  const issues: TemplateValidationIssue[] = [];

  await validateJsonTemplate(values.parameterTemplate, ['parameterTemplate'], base, strict, issues);

  const keyExpression = values.idempotencyKeyExpression;
  if (typeof keyExpression === 'string' && keyExpression.trim().length > 0) {
    await validateStringTemplate(keyExpression, ['idempotencyKeyExpression'], base, strict, issues);
  }

  const runKeyTemplate = values.runKeyTemplate;
  if (typeof runKeyTemplate === 'string' && runKeyTemplate.trim().length > 0) {
    const parametersContext =
      (base.parameters as Record<string, unknown> | undefined) ?? ({} as Record<string, unknown>);
    const runKeyBase = cloneContext(base) as Record<string, unknown>;
    runKeyBase.parameters = parametersContext;
    const runKeyStrict = strict
      ? (() => {
          const strictClone = cloneContext(strict) as Record<string, unknown>;
          strictClone.parameters = parametersContext;
          return strictClone;
        })()
      : null;
    await validateStringTemplate(runKeyTemplate, ['runKeyTemplate'], runKeyBase, runKeyStrict, issues);
  }

  return issues;
}

export function assertNoTemplateIssues(issues: TemplateValidationIssue[]): void {
  if (!issues.length) {
    return;
  }
  throw new ZodError(
    issues.map((issue) => ({
      code: ZodIssueCode.custom,
      message: issue.message,
      path: issue.path
    }))
  );
}
