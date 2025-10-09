import { createHash } from 'node:crypto';
import Ajv, { type ValidateFunction } from 'ajv';
import {
  getEventSchema,
  getLatestEventSchema,
  insertEventSchema,
  listEventSchemas as dbListEventSchemas,
  updateEventSchemaStatus,
  getNextEventSchemaVersion
} from '../db/eventSchemas';
import type {
  EventSchemaInsert,
  EventSchemaRecord,
  EventSchemaStatus,
  JsonValue
} from '../db/types';
import {
  type RegisterEventSchemaInput,
  type ResolveEventSchemaOptions,
  type ResolvedEventSchema
} from './types';

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

const DEFAULT_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 30_000;
const SCHEMA_METADATA_KEY = '__apphubSchema';

type CacheEntry = {
  record: EventSchemaRecord;
  validator: ValidateFunction;
  expiresAt: number;
};

type RegistryConfig = {
  cacheTtlMs: number;
  negativeCacheTtlMs: number;
};

let config: RegistryConfig = {
  cacheTtlMs: DEFAULT_CACHE_TTL_MS,
  negativeCacheTtlMs: DEFAULT_NEGATIVE_CACHE_TTL_MS
};

const entryCache = new Map<string, CacheEntry>();
const negativeCache = new Map<string, number>();
const validatorCache = new Map<string, ValidateFunction>();

let readGetEventSchema = getEventSchema;
let readGetLatestEventSchema = getLatestEventSchema;
let readInsertEventSchema = insertEventSchema;
let readListEventSchemas = dbListEventSchemas;
let readUpdateEventSchemaStatus = updateEventSchemaStatus;
let readGetNextEventSchemaVersion = getNextEventSchemaVersion;

export function configureEventSchemaRegistry(overrides: Partial<RegistryConfig>): void {
  config = {
    ...config,
    ...overrides
  } satisfies RegistryConfig;
}

export function clearEventSchemaRegistryCache(eventType?: string): void {
  if (!eventType) {
    entryCache.clear();
    negativeCache.clear();
    return;
  }
  const prefix = `${eventType.toLowerCase()}@`;
  for (const key of entryCache.keys()) {
    if (key.startsWith(prefix)) {
      entryCache.delete(key);
    }
  }
  for (const key of negativeCache.keys()) {
    if (key.startsWith(prefix)) {
      negativeCache.delete(key);
    }
  }
}

function stableStringify(value: JsonValue): string {
  if (value === null) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry as JsonValue)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, JsonValue>)
    .sort(([a], [b]) => a.localeCompare(b));
  const parts = entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);
  return `{${parts.join(',')}}`;
}

function computeSchemaHash(schema: JsonValue): string {
  const canonical = stableStringify(schema);
  return createHash('sha256').update(canonical).digest('hex');
}

function normalizeEventType(eventType: string): string {
  const trimmed = eventType.trim();
  if (trimmed.length === 0) {
    throw new Error('eventType is required');
  }
  return trimmed;
}

function normalizeStatus(value: EventSchemaStatus | undefined): EventSchemaStatus {
  if (value === 'active' || value === 'deprecated' || value === 'draft') {
    return value;
  }
  return 'active';
}

function ensureObjectSchema(schema: JsonValue): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('Schema definition must be a JSON object.');
  }
  return schema as Record<string, unknown>;
}

function compileValidator(schema: JsonValue, key: string): ValidateFunction {
  const cached = validatorCache.get(key);
  if (cached) {
    return cached;
  }
  const compiled = ajv.compile(ensureObjectSchema(schema));
  validatorCache.set(key, compiled);
  return compiled;
}

function cacheKey(eventType: string, versionKey: string): string {
  return `${eventType.toLowerCase()}@${versionKey}`;
}

function wrapValidator(fn: ValidateFunction) {
  return (payload: unknown): { valid: true } | { valid: false; errors: string[] } => {
    const valid = fn(payload);
    if (valid) {
      return { valid: true } as const;
    }
    const errors = (fn.errors ?? []).map((error) =>
      error.instancePath ? `${error.instancePath} ${error.message ?? ''}`.trim() : error.message ?? 'invalid payload'
    );
    return { valid: false, errors } as const;
  };
}

function setCache(eventType: string, versionKey: string, record: EventSchemaRecord, validator: ValidateFunction): void {
  const key = cacheKey(eventType, versionKey);
  entryCache.set(key, {
    record,
    validator,
    expiresAt: Date.now() + Math.max(config.cacheTtlMs, 1_000)
  });
  negativeCache.delete(key);
}

function setNegativeCache(eventType: string, versionKey: string) {
  const key = cacheKey(eventType, versionKey);
  negativeCache.set(key, Date.now() + Math.max(config.negativeCacheTtlMs, 5_000));
  entryCache.delete(key);
}

function getCachedEntry(eventType: string, versionKey: string): CacheEntry | null {
  const key = cacheKey(eventType, versionKey);
  const entry = entryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry;
  }
  if (entry) {
    entryCache.delete(key);
  }
  const negativeExpiry = negativeCache.get(key);
  if (negativeExpiry && negativeExpiry > Date.now()) {
    return null;
  }
  if (negativeExpiry) {
    negativeCache.delete(key);
  }
  return null;
}

export async function registerEventSchemaDefinition(
  input: RegisterEventSchemaInput
): Promise<EventSchemaRecord> {
  const eventType = normalizeEventType(input.eventType);
  const status = normalizeStatus(input.status);
  const metadata = input.metadata ?? null;
  const author = input.author ?? null;

  const schemaHash = computeSchemaHash(input.schema);
  // Validate the schema compiles before touching the database.
  compileValidator(input.schema, `${eventType}#${schemaHash}`);

  let version = input.version;
  if (version === undefined || version === null) {
    version = await readGetNextEventSchemaVersion(eventType);
  }

  const existing = await readGetEventSchema(eventType, version);
  if (existing) {
    if (existing.schemaHash !== schemaHash) {
      throw new Error(
        `Event schema for ${eventType} version ${version} already exists with a different definition.`
      );
    }
    if (existing.status !== status) {
      const updated = await readUpdateEventSchemaStatus(eventType, version, status, author);
      if (updated) {
        clearEventSchemaRegistryCache(eventType);
        return updated;
      }
    }
    return existing;
  }

  const insertPayload: EventSchemaInsert = {
    eventType,
    version,
    status,
    schema: input.schema,
    schemaHash,
    metadata,
    createdBy: author,
    updatedBy: author
  } satisfies EventSchemaInsert;

  const record = await readInsertEventSchema(insertPayload);
  clearEventSchemaRegistryCache(eventType);
  return record;
}

export async function listEventSchemas(options?: {
  eventType?: string;
  status?: EventSchemaStatus | EventSchemaStatus[];
  limit?: number;
  offset?: number;
}): Promise<EventSchemaRecord[]> {
  return readListEventSchemas(options ?? {});
}

export async function resolveEventSchema(
  eventTypeInput: string,
  options: ResolveEventSchemaOptions = {}
): Promise<ResolvedEventSchema | null> {
  const eventType = normalizeEventType(eventTypeInput);
  const versionKey = options.version !== undefined ? String(options.version) : `latest:${(options.statuses ?? ['active']).join(',')}`;
  const cached = getCachedEntry(eventType, versionKey);
  if (cached) {
    return {
      record: cached.record,
      validate: wrapValidator(cached.validator)
    } satisfies ResolvedEventSchema;
  }

  const record = options.version !== undefined
    ? await readGetEventSchema(eventType, options.version)
    : await readGetLatestEventSchema(eventType, options.statuses ?? ['active']);

  if (!record) {
    setNegativeCache(eventType, versionKey);
    return null;
  }

  const validatorKey = `${record.eventType}#${record.schemaHash}`;
  const validator = compileValidator(record.schema, validatorKey);
  setCache(eventType, versionKey, record, validator);

  return {
    record,
    validate: wrapValidator(validator)
  } satisfies ResolvedEventSchema;
}

export function __setEventSchemaRegistryTestOverrides(overrides?: {
  getEventSchema?: typeof getEventSchema;
  getLatestEventSchema?: typeof getLatestEventSchema;
  insertEventSchema?: typeof insertEventSchema;
  listEventSchemas?: typeof dbListEventSchemas;
  updateEventSchemaStatus?: typeof updateEventSchemaStatus;
  getNextEventSchemaVersion?: typeof getNextEventSchemaVersion;
}): void {
  readGetEventSchema = overrides?.getEventSchema ?? getEventSchema;
  readGetLatestEventSchema = overrides?.getLatestEventSchema ?? getLatestEventSchema;
  readInsertEventSchema = overrides?.insertEventSchema ?? insertEventSchema;
  readListEventSchemas = overrides?.listEventSchemas ?? dbListEventSchemas;
  readUpdateEventSchemaStatus = overrides?.updateEventSchemaStatus ?? updateEventSchemaStatus;
  readGetNextEventSchemaVersion = overrides?.getNextEventSchemaVersion ?? getNextEventSchemaVersion;
}

function mergeSchemaMetadata(
  metadata: JsonValue | null | undefined,
  version: number,
  hash: string
): JsonValue {
  let base: Record<string, JsonValue>;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    base = {};
  } else {
    base = { ...(metadata as Record<string, JsonValue>) };
  }
  base[SCHEMA_METADATA_KEY] = { version, hash } satisfies JsonValue;
  return base;
}

export async function annotateEventEnvelopeSchema(input: {
  eventType: string;
  payload: JsonValue;
  schemaVersion?: number | null;
  metadata?: JsonValue | null;
  enforce?: boolean;
}): Promise<{
  schemaVersion: number | null;
  schemaHash: string | null;
  metadata: JsonValue | null;
}> {
  const eventType = normalizeEventType(input.eventType);
  const requestedVersion = input.schemaVersion ?? undefined;
  const resolved = await resolveEventSchema(eventType, requestedVersion !== undefined ? { version: requestedVersion } : {});

  if (!resolved) {
    if (requestedVersion !== undefined) {
      throw new Error(`Schema ${requestedVersion} is not registered for event type ${eventType}`);
    }
    if (input.enforce) {
      throw new Error(`No schema registered for event type ${eventType}${requestedVersion ? ` version ${requestedVersion}` : ''}`);
    }
    return {
      schemaVersion: null,
      schemaHash: null,
      metadata: input.metadata ?? null
    };
  }

  const validation = resolved.validate(input.payload);
  if (!validation.valid) {
    throw new Error(
      `Event payload for ${eventType} failed schema validation: ${validation.errors.join('; ')}`
    );
  }

  const metadata = mergeSchemaMetadata(input.metadata ?? null, resolved.record.version, resolved.record.schemaHash);

  return {
    schemaVersion: resolved.record.version,
    schemaHash: resolved.record.schemaHash,
    metadata
  };
}
