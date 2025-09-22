import { promises as fs } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  getServiceBySlug,
  listServices,
  setServiceStatus,
  upsertService,
  type JsonValue,
  type ServiceRecord,
  type ServiceStatusUpdate,
  type ServiceUpsertInput
} from '../db/index';
import {
  appendServiceConfigImport,
  previewServiceConfigImport,
  resolveServiceConfigPaths,
  DEFAULT_SERVICE_CONFIG_PATH,
  DuplicateModuleImportError
} from '../serviceConfigLoader';
import { serializeService } from './shared/serializers';
import { jsonValueSchema } from '../workflows/zodSchemas';

const SERVICE_REGISTRY_TOKEN = process.env.SERVICE_REGISTRY_TOKEN ?? '';

function extractBearerToken(header: unknown): string | null {
  if (typeof header !== 'string') {
    return null;
  }
  const match = header.trim().match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return null;
  }
  return match[1]?.trim() ?? null;
}

function ensureServiceRegistryAuthorized(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!SERVICE_REGISTRY_TOKEN) {
    reply.status(503);
    return false;
  }
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    reply.status(401);
    return false;
  }
  if (token !== SERVICE_REGISTRY_TOKEN) {
    reply.status(403);
    return false;
  }
  return true;
}

function toMetadataObject(value: JsonValue | null): Record<string, JsonValue> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, JsonValue>) };
  }
  return {};
}

function mergeRuntimeMetadata(existing: JsonValue | null, incoming: JsonValue | null | undefined): JsonValue | null {
  const base = toMetadataObject(existing);
  if (incoming !== undefined) {
    base.runtime = incoming;
  }
  return Object.keys(base).length > 0 ? (base as JsonValue) : null;
}

const serviceStatusSchema = z.enum(['unknown', 'healthy', 'degraded', 'unreachable']);

const serviceRegistrationSchema = z
  .object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.string().min(1),
    baseUrl: z.string().min(1).url(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: jsonValueSchema.optional(),
    metadata: jsonValueSchema.optional()
  })
  .strict();

const servicePatchSchema = z
  .object({
    baseUrl: z.string().min(1).url().optional(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: jsonValueSchema.optional(),
    metadata: jsonValueSchema.optional(),
    lastHealthyAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO timestamp')
      .nullable()
      .optional()
  })
  .strict();

const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'commit must be a git SHA');

const serviceConfigImportSchema = z
  .object({
    repo: z.string().min(1),
    ref: z.string().min(1).optional(),
    commit: gitShaSchema.optional(),
    configPath: z.string().min(1).optional(),
    module: z.string().min(1).optional()
  })
  .strict();

export type ServiceRoutesOptions = {
  registry: {
    refreshManifest: () => Promise<unknown>;
  };
};

async function resolveServiceConfigTargetPath(): Promise<string> {
  const configPaths = resolveServiceConfigPaths();
  for (const candidate of configPaths) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  const fallback = configPaths[0] ?? DEFAULT_SERVICE_CONFIG_PATH;
  try {
    await fs.access(fallback);
  } catch (err) {
    const message = (err as Error).message;
    const error = new Error(`service config not found at ${fallback}: ${message}`);
    throw error;
  }
  return fallback;
}

export async function registerServiceRoutes(app: FastifyInstance, options: ServiceRoutesOptions): Promise<void> {
  const { registry } = options;

  app.get('/services', async () => {
    const services = await listServices();
    const healthyCount = services.filter((service) => service.status === 'healthy').length;
    const unhealthyCount = services.length - healthyCount;
    return {
      data: services.map((service) => serializeService(service)),
      meta: {
        total: services.length,
        healthyCount,
        unhealthyCount
      }
    };
  });

  app.post('/services', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const parseBody = serviceRegistrationSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const existing = await getServiceBySlug(payload.slug);
    const mergedMetadata = mergeRuntimeMetadata(existing?.metadata ?? null, payload.metadata);

    const upsertPayload: ServiceUpsertInput = {
      slug: payload.slug,
      displayName: payload.displayName,
      kind: payload.kind,
      baseUrl: payload.baseUrl,
      metadata: mergedMetadata
    };

    if (payload.status !== undefined) {
      upsertPayload.status = payload.status;
    }
    if (payload.statusMessage !== undefined) {
      upsertPayload.statusMessage = payload.statusMessage;
    }
    if (payload.capabilities !== undefined) {
      upsertPayload.capabilities = payload.capabilities as JsonValue;
    }

    const record = await upsertService(upsertPayload);
    if (!existing) {
      reply.status(201);
    }
    return { data: serializeService(record) };
  });

  app.post('/service-config/import', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const parseBody = serviceConfigImportSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const repo = payload.repo.trim();
    const ref = payload.ref?.trim() || undefined;
    const commit = payload.commit?.trim() || undefined;
    const configPath = payload.configPath?.trim() || undefined;
    const moduleHint = payload.module?.trim() || undefined;

    let preview;
    try {
      preview = await previewServiceConfigImport({ repo, ref, commit, configPath, module: moduleHint });
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    if (preview.errors.length > 0) {
      reply.status(400);
      return {
        error: preview.errors.map((entry) => ({ source: entry.source, message: entry.error.message }))
      };
    }

    let targetConfigPath: string;
    try {
      targetConfigPath = await resolveServiceConfigTargetPath();
    } catch (err) {
      reply.status(500);
      return { error: (err as Error).message };
    }

    try {
      await appendServiceConfigImport(targetConfigPath, {
        module: preview.moduleId,
        repo,
        ref,
        commit,
        configPath,
        resolvedCommit: preview.resolvedCommit
      });
    } catch (err) {
      if (err instanceof DuplicateModuleImportError) {
        reply.status(409);
        return { error: err.message };
      }
      reply.status(500);
      return { error: (err as Error).message };
    }

    await registry.refreshManifest();

    reply.status(201);
    return {
      data: {
        module: preview.moduleId,
        resolvedCommit: preview.resolvedCommit ?? commit ?? null,
        servicesDiscovered: preview.entries.length,
        configPath: targetConfigPath
      }
    };
  });

  app.post('/service-networks/import', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const parseBody = serviceConfigImportSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const repo = payload.repo.trim();
    const ref = payload.ref?.trim() || undefined;
    const commit = payload.commit?.trim() || undefined;
    const configPath = payload.configPath?.trim() || undefined;
    const moduleHint = payload.module?.trim() || undefined;

    let preview;
    try {
      preview = await previewServiceConfigImport({ repo, ref, commit, configPath, module: moduleHint });
    } catch (err) {
      reply.status(400);
      return { error: (err as Error).message };
    }

    if (preview.errors.length > 0) {
      reply.status(400);
      return {
        error: preview.errors.map((entry) => ({ source: entry.source, message: entry.error.message }))
      };
    }

    let targetConfigPath: string;
    try {
      targetConfigPath = await resolveServiceConfigTargetPath();
    } catch (err) {
      reply.status(500);
      return { error: (err as Error).message };
    }

    try {
      await appendServiceConfigImport(targetConfigPath, {
        module: preview.moduleId,
        repo,
        ref,
        commit,
        configPath,
        resolvedCommit: preview.resolvedCommit
      });
    } catch (err) {
      if (err instanceof DuplicateModuleImportError) {
        reply.status(409);
        return { error: err.message };
      }
      reply.status(500);
      return { error: (err as Error).message };
    }

    await registry.refreshManifest();

    reply.status(201);
    return {
      data: {
        module: preview.moduleId,
        resolvedCommit: preview.resolvedCommit ?? commit ?? null,
        servicesDiscovered: preview.entries.length,
        networksDiscovered: preview.networks.length,
        configPath: targetConfigPath
      }
    };
  });

  app.patch('/services/:slug', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }

    const paramsSchema = z.object({ slug: z.string().min(1) });
    const parseParams = paramsSchema.safeParse(request.params);
    if (!parseParams.success) {
      reply.status(400);
      return { error: parseParams.error.flatten() };
    }

    const slug = parseParams.data.slug;
    const existing = await getServiceBySlug(slug);
    if (!existing) {
      reply.status(404);
      return { error: 'service not found' };
    }

    const parseBody = servicePatchSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    let metadataUpdate: JsonValue | null | undefined;
    if (Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
      metadataUpdate = mergeRuntimeMetadata(existing.metadata, payload.metadata ?? null);
    }

    const update: ServiceStatusUpdate = {};
    if (payload.baseUrl) {
      update.baseUrl = payload.baseUrl;
    }
    if (payload.status !== undefined) {
      update.status = payload.status;
    }
    if (payload.statusMessage !== undefined) {
      update.statusMessage = payload.statusMessage;
    }
    if (payload.capabilities !== undefined) {
      update.capabilities = payload.capabilities as JsonValue;
    }
    if (metadataUpdate !== undefined) {
      update.metadata = metadataUpdate;
    }
    if (payload.lastHealthyAt !== undefined) {
      update.lastHealthyAt = payload.lastHealthyAt;
    }

    const updated = await setServiceStatus(slug, update);
    if (!updated) {
      reply.status(500);
      return { error: 'failed to update service' };
    }

    return { data: serializeService(updated) };
  });
}
