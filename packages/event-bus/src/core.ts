import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const WORKFLOW_METADATA_KEY = '__apphubWorkflow' as const;
const WORKFLOW_EVENT_CONTEXT_ENV = 'APPHUB_WORKFLOW_EVENT_CONTEXT';
const WORKFLOW_METADATA_MAX_BYTES = 2048;

const WORKFLOW_METADATA_REQUIRED_FIELDS = [
  'workflowDefinitionId',
  'workflowRunId',
  'workflowRunStepId',
  'jobRunId',
  'jobSlug'
] as const;

const WORKFLOW_METADATA_OPTIONAL_FIELDS = ['workflowRunKey'] as const;

const WORKFLOW_METADATA_FIELDS = [
  ...WORKFLOW_METADATA_REQUIRED_FIELDS,
  ...WORKFLOW_METADATA_OPTIONAL_FIELDS
] as const;

type WorkflowMetadataField = (typeof WORKFLOW_METADATA_FIELDS)[number];

export type WorkflowMetadata = {
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowRunStepId: string;
  jobRunId: string;
  jobSlug: string;
  workflowRunKey?: string;
};

type WorkflowRuntimeModule = {
  getWorkflowEventContext?: () => unknown;
  default?: {
    getWorkflowEventContext?: () => unknown;
  };
};

function resolveWorkflowContextReader(): (() => unknown) | null {
  const candidates = [
    '@apphub/core/workflowEventContext',
    '@apphub/core/dist/workflowEventContext.js',
    '@apphub/core/dist/workflowEventContext',
    '@apphub/core/src/workflowEventContext.ts',
    '@apphub/core/src/workflowEventContext',
    '@apphub/core/dist/jobs/runtime.js',
    '@apphub/core/dist/jobs/runtime',
    '@apphub/core/jobs/runtime',
    '@apphub/core/src/jobs/runtime.ts',
    '@apphub/core/src/jobs/runtime'
  ];

  for (const specifier of candidates) {
    try {
      const runtimeModule = require(specifier) as WorkflowRuntimeModule;
      const candidate = runtimeModule.getWorkflowEventContext
        ?? runtimeModule.default?.getWorkflowEventContext;
      if (typeof candidate === 'function') {
        return candidate.bind(runtimeModule);
      }
    } catch {
      // Ignore missing modules - fall back to the next candidate.
    }
  }
  return null;
}

let readWorkflowEventContext: (() => unknown) | null = resolveWorkflowContextReader();

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema)
  ])
);

const workflowMetadataSchema = z
  .object({
    workflowDefinitionId: z.string().min(1),
    workflowRunId: z.string().min(1),
    workflowRunStepId: z.string().min(1),
    jobRunId: z.string().min(1),
    jobSlug: z.string().min(1),
    workflowRunKey: z.string().min(1).optional()
  })
  .strict();

const metadataSchema = z
  .object({
    [WORKFLOW_METADATA_KEY]: workflowMetadataSchema.optional()
  })
  .catchall(jsonValueSchema);

export const eventEnvelopeSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string().min(1, 'type is required'),
    source: z.string().min(1, 'source is required'),
    occurredAt: z
      .string()
      .min(1, 'occurredAt is required')
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'occurredAt must be an ISO-8601 timestamp'
      }),
    payload: jsonValueSchema,
    correlationId: z.string().min(1).optional(),
    ttl: z.number().int().positive().optional(),
    metadata: metadataSchema.optional()
  })
  .strict();

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export type EventEnvelopeInput = Omit<EventEnvelope, 'id' | 'occurredAt'> & {
  id?: string;
  occurredAt?: string | Date;
  payload?: JsonValue;
};

export type EventPublisher<TOptions = unknown> = (
  event: EventEnvelopeInput,
  options?: TOptions
) => Promise<EventEnvelope>;

export type EventPublisherHandleBase<TQueue, TOptions = unknown> = {
  publish: EventPublisher<TOptions>;
  close: () => Promise<void>;
  queue: TQueue | null;
};

export type EventPublisherProxyOptions = {
  url?: string;
  token?: string | (() => string | Promise<string>);
  headers?: Record<string, string>;
};

export function normalizeEventEnvelope(input: EventEnvelopeInput): EventEnvelope {
  const workflowContext = resolveWorkflowContext();
  const metadata = mergeWorkflowMetadata(input.metadata, workflowContext);
  const occurredAtValue = input.occurredAt instanceof Date
    ? input.occurredAt.toISOString()
    : input.occurredAt ?? new Date().toISOString();

  const candidate: Record<string, unknown> = {
    ...input,
    id: input.id ?? randomUUID(),
    occurredAt: occurredAtValue,
    payload: input.payload ?? {}
  };

  if (metadata === undefined) {
    delete candidate.metadata;
  } else {
    candidate.metadata = metadata;
  }

  const result = eventEnvelopeSchema.safeParse(candidate);
  if (!result.success) {
    throw new Error(result.error.errors.map((issue) => issue.message).join('; '));
  }
  return result.data;
}

export function validateEventEnvelope(envelope: unknown): EventEnvelope {
  return eventEnvelopeSchema.parse(envelope);
}

export function resolveWorkflowContext(): WorkflowMetadata | null {
  const runtimeValue = readWorkflowEventContext ? readWorkflowEventContext() : null;
  const runtimeMetadata = normalizeWorkflowContextCandidate(runtimeValue);
  if (runtimeMetadata) {
    return runtimeMetadata;
  }

  const serialized = process.env[WORKFLOW_EVENT_CONTEXT_ENV];
  if (!serialized) {
    return null;
  }

  try {
    const parsed = JSON.parse(serialized) as unknown;
    return normalizeWorkflowContextCandidate(parsed);
  } catch {
    return null;
  }
}

function mergeWorkflowMetadata(
  existing: EventEnvelopeInput['metadata'],
  workflowMetadata: WorkflowMetadata | null
): EventEnvelopeInput['metadata'] {
  let nextMetadata = existing ? { ...existing } : undefined;
  if (!workflowMetadata) {
    return nextMetadata;
  }
  if (hasWorkflowMetadata(nextMetadata)) {
    return nextMetadata;
  }

  if (!nextMetadata) {
    nextMetadata = {};
  }
  nextMetadata[WORKFLOW_METADATA_KEY] = workflowMetadata;
  return nextMetadata;
}

function hasWorkflowMetadata(metadata: EventEnvelopeInput['metadata']): boolean {
  if (!metadata) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(metadata, WORKFLOW_METADATA_KEY);
}

function normalizeWorkflowContextCandidate(raw: unknown): WorkflowMetadata | null {
  const sanitized = sanitizeWorkflowContext(raw);
  if (!sanitized) {
    return null;
  }
  const serialized = JSON.stringify(sanitized);
  if (Buffer.byteLength(serialized, 'utf8') > WORKFLOW_METADATA_MAX_BYTES) {
    return null;
  }
  return sanitized;
}

function sanitizeWorkflowContext(raw: unknown): WorkflowMetadata | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const sanitized: Partial<WorkflowMetadata> = {};

  for (const field of WORKFLOW_METADATA_REQUIRED_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    sanitized[field] = trimmed;
  }

  for (const field of WORKFLOW_METADATA_OPTIONAL_FIELDS) {
    const value = record[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (trimmed) {
      sanitized[field] = trimmed;
    }
  }

  return sanitized as WorkflowMetadata;
}

export function normalizeStringValue(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function resolveProxyToken(
  candidate: EventPublisherProxyOptions['token'],
  fallbackEnvToken: string | undefined
): Promise<string | null> {
  if (typeof candidate === 'function') {
    const resolved = await candidate();
    const normalized = normalizeStringValue(resolved);
    if (normalized) {
      return normalized;
    }
  } else {
    const normalized = normalizeStringValue(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return normalizeStringValue(fallbackEnvToken);
}

export function headerHasName(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

export function resetWorkflowContextResolver(): void {
  readWorkflowEventContext = resolveWorkflowContextReader();
}
