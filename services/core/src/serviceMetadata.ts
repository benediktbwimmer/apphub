import { z } from 'zod';
import { manifestEnvVarSchema } from './serviceManifestTypes';
import { jsonValueSchema } from './workflows/zodSchemas';
import type { JsonValue } from './db/types';

const isoTimestampSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) {
      return false;
    }
    return !Number.isNaN(Date.parse(value));
  }, 'must be an ISO 8601 timestamp');

const previewUrlSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!value) {
      return false;
    }
    if (value.startsWith('/')) {
      return true;
    }
    try {
      // eslint-disable-next-line no-new
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }, 'must be an absolute URL or absolute path');

export const serviceManifestMetadataSchema = z
  .object({
    source: z.string().trim().min(1).nullable().optional(),
    sources: z.array(z.string().trim().min(1)).min(1).optional(),
    baseUrlSource: z.enum(['manifest', 'runtime', 'config']).nullable().optional(),
    openapiPath: z.string().trim().min(1).nullable().optional(),
    healthEndpoint: z.string().trim().min(1).nullable().optional(),
    workingDir: z.string().trim().min(1).nullable().optional(),
    devCommand: z.string().trim().min(1).nullable().optional(),
    env: z.array(manifestEnvVarSchema).nullable().optional(),
    apps: z.array(z.string().trim().min(1)).optional(),
    appliedAt: isoTimestampSchema.optional()
  })
  .strict();

const serviceHealthMetadataSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    status: z.enum(['healthy', 'degraded', 'unreachable']).optional(),
    checkedAt: isoTimestampSchema.optional(),
    latencyMs: z.number().finite().nonnegative().nullable().optional(),
    statusCode: z.number().int().nullable().optional(),
    error: z.string().trim().nullable().optional()
  })
  .strict();

const serviceOpenApiMetadataSchema = z
  .object({
    hash: z.string().trim().min(1).optional(),
    version: z.string().trim().min(1).nullable().optional(),
    fetchedAt: isoTimestampSchema.optional(),
    bytes: z.number().int().min(0).optional(),
    url: z.string().trim().min(1).optional(),
    schema: jsonValueSchema.optional()
  })
  .strict();

export const serviceRuntimeMetadataSchema = z
  .object({
    repositoryId: z.string().trim().min(1).optional(),
    launchId: z.string().trim().min(1).nullable().optional(),
    instanceUrl: z.string().trim().url().nullable().optional(),
    baseUrl: z.string().trim().url().nullable().optional(),
    previewUrl: previewUrlSchema.nullable().optional(),
    host: z.string().trim().nullable().optional(),
    port: z.number().int().min(0).max(65_535).nullable().optional(),
    containerIp: z.string().trim().nullable().optional(),
    containerPort: z.number().int().min(0).max(65_535).nullable().optional(),
    containerBaseUrl: z.string().trim().url().nullable().optional(),
    source: z.string().trim().min(1).optional(),
    status: z.enum(['running', 'stopped']).optional(),
    updatedAt: isoTimestampSchema.optional()
  })
  .strict();

const linkedAppsSchema = z.array(z.string().trim().min(1)).min(1);

const serviceMetadataShape = z
  .object({
    resourceType: z.literal('service').default('service'),
    manifest: z.union([serviceManifestMetadataSchema, z.null()]).optional(),
    config: z.union([z.unknown(), z.null()]).optional(),
    runtime: z.union([serviceRuntimeMetadataSchema, z.null()]).optional(),
    health: z.union([serviceHealthMetadataSchema, z.null()]).optional(),
    openapi: z.union([serviceOpenApiMetadataSchema, z.null()]).optional(),
    linkedApps: z.union([linkedAppsSchema, z.null()]).optional(),
    notes: z.union([z.string().trim().max(2000), z.null()]).optional()
  })
  .strict();

export type ServiceManifestMetadata = z.infer<typeof serviceManifestMetadataSchema>;
export type ServiceRuntimeMetadata = z.infer<typeof serviceRuntimeMetadataSchema>;
export type ServiceMetadata = z.infer<typeof serviceMetadataShape>;

export const serviceMetadataUpdateSchema = z
  .union([
    serviceMetadataShape,
    serviceRuntimeMetadataSchema.transform((runtime) => ({
      resourceType: 'service',
      runtime
    } satisfies ServiceMetadata)),
    z.null()
  ])
  .optional()
  .transform((value) => {
    if (value === undefined || value === null) {
      return value;
    }
    return { ...value, resourceType: 'service' as const } satisfies ServiceMetadata;
  });

export type ServiceMetadataUpdate = z.infer<typeof serviceMetadataUpdateSchema>;

function toServiceMetadata(value: JsonValue | null | undefined): ServiceMetadata | null {
  if (!value) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const parsed = serviceMetadataShape.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  const runtimeOnly = serviceRuntimeMetadataSchema.safeParse(value);
  if (runtimeOnly.success) {
    return {
      resourceType: 'service',
      runtime: runtimeOnly.data
    } satisfies ServiceMetadata;
  }
  return null;
}

function ensureResourceType(metadata: ServiceMetadata | null | undefined): ServiceMetadata {
  if (!metadata) {
    return { resourceType: 'service' };
  }
  if (metadata.resourceType === 'service') {
    return { ...metadata };
  }
  return { ...metadata, resourceType: 'service' };
}

function normalizeJson(value: ServiceMetadata): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}

export function mergeServiceMetadata(
  existing: JsonValue | null | undefined,
  incoming: ServiceMetadataUpdate
): JsonValue | null {
  const base = ensureResourceType(toServiceMetadata(existing));

  if (incoming === undefined) {
    if (!existing) {
      return null;
    }
    return normalizeJson(base);
  }

  const parsedIncoming = serviceMetadataUpdateSchema.parse(incoming);

  if (parsedIncoming === null) {
    return null;
  }

  const update = ensureResourceType(parsedIncoming);
  const next: ServiceMetadata = { ...base, resourceType: 'service' };

  if (Object.prototype.hasOwnProperty.call(update, 'manifest')) {
    const manifest = update.manifest;
    if (manifest === null) {
      delete next.manifest;
    } else if (manifest !== undefined) {
      next.manifest = manifest;
    }
  }

  if (Object.prototype.hasOwnProperty.call(update, 'config')) {
    next.config = update.config ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(update, 'runtime')) {
    const runtime = update.runtime;
    if (runtime === null) {
      delete next.runtime;
    } else if (runtime !== undefined) {
      next.runtime = runtime;
    }
  }

  if (Object.prototype.hasOwnProperty.call(update, 'linkedApps')) {
    const linkedApps = update.linkedApps;
    if (linkedApps === null) {
      delete next.linkedApps;
    } else if (linkedApps !== undefined) {
      next.linkedApps = linkedApps;
    }
  }

  if (Object.prototype.hasOwnProperty.call(update, 'notes')) {
    const notes = update.notes;
    if (!notes || notes.trim().length === 0) {
      delete next.notes;
    } else {
      next.notes = notes;
    }
  }

  return normalizeJson(next);
}

export function coerceServiceMetadata(value: JsonValue | null | undefined): ServiceMetadata | null {
  return toServiceMetadata(value);
}
