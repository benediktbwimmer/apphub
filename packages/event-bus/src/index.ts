import { randomUUID } from 'node:crypto';
import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { z } from 'zod';

const WORKFLOW_METADATA_KEY = '__apphubWorkflow' as const;
const WORKFLOW_EVENT_CONTEXT_ENV = 'APPHUB_WORKFLOW_EVENT_CONTEXT';
const WORKFLOW_METADATA_MAX_BYTES = 2048;

const WORKFLOW_METADATA_FIELDS = [
  'workflowDefinitionId',
  'workflowRunId',
  'workflowRunStepId',
  'jobRunId',
  'jobSlug'
] as const;

type WorkflowMetadataField = (typeof WORKFLOW_METADATA_FIELDS)[number];

export type WorkflowMetadata = Record<WorkflowMetadataField, string>;

type WorkflowRuntimeModule = {
  getWorkflowEventContext?: () => unknown;
  default?: {
    getWorkflowEventContext?: () => unknown;
  };
};

function resolveWorkflowContextReader(): (() => unknown) | null {
  const candidates = [
    '@apphub/catalog/workflowEventContext',
    '@apphub/catalog/dist/workflowEventContext.js',
    '@apphub/catalog/dist/workflowEventContext',
    '@apphub/catalog/src/workflowEventContext.ts',
    '@apphub/catalog/src/workflowEventContext',
    '@apphub/catalog/dist/jobs/runtime.js',
    '@apphub/catalog/dist/jobs/runtime',
    '@apphub/catalog/jobs/runtime',
    '@apphub/catalog/src/jobs/runtime.ts',
    '@apphub/catalog/src/jobs/runtime'
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

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
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
    jobSlug: z.string().min(1)
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

export type EventIngressJobData = {
  envelope?: EventEnvelope;
  eventId?: string;
  retryKind?: 'source' | 'trigger';
};

export type PublishEventOptions = {
  jobName?: string;
  jobOptions?: JobsOptions;
};

export type EventPublisher = (
  event: EventEnvelopeInput,
  options?: PublishEventOptions
) => Promise<EventEnvelope>;

export type EventPublisherHandle = {
  publish: EventPublisher;
  close: () => Promise<void>;
  queue: Queue<EventIngressJobData> | null;
};

export type EventPublisherOptions = {
  queue?: Queue<EventIngressJobData>;
  queueName?: string;
  queueOptions?: QueueOptions;
  jobName?: string;
};

export const DEFAULT_EVENT_QUEUE_NAME = 'apphub_event_ingress_queue';
export const DEFAULT_EVENT_JOB_NAME = 'apphub.event';

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

export function createEventPublisher(options: EventPublisherOptions = {}): EventPublisherHandle {
  const queueName =
    options.queueName ?? process.env.APPHUB_EVENT_QUEUE_NAME ?? DEFAULT_EVENT_QUEUE_NAME;
  const isInlineMode = (() => {
    const mode = (process.env.APPHUB_EVENTS_MODE ?? '').trim().toLowerCase();
    if (mode === 'inline') {
      return true;
    }
    if (mode === 'redis') {
      return false;
    }
    const redisUrl = (process.env.REDIS_URL ?? '').trim().toLowerCase();
    return redisUrl === 'inline';
  })();

  let closed = false;

  if (isInlineMode) {
    const publish: EventPublisher = async (event) => {
      if (closed) {
        throw new Error('Event publisher is closed');
      }
      return normalizeEventEnvelope(event);
    };

    const close = async () => {
      closed = true;
    };

    return { publish, close, queue: null };
  }

  const queue =
    options.queue ?? new Queue<EventIngressJobData>(queueName, options.queueOptions);
  const jobName = options.jobName ?? DEFAULT_EVENT_JOB_NAME;

  const publish: EventPublisher = async (event, overrides) => {
    if (closed) {
      throw new Error('Event publisher is closed');
    }
    const envelope = normalizeEventEnvelope(event);
    await queue.add(overrides?.jobName ?? jobName, { envelope }, overrides?.jobOptions);
    return envelope;
  };

  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;
    if (!options.queue) {
      await queue.close();
    }
  };

  return { publish, close, queue };
}

export { jsonValueSchema };

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

  for (const field of WORKFLOW_METADATA_FIELDS) {
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

  return sanitized as WorkflowMetadata;
}
