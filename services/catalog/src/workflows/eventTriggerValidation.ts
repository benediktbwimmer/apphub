import { z } from 'zod';
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
    operator: z.enum(['exists', 'equals', 'notEquals', 'in', 'notIn']),
    value: jsonValueSchema.optional(),
    values: z.array(jsonValueSchema).max(100, 'predicate.values must include at most 100 entries').optional(),
    caseSensitive: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (value.operator === 'exists') {
      if (value.value !== undefined || value.values !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value and predicate.values must be omitted when operator is exists'
        });
      }
    } else if (value.operator === 'equals' || value.operator === 'notEquals') {
      if (value.value === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.value is required for equals/notEquals operators'
        });
      }
    } else if (value.operator === 'in' || value.operator === 'notIn') {
      if (!value.values || value.values.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'predicate.values must include at least one entry for in/notIn operators'
        });
      }
    }
  })
  .transform((value): WorkflowEventTriggerPredicate => {
    const path = value.path.trim();
    const caseSensitive = value.caseSensitive === undefined ? undefined : value.caseSensitive;
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

export function normalizeOptionalActor(actor?: string | null): string | null {
  return optionalActorSchema.parse(actor);
}
