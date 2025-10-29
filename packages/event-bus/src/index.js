"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jsonValueSchema = exports.DEFAULT_EVENT_JOB_NAME = exports.DEFAULT_EVENT_QUEUE_NAME = exports.eventEnvelopeSchema = void 0;
exports.normalizeEventEnvelope = normalizeEventEnvelope;
exports.validateEventEnvelope = validateEventEnvelope;
exports.createEventPublisher = createEventPublisher;
const node_crypto_1 = require("node:crypto");
const bullmq_1 = require("bullmq");
const zod_1 = require("zod");
const jsonValueSchema = zod_1.z.lazy(() => zod_1.z.union([
    zod_1.z.string(),
    zod_1.z.number(),
    zod_1.z.boolean(),
    zod_1.z.null(),
    zod_1.z.array(jsonValueSchema),
    zod_1.z.record(jsonValueSchema)
]));
exports.jsonValueSchema = jsonValueSchema;
const metadataSchema = zod_1.z.record(zod_1.z.string(), jsonValueSchema);
exports.eventEnvelopeSchema = zod_1.z
    .object({
    id: zod_1.z.string().uuid(),
    type: zod_1.z.string().min(1, 'type is required'),
    source: zod_1.z.string().min(1, 'source is required'),
    occurredAt: zod_1.z
        .string()
        .min(1, 'occurredAt is required')
        .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'occurredAt must be an ISO-8601 timestamp'
    }),
    payload: jsonValueSchema,
    correlationId: zod_1.z.string().min(1).optional(),
    ttl: zod_1.z.number().int().positive().optional(),
    metadata: metadataSchema.optional()
})
    .strict();
exports.DEFAULT_EVENT_QUEUE_NAME = 'apphub_event_ingress_queue';
exports.DEFAULT_EVENT_JOB_NAME = 'apphub.event';
function normalizeEventEnvelope(input) {
    const occurredAtValue = input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : input.occurredAt ?? new Date().toISOString();
    const candidate = {
        ...input,
        id: input.id ?? (0, node_crypto_1.randomUUID)(),
        occurredAt: occurredAtValue,
        payload: input.payload ?? {}
    };
    const result = exports.eventEnvelopeSchema.safeParse(candidate);
    if (!result.success) {
        throw new Error(result.error.errors.map((issue) => issue.message).join('; '));
    }
    return result.data;
}
function validateEventEnvelope(envelope) {
    return exports.eventEnvelopeSchema.parse(envelope);
}
function createEventPublisher(options = {}) {
    const queueName = options.queueName ?? process.env.APPHUB_EVENT_QUEUE_NAME ?? exports.DEFAULT_EVENT_QUEUE_NAME;
    const queue = options.queue ?? new bullmq_1.Queue(queueName, options.queueOptions);
    const jobName = options.jobName ?? exports.DEFAULT_EVENT_JOB_NAME;
    let closed = false;
    const publish = async (event, overrides) => {
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
//# sourceMappingURL=index.js.map
