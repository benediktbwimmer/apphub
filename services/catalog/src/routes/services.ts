import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
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
  DuplicateModuleImportError
} from '../serviceConfigLoader';
import { serializeService } from './shared/serializers';
import { jsonValueSchema } from '../workflows/zodSchemas';
import { mergeServiceMetadata, serviceMetadataUpdateSchema } from '../serviceMetadata';

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
    return true;
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

function normalizeVariables(input?: Record<string, string> | null): Record<string, string> | undefined {
  if (!input) {
    return undefined;
  }
  const entries = Object.entries(input)
    .map(([key, value]) => [key.trim(), value] as const)
    .filter(([key]) => key.length > 0);
  if (entries.length === 0) {
    return undefined;
  }
  const normalized: Record<string, string> = {};
  for (const [key, value] of entries) {
    normalized[key] = value;
  }
  return normalized;
}

const serviceStatusSchema = z.enum(['unknown', 'healthy', 'degraded', 'unreachable']);

export const serviceRegistrationSchema = z
  .object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.string().min(1),
    baseUrl: z.string().min(1).url(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: jsonValueSchema.optional(),
    metadata: serviceMetadataUpdateSchema
  })
  .strict();

export const servicePatchSchema = z
  .object({
    baseUrl: z.string().min(1).url().optional(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: jsonValueSchema.optional(),
    metadata: serviceMetadataUpdateSchema,
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
    repo: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    ref: z.string().min(1).optional(),
    commit: gitShaSchema.optional(),
    configPath: z.string().min(1).optional(),
    module: z.string().min(1).optional(),
    variables: z.record(z.string().min(1), z.string()).optional(),
    requirePlaceholderValues: z.boolean().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    const hasRepo = typeof value.repo === 'string' && value.repo.trim().length > 0;
    const hasPath = typeof value.path === 'string' && value.path.trim().length > 0;

    if (hasRepo === hasPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of "repo" or "path" when importing service configs.'
      });
    }

    if (!hasRepo) {
      if (value.ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The "ref" field can only be used with git-based imports.'
        });
      }
      if (value.commit) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'The "commit" field can only be used with git-based imports.'
        });
      }
    }
  });

export type ServiceRoutesOptions = {
  registry: {
    refreshManifest: () => Promise<unknown>;
  };
};

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return Boolean(value && typeof value === 'object' && 'code' in value);
}

async function resolveServiceConfigTargetPath(): Promise<string> {
  const configPaths = resolveServiceConfigPaths();
  if (configPaths.length === 0) {
    throw new Error('No service config path configured. Set SERVICE_CONFIG_PATH to a writable location.');
  }

  for (const candidate of configPaths) {
    const directory = path.dirname(candidate);
    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.access(directory, fsConstants.W_OK);
    } catch {
      continue;
    }

    try {
      await fs.access(candidate, fsConstants.W_OK);
      return candidate;
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') {
        return candidate;
      }
    }
  }

  throw new Error(
    `No writable service config path found. Checked paths: ${configPaths.join(', ')}`
  );
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
      request.log.warn(
        { resourceType: 'service', issues: parseBody.error.flatten() },
        'service registration validation failed'
      );
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const existing = await getServiceBySlug(payload.slug);
    const metadataUpdate = mergeServiceMetadata(existing?.metadata ?? null, payload.metadata);

    const upsertPayload: ServiceUpsertInput = {
      slug: payload.slug,
      displayName: payload.displayName,
      kind: payload.kind,
      baseUrl: payload.baseUrl,
      metadata: metadataUpdate
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
    const repo = payload.repo?.trim() || null;
    const localPath = payload.path?.trim() || null;
    const ref = payload.ref?.trim() || undefined;
    const commit = payload.commit?.trim() || undefined;
    const configPath = payload.configPath?.trim() || undefined;
    const moduleHint = payload.module?.trim() || undefined;
    const variables = normalizeVariables(payload.variables ?? undefined);
    const requirePlaceholderValues = Boolean(payload.requirePlaceholderValues);

    let preview;
    try {
      preview = await previewServiceConfigImport({
        repo,
        path: localPath,
        ref,
        commit,
        configPath,
        module: moduleHint,
        variables,
        requirePlaceholderValues
      });
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

    const conflicts = preview.placeholders.filter((placeholder) => placeholder.conflicts.length > 0);
    if (conflicts.length > 0) {
      reply.status(400);
      return {
        error: 'manifest placeholders conflict. Resolve the manifest defaults or supply explicit values.',
        placeholders: preview.placeholders
      };
    }

    const missing = preview.placeholders.filter((placeholder) => placeholder.missing);
    if (missing.length > 0) {
      reply.status(400);
      return {
        error: 'manifest requires placeholder values before import',
        placeholders: preview.placeholders
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
        repo: repo ?? undefined,
        path: localPath ?? undefined,
        ref,
        commit,
        configPath,
        resolvedCommit: preview.resolvedCommit,
        variables
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
    const repo = payload.repo?.trim() || null;
    const localPath = payload.path?.trim() || null;
    const ref = payload.ref?.trim() || undefined;
    const commit = payload.commit?.trim() || undefined;
    const configPath = payload.configPath?.trim() || undefined;
    const moduleHint = payload.module?.trim() || undefined;
    const variables = normalizeVariables(payload.variables ?? undefined);
    const requirePlaceholderValues = Boolean(payload.requirePlaceholderValues);

    let preview;
    try {
      preview = await previewServiceConfigImport({
        repo,
        path: localPath,
        ref,
        commit,
        configPath,
        module: moduleHint,
        variables,
        requirePlaceholderValues
      });
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

    const conflicts = preview.placeholders.filter((placeholder) => placeholder.conflicts.length > 0);
    if (conflicts.length > 0) {
      reply.status(400);
      return {
        error: 'manifest placeholders conflict. Resolve the manifest defaults or supply explicit values.',
        placeholders: preview.placeholders
      };
    }

    const missing = preview.placeholders.filter((placeholder) => placeholder.missing);
    if (missing.length > 0) {
      reply.status(400);
      return {
        error: 'manifest requires placeholder values before import',
        placeholders: preview.placeholders
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
        repo: repo ?? undefined,
        path: localPath ?? undefined,
        ref,
        commit,
        configPath,
        resolvedCommit: preview.resolvedCommit,
        variables
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
      request.log.warn(
        { resourceType: 'service', slug, issues: parseBody.error.flatten() },
        'service update validation failed'
      );
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const hasMetadata = Object.prototype.hasOwnProperty.call(payload, 'metadata');
    const metadataUpdate = hasMetadata
      ? mergeServiceMetadata(existing.metadata, payload.metadata)
      : undefined;

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
    if (hasMetadata) {
      update.metadata = metadataUpdate ?? null;
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
