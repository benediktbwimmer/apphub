import { Queue, type JobsOptions, type QueueOptions } from 'bullmq';
import { z } from 'zod';
export type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
declare const jsonValueSchema: z.ZodType<JsonValue>;
export declare const eventEnvelopeSchema: z.ZodObject<{
    id: z.ZodString;
    type: z.ZodString;
    source: z.ZodString;
    occurredAt: z.ZodEffects<z.ZodString, string, string>;
    payload: z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>;
    correlationId: z.ZodOptional<z.ZodString>;
    ttl: z.ZodOptional<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodType<JsonValue, z.ZodTypeDef, JsonValue>>>;
    schemaVersion: z.ZodOptional<z.ZodNumber>;
    schemaHash: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    id: string;
    type: string;
    source: string;
    occurredAt: string;
    payload: JsonValue;
    correlationId?: string | undefined;
    ttl?: number | undefined;
    metadata?: Record<string, JsonValue> | undefined;
    schemaVersion?: number | undefined;
    schemaHash?: string | undefined;
}, {
    id: string;
    type: string;
    source: string;
    occurredAt: string;
    payload: JsonValue;
    correlationId?: string | undefined;
    ttl?: number | undefined;
    metadata?: Record<string, JsonValue> | undefined;
    schemaVersion?: number | undefined;
    schemaHash?: string | undefined;
}>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type EventEnvelopeInput = Omit<EventEnvelope, 'id' | 'occurredAt'> & {
    id?: string;
    occurredAt?: string | Date;
    payload?: JsonValue;
    schemaVersion?: number | null;
    schemaHash?: string | null;
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
export type EventPublisher = (event: EventEnvelopeInput, options?: PublishEventOptions) => Promise<EventEnvelope>;
export type EventPublisherHandle = {
    publish: EventPublisher;
    close: () => Promise<void>;
    queue: Queue<EventIngressJobData>;
};
export type EventPublisherOptions = {
    queue?: Queue<EventIngressJobData>;
    queueName?: string;
    queueOptions?: QueueOptions;
    jobName?: string;
};
export declare const DEFAULT_EVENT_QUEUE_NAME = "apphub_event_ingress_queue";
export declare const DEFAULT_EVENT_JOB_NAME = "apphub.event";
export declare function normalizeEventEnvelope(input: EventEnvelopeInput): EventEnvelope;
export declare function validateEventEnvelope(envelope: unknown): EventEnvelope;
export declare function createEventPublisher(options?: EventPublisherOptions): EventPublisherHandle;
export { jsonValueSchema };
//# sourceMappingURL=index.d.ts.map
