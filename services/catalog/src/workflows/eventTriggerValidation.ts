import { z, ZodError } from 'zod';
import {
  type JsonValue,
  type WorkflowEventTriggerCreateInput,
  type WorkflowEventTriggerPredicate,
  type WorkflowEventTriggerStatus,
  type WorkflowEventTriggerUpdateInput,
  type WorkflowTriggerDeliveryStatus
} from '../db/types';
import { jsonValueSchema } from './zodSchemas';

const EVENT_IDENTIFIER_REGEX = /^[a-z0-9][a-z0-9._:-]*$/i;

const ALLOWED_REGEX_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y']);
const MAX_REGEX_PATTERN_LENGTH = 512;

const optionalActorSchema = z
  .string()
  .trim()
  .min(1, 'Actor must be at least 1 character')
  .max(200, 'Actor must be at most 200 characters')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const optionalNameSchema = z
  .string()
  .trim()
  .max(200, 'name must be at most 200 characters')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const optionalDescriptionSchema = z
  .string()
  .trim()
  .max(2000, 'description must be at most 2000 characters')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const eventTypeSchema = z
  .string({ required_error: 'eventType is required' })
  .trim()
  .min(1, 'eventType is required')
  .max(200, 'eventType must be at most 200 characters')
  .refine((value) => EVENT_IDENTIFIER_REGEX.test(value), {
    message: 'eventType must contain only alphanumeric characters, dot, dash, colon, or underscore'
  });

const optionalEventSourceSchema = z
  .string()
  .trim()
  .min(1, 'eventSource must be at least 1 character')
  .max(200, 'eventSource must be at most 200 characters')
  .refine((value) => EVENT_IDENTIFIER_REGEX.test(value), {
    message: 'eventSource must contain only alphanumeric characters, dot, dash, colon, or underscore'
  })
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const optionalIdempotencyExpressionSchema = z
  .string()
  .trim()
  .max(200, 'idempotencyKeyExpression must be at most 200 characters')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const optionalRunKeyTemplateSchema = z
  .string()
  .trim()
  .max(500, 'runKeyTemplate must be at most 500 characters')
  .nullish()
  .transform((value) => (value && value.length > 0 ? value : null));

const throttleWindowSchema = z
  .number({ invalid_type_error: 'throttleWindowMs must be a number' })
  .int('throttleWindowMs must be an integer')
  .min(1, 'throttleWindowMs must be greater than 0')
  .max(86_400_000, 'throttleWindowMs must be less than or equal to 86400000 (24h)')
  .nullish()
  .transform((value) => (value === undefined || value === null ? null : value));

const throttleCountSchema = z
  .number({ invalid_type_error: 'throttleCount must be a number' })
  .int('throttleCount must be an integer')
  .min(1, 'throttleCount must be greater than 0')
  .max(10_000, 'throttleCount must be less than or equal to 10000')
  .nullish()
  .transform((value) => (value === undefined || value === null ? null : value));

const maxConcurrencySchema = z
  .number({ invalid_type_error: 'maxConcurrency must be a number' })
  .int('maxConcurrency must be an integer')
  .min(1, 'maxConcurrency must be greater than 0')
  .max(1_000, 'maxConcurrency must be less than or equal to 1000')
  .nullish()
  .transform((value) => (value === undefined || value === null ? null : value));

const jsonValueOrNullSchema = jsonValueSchema.nullable().optional().transform((value) => value ?? null);

const sampleEventSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    type: z.string().trim().min(1).optional(),
    source: z.string().trim().min(1).optional(),
    occurredAt: z.string().trim().min(1).optional(),
    payload: jsonValueSchema.optional(),
    correlationId: z.string().trim().min(1).optional(),
    ttl: z.number().int().min(1).optional(),
    metadata: z.record(jsonValueSchema).optional()
  })
  .strict()
  .transform((value) => ({
    ...value,
    payload: value.payload ?? {},
    metadata: value.metadata ?? {}
  }));

function normalizeCaseSensitiveFlag(flag: unknown): boolean | undefined {
  if (typeof flag === 'boolean') {
    return flag;
  }
  return undefined;
}

function normalizeRegexFlags(raw: string | undefined, caseSensitive?: boolean) {
  const normalized: string[] = [];
  const invalid: string[] = [];

  if (raw) {
    for (const char of raw) {
      if (!ALLOWED_REGEX_FLAGS.has(char)) {
        invalid.push(char);
        continue;
      }
      if (!normalized.includes(char)) {
        normalized.push(char);
      }
    }
  }

  if (caseSensitive === false && !normalized.includes('i')) {
    normalized.push('i');
  }

  if (caseSensitive === true) {
    const index = normalized.indexOf('i');
    if (index >= 0) {
      normalized.splice(index, 1);
    }
  }

  normalized.sort();
  return {
    normalized: normalized.length > 0 ? normalized.join('') : undefined,
    invalid
  } as const;
}

const predicateInputSchema = z
  .object({
    type: z.literal('jsonPath').optional(),
    path: z
      .string({ required_error: 'predicate.path is required' })
      .trim()
      .min(1, 'predicate.path is required')
      .max(512, 'predicate.path must be at most 512 characters')
      .refine((value) => value.startsWith('$'), {
        message: 'predicate.path must start with $'
      }),
    operator: z.enum([
      'exists',
      'equals',
      'notEquals',
      'in',
      'notIn',
      'gt',
      'gte',
      'lt',
      'lte',
      'regex',
      'contains'
    ]),
    value: jsonValueSchema.optional(),
    values: z.array(jsonValueSchema).max(100, 'predicate.values must include at most 100 entries').optional(),
    caseSensitive: z.boolean().optional(),
    flags: z
      .string()
      .trim()
      .max(10, 'predicate.flags must be at most 10 characters')
      .optional()
  })
  .superRefine((value, ctx) => {
    const caseSensitive = normalizeCaseSensitiveFlag(value.caseSensitive);

    if (value.operator === 'exists') {
      if (value.value !== undefined || value.values !== undefined || value.flags !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value, predicate.values, and predicate.flags must be omitted when operator is exists'
        });
      }
      return;
    }

    if (value.operator === 'equals' || value.operator === 'notEquals') {
      if (value.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value is required for equals/notEquals operators'
        });
      }
      if (value.values !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.values must be omitted for equals/notEquals operators'
        });
      }
      if (value.flags !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.flags is only supported for regex operator'
        });
      }
      return;
    }

    if (value.operator === 'in' || value.operator === 'notIn') {
      if (!value.values || value.values.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.values must include at least one entry for in/notIn operators'
        });
      }
      if (value.value !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value must be omitted for in/notIn operators'
        });
      }
      if (value.flags !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.flags is only supported for regex operator'
        });
      }
      return;
    }

    if (value.operator === 'contains') {
      if (value.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value is required for contains operator'
        });
      }
      if (value.values !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.values must be omitted for contains operator'
        });
      }
      if (value.flags !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.flags is only supported for regex operator'
        });
      }
      return;
    }

    if (value.operator === 'gt' || value.operator === 'gte' || value.operator === 'lt' || value.operator === 'lte') {
      if (value.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `predicate.value is required for ${value.operator} operator`
        });
      } else if (typeof value.value !== 'number' || !Number.isFinite(value.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `predicate.value must be a finite number for ${value.operator} operator`
        });
      }
      if (value.values !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.values must be omitted for numeric comparison operators'
        });
      }
      if (value.flags !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.flags is only supported for regex operator'
        });
      }
      return;
    }

    if (value.operator === 'regex') {
      if (typeof value.value !== 'string' || value.value.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value must be a non-empty string for regex operator'
        });
      } else if (value.value.length > MAX_REGEX_PATTERN_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `predicate.value must be at most ${MAX_REGEX_PATTERN_LENGTH} characters for regex operator`
        });
      }

      if (value.values !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.values must be omitted for regex operator'
        });
      }

      const rawFlags = typeof value.flags === 'string' && value.flags.length > 0 ? value.flags : undefined;
      const { normalized, invalid } = normalizeRegexFlags(rawFlags, caseSensitive);
      if (invalid.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `predicate.flags contains unsupported values: ${invalid.join(', ')}`
        });
      }
      if (caseSensitive === true && rawFlags?.includes('i')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.flags must not include "i" when caseSensitive is true'
        });
      }

      if (typeof value.value === 'string') {
        try {
          void new RegExp(value.value, normalized ?? undefined);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid regex: ${(error as Error).message}`
          });
        }
      }
      return;
    }
  })
  .transform((value): WorkflowEventTriggerPredicate => {
    const path = value.path.trim();
    const caseSensitive = normalizeCaseSensitiveFlag(value.caseSensitive);
    switch (value.operator) {
      case 'exists':
        return { type: 'jsonPath', path, operator: 'exists' };
      case 'equals':
        return {
          type: 'jsonPath',
          path,
          operator: 'equals',
          value: value.value as JsonValue,
          ...(caseSensitive === undefined ? {} : { caseSensitive })
        };
      case 'notEquals':
        return {
          type: 'jsonPath',
          path,
          operator: 'notEquals',
          value: value.value as JsonValue,
          ...(caseSensitive === undefined ? {} : { caseSensitive })
        };
      case 'in':
        return {
          type: 'jsonPath',
          path,
          operator: 'in',
          values: (value.values ?? []) as JsonValue[],
          ...(caseSensitive === undefined ? {} : { caseSensitive })
        };
      case 'notIn':
        return {
          type: 'jsonPath',
          path,
          operator: 'notIn',
          values: (value.values ?? []) as JsonValue[],
          ...(caseSensitive === undefined ? {} : { caseSensitive })
        };
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        return {
          type: 'jsonPath',
          path,
          operator: value.operator,
          value: value.value as number
        };
      case 'contains':
        return {
          type: 'jsonPath',
          path,
          operator: 'contains',
          value: value.value as JsonValue,
          ...(caseSensitive === undefined ? {} : { caseSensitive })
        };
      case 'regex': {
        const { normalized } = normalizeRegexFlags(
          typeof value.flags === 'string' && value.flags.length > 0 ? value.flags : undefined,
          caseSensitive
        );
        return {
          type: 'jsonPath',
          path,
          operator: 'regex',
          value: (value.value as string).trim(),
          ...(caseSensitive === undefined ? {} : { caseSensitive }),
          ...(normalized ? { flags: normalized } : {})
        };
      }
      default:
        return { type: 'jsonPath', path, operator: 'exists' };
    }
  });

const predicateArraySchema = z
  .array(predicateInputSchema)
  .max(25, 'predicates must include at most 25 entries')
  .optional()
  .transform((value) => value ?? []);

const statusSchema = z.union([z.literal('active'), z.literal('disabled')]).default('active');

const triggerCreateSchema = z
  .object({
    name: optionalNameSchema,
    description: optionalDescriptionSchema,
    eventType: eventTypeSchema,
    eventSource: optionalEventSourceSchema,
    predicates: predicateArraySchema,
    parameterTemplate: jsonValueOrNullSchema,
    runKeyTemplate: optionalRunKeyTemplateSchema,
    throttleWindowMs: throttleWindowSchema,
    throttleCount: throttleCountSchema,
    maxConcurrency: maxConcurrencySchema,
    idempotencyKeyExpression: optionalIdempotencyExpressionSchema,
    metadata: jsonValueOrNullSchema,
    status: statusSchema,
    createdBy: optionalActorSchema
  })
  .strict();

const triggerUpdateSchema = z
  .object({
    name: optionalNameSchema.optional(),
    description: optionalDescriptionSchema.optional(),
    eventType: eventTypeSchema.optional(),
    eventSource: optionalEventSourceSchema.optional(),
    predicates: predicateArraySchema.optional(),
    parameterTemplate: jsonValueOrNullSchema.optional(),
    runKeyTemplate: optionalRunKeyTemplateSchema.optional(),
    throttleWindowMs: throttleWindowSchema.optional(),
    throttleCount: throttleCountSchema.optional(),
    maxConcurrency: maxConcurrencySchema.optional(),
    idempotencyKeyExpression: optionalIdempotencyExpressionSchema.optional(),
    metadata: jsonValueOrNullSchema.optional(),
    status: statusSchema.optional(),
    updatedBy: optionalActorSchema.optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be provided to update a trigger'
  });

export type NormalizedWorkflowEventTriggerCreate = z.infer<typeof triggerCreateSchema> & {
  predicates: WorkflowEventTriggerPredicate[];
  status: WorkflowEventTriggerStatus;
};

export type NormalizedWorkflowEventTriggerUpdate = z.infer<typeof triggerUpdateSchema> & {
  predicates?: WorkflowEventTriggerPredicate[];
  status?: WorkflowEventTriggerStatus;
};

export function normalizeWorkflowEventTriggerCreate(
  input: WorkflowEventTriggerCreateInput
): NormalizedWorkflowEventTriggerCreate {
  return triggerCreateSchema.parse({
    name: input.name,
    description: input.description,
    eventType: input.eventType,
    eventSource: input.eventSource,
    predicates: input.predicates,
    parameterTemplate: input.parameterTemplate,
    runKeyTemplate: input.runKeyTemplate,
    throttleWindowMs: input.throttleWindowMs,
    throttleCount: input.throttleCount,
    maxConcurrency: input.maxConcurrency,
    idempotencyKeyExpression: input.idempotencyKeyExpression,
    metadata: input.metadata,
    status: input.status,
    createdBy: input.createdBy
  });
}

export function normalizeWorkflowEventTriggerUpdate(
  input: WorkflowEventTriggerUpdateInput
): NormalizedWorkflowEventTriggerUpdate {
  return triggerUpdateSchema.parse({
    name: input.name,
    description: input.description,
    eventType: input.eventType,
    eventSource: input.eventSource,
    predicates: input.predicates,
    parameterTemplate: input.parameterTemplate,
    runKeyTemplate: input.runKeyTemplate,
    throttleWindowMs: input.throttleWindowMs,
    throttleCount: input.throttleCount,
    maxConcurrency: input.maxConcurrency,
    idempotencyKeyExpression: input.idempotencyKeyExpression,
    metadata: input.metadata,
    status: input.status,
    updatedBy: input.updatedBy
  });
}

export function normalizeWorkflowTriggerDeliveryStatus(
  status: string | null | undefined
): WorkflowTriggerDeliveryStatus {
  switch (status) {
    case 'matched':
    case 'throttled':
    case 'skipped':
    case 'launched':
    case 'failed':
      return status;
    default:
      return 'pending';
  }
}

export function serializeTriggerPredicates(predicates: WorkflowEventTriggerPredicate[]): string {
  return JSON.stringify(predicates);
}

export function serializeJsonValue(value: JsonValue | null): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return JSON.stringify(value);
}

export type NormalizedTriggerSampleEvent = z.infer<typeof sampleEventSchema>;

export function normalizeTriggerSampleEvent(input: unknown): NormalizedTriggerSampleEvent | null {
  if (input === undefined || input === null) {
    return null;
  }
  const result = sampleEventSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues.map((issue) => ({
    ...issue,
    path: ['sampleEvent', ...issue.path]
  }));
  throw new ZodError(issues);
}

export function normalizeOptionalActor(actor?: string | null): string | null {
  return optionalActorSchema.parse(actor);
}
