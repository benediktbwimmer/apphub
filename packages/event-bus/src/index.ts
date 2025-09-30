import type { JobsOptions, Queue, QueueOptions } from 'bullmq';
import {
  EventEnvelope,
  EventEnvelopeInput,
  EventPublisher,
  EventPublisherHandleBase,
  EventPublisherProxyOptions,
  JsonValue,
  eventEnvelopeSchema,
  jsonValueSchema,
  normalizeEventEnvelope,
  normalizeStringValue,
  resolveWorkflowContext,
  resetWorkflowContextResolver,
  validateEventEnvelope
} from './core';
import {
  createEventProxyPublisher,
  type EventProxyPublisherOptions
} from './httpPublisher';

export type EventIngressJobData = {
  envelope?: EventEnvelope;
  eventId?: string;
  retryKind?: 'source' | 'trigger';
};

export type PublishEventOptions = {
  jobName?: string;
  jobOptions?: JobsOptions;
};

type BullQueueLike<T> = {
  add: (name: string, data: T, opts?: JobsOptions) => Promise<unknown>;
  close: () => Promise<void>;
};

type BullQueueCtor<T> = new (name: string, opts?: QueueOptions) => BullQueueLike<T>;

export type EventPublisherHandle = EventPublisherHandleBase<
  BullQueueLike<EventIngressJobData>,
  PublishEventOptions
>;

export type EventPublisherOptions = {
  queue?: Queue<EventIngressJobData>;
  queueName?: string;
  queueOptions?: QueueOptions;
  jobName?: string;
  proxy?: EventPublisherProxyOptions;
  fetchImpl?: typeof fetch;
};

export const DEFAULT_EVENT_QUEUE_NAME = 'apphub_event_ingress_queue';
export const DEFAULT_EVENT_JOB_NAME = 'apphub.event';

export function createEventPublisher(options: EventPublisherOptions = {}): EventPublisherHandle {
  const configuredProxyUrl = normalizeStringValue(options.proxy?.url);
  const envProxyUrl = normalizeStringValue(process.env.APPHUB_EVENT_PROXY_URL);
  const proxyUrl = configuredProxyUrl ?? envProxyUrl;

  if (proxyUrl) {
    return createEventProxyPublisher<PublishEventOptions>({
      proxyUrl,
      proxy: options.proxy,
      fetchImpl: options.fetchImpl
    });
  }

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
    const publish: EventPublisher<PublishEventOptions> = async (event) => {
      if (closed) {
        throw new Error('Event publisher is closed');
      }
      return normalizeEventEnvelope(event);
    };

    const close = async () => {
      closed = true;
    };

    return { publish, close, queue: null } satisfies EventPublisherHandle;
  }

  const BullQueue = loadBullmqQueue<EventIngressJobData>();
  const queue: BullQueueLike<EventIngressJobData> =
    options.queue ?? new BullQueue(queueName, options.queueOptions);
  const jobName = options.jobName ?? DEFAULT_EVENT_JOB_NAME;

  const publish: EventPublisher<PublishEventOptions> = async (event, overrides) => {
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

  return { publish, close, queue } satisfies EventPublisherHandle;
}

function loadBullmqQueue<T>(): BullQueueCtor<T> {
  const req = eval('require') as NodeJS.Require;
  const modulePath = 'bullmq/dist/cjs/classes/queue';
  try {
    const resolved = req(modulePath) as { Queue?: BullQueueCtor<T> };
    if (!resolved?.Queue) {
      throw new Error(`Module did not export Queue from ${modulePath}`);
    }
    return resolved.Queue;
  } catch (error) {
    const hint =
      "BullMQ runtime dependency is missing. Ensure 'bullmq' is installed and packaged with the bundle or switch APPHUB_EVENTS_MODE=inline.";
    const message = error instanceof Error ? `${error.message}. ${hint}` : `Failed to require ${modulePath}. ${hint}`;
    if (error instanceof Error) {
      throw attachErrorCause(new Error(message), error);
    }
    throw new Error(message);
  }
}

function attachErrorCause<T extends Error>(error: T, cause: unknown): T {
  (error as T & { cause?: unknown }).cause = cause;
  return error;
}

export {
  EventProxyPublisherOptions,
  createEventProxyPublisher,
  eventEnvelopeSchema,
  jsonValueSchema,
  normalizeEventEnvelope,
  resolveWorkflowContext,
  resetWorkflowContextResolver,
  validateEventEnvelope
};

export type {
  EventEnvelope,
  EventEnvelopeInput,
  EventPublisher,
  EventPublisherProxyOptions,
  JsonValue
};
