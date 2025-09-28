import { randomUUID } from 'node:crypto';
import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { z } from 'zod';

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

const metadataSchema = z.record(z.string(), jsonValueSchema);

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
  const occurredAtValue = input.occurredAt instanceof Date
    ? input.occurredAt.toISOString()
    : input.occurredAt ?? new Date().toISOString();

  const candidate = {
    ...input,
    id: input.id ?? randomUUID(),
    occurredAt: occurredAtValue,
    payload: input.payload ?? {}
  } satisfies Record<string, unknown>;

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
