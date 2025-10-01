import type { EventBusCapability } from '@apphub/module-sdk';
import { z } from 'zod';
import { calibrationFileSchema } from './calibrations';

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonRecord = Record<string, JsonValue>;

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

const minuteRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/;

const rawMinuteUploadedPayloadSchema = z
  .object({
    minute: z.string().regex(minuteRegex, 'minute must be formatted as YYYY-MM-DDTHH:mm'),
    observedAt: z.string().datetime({ offset: true }),
    backendMountId: z.number().int().nonnegative(),
    nodeId: z.number().int().nullable(),
    path: z.string().min(1),
    instrumentId: z.string().min(1).nullable(),
    site: z.string().min(1).nullable(),
    metadata: z.record(jsonValueSchema).default({}),
    principal: z.string().min(1).nullable(),
    sizeBytes: z.number().int().nullable(),
    checksum: z.string().min(1).nullable()
  })
  .strip();

const minutePartitionReadyPayloadSchema = z
  .object({
    minute: z.string().regex(minuteRegex, 'minute must be formatted as YYYY-MM-DDTHH:mm'),
    instrumentId: z.string().min(1),
    partitionKey: z.string().min(1),
    partitionKeyFields: z
      .record(z.string())
      .refine((value) => Object.keys(value).length > 0, 'partitionKeyFields must not be empty'),
    datasetSlug: z.string().min(1),
    datasetId: z.string().min(1).nullable(),
    manifestId: z.string().min(1).nullable(),
    storageTargetId: z.string().min(1).nullable(),
    rowsIngested: z.number().int().nonnegative(),
    ingestedAt: z.string().datetime({ offset: true }),
    ingestionMode: z.string().min(1),
    calibrationId: z.string().min(1).nullable().optional(),
    calibrationEffectiveAt: z.string().datetime({ offset: true }).nullable().optional(),
    calibrationMetastoreVersion: z.number().int().nullable().optional()
  })
  .strip();

const dashboardUpdatedPayloadSchema = z
  .object({
    generatedAt: z.string().datetime({ offset: true }),
    partitionKey: z.string().min(1),
    lookbackMinutes: z.number().int().positive(),
    overviewPrefix: z.string().min(1),
    dashboard: z
      .object({
        path: z.string().min(1),
        nodeId: z.number().int().nullable(),
        mediaType: z.string().min(1),
        sizeBytes: z.number().int().nullable(),
        checksum: z.string().min(1).nullable()
      })
      .strip(),
    data: z
      .object({
        path: z.string().min(1),
        nodeId: z.number().int().nullable(),
        mediaType: z.string().min(1),
        sizeBytes: z.number().int().nullable(),
        checksum: z.string().min(1).nullable()
      })
      .strip(),
    metrics: z.object({
      samples: z.number().int().nonnegative(),
      instrumentCount: z.number().int().nonnegative(),
      siteCount: z.number().int().nonnegative(),
      averageTemperatureC: z.number(),
      averagePm25: z.number(),
      maxPm25: z.number()
    }),
    window: z.object({
      start: z.string().datetime({ offset: true }),
      end: z.string().datetime({ offset: true })
    })
  })
  .strip();

const calibrationUpdatedPayloadSchema = calibrationFileSchema
  .extend({
    calibrationId: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    sourcePath: z.string().min(1),
    metastoreVersion: z.number().int().nonnegative().optional()
  })
  .strip();

const observatoryEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('observatory.minute.raw-uploaded'),
    payload: rawMinuteUploadedPayloadSchema
  }),
  z.object({
    type: z.literal('observatory.minute.partition-ready'),
    payload: minutePartitionReadyPayloadSchema
  }),
  z.object({
    type: z.literal('observatory.dashboard.updated'),
    payload: dashboardUpdatedPayloadSchema
  }),
  z.object({
    type: z.literal('observatory.calibration.updated'),
    payload: calibrationUpdatedPayloadSchema
  })
]);

export type ObservatoryEvent = z.infer<typeof observatoryEventSchema>;
export type ObservatoryEventType = ObservatoryEvent['type'];
export type ObservatoryEventPayload<TType extends ObservatoryEventType> = Extract<
  ObservatoryEvent,
  { type: TType }
>['payload'];

export type PublishableObservatoryEvent<TType extends ObservatoryEventType = ObservatoryEventType> = {
  type: TType;
  payload: ObservatoryEventPayload<TType>;
  occurredAt?: string | Date;
  metadata?: JsonRecord;
  correlationId?: string;
  ttl?: number;
  id?: string;
};

function toJsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value as JsonValue;
  }
  if (Array.isArray(value)) {
    const next: JsonValue[] = [];
    for (const entry of value) {
      const candidate = toJsonValue(entry);
      if (candidate !== undefined) {
        next.push(candidate);
      }
    }
    return next;
  }
  if (value && typeof value === 'object') {
    const record = toJsonRecord(value as Record<string, unknown>);
    return record;
  }
  return undefined;
}

export function toJsonRecord(value: Record<string, unknown>): JsonRecord {
  const result: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!key || typeof key !== 'string') {
      continue;
    }
    const candidate = toJsonValue(entry);
    if (candidate !== undefined) {
      result[key] = candidate;
    }
  }
  return result;
}

export function validateObservatoryEvent<TType extends ObservatoryEventType>(
  event: PublishableObservatoryEvent<TType>
): PublishableObservatoryEvent<TType> {
  observatoryEventSchema.parse({ type: event.type, payload: event.payload });
  return event;
}

export function isObservatoryEvent(value: unknown): value is ObservatoryEvent {
  const parsed = observatoryEventSchema.safeParse(value);
  return parsed.success;
}

export type ObservatoryEventPublisherOptions = {
  capability: EventBusCapability | undefined;
  source?: string;
};

export function createObservatoryEventPublisher(
  options: ObservatoryEventPublisherOptions
): {
  publish: <TType extends ObservatoryEventType>(event: PublishableObservatoryEvent<TType>) => Promise<void>;
  close: () => Promise<void>;
} {
  const eventCapability = options.capability;
  if (!eventCapability) {
    throw new Error('Event bus capability is not configured for the observatory module');
  }
  const resolvedCapability: EventBusCapability = eventCapability;

  const candidateSource = options.source?.trim() ?? '';
  const source = candidateSource.length > 0 ? candidateSource : undefined;

  async function publish<TType extends ObservatoryEventType>(
    event: PublishableObservatoryEvent<TType>
  ): Promise<void> {
    const validated = validateObservatoryEvent(event);
    await resolvedCapability.publish({
      id: validated.id,
      occurredAt: validated.occurredAt,
      correlationId: validated.correlationId,
      ttlSeconds: validated.ttl,
      type: validated.type,
      payload: validated.payload,
      metadata: validated.metadata,
      source
    });
  }

  async function close(): Promise<void> {
    await resolvedCapability.close();
  }

  return {
    publish,
    close
  };
}
