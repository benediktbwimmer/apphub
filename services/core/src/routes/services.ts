import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
import { publishModuleArtifact } from '../db/modules';
import {
  createWorkflowDefinition,
  updateWorkflowDefinition,
  getWorkflowDefinitionBySlug
} from '../db/workflows';
import { fetchFromService } from '../clients/serviceClient';
import {
  previewServiceConfigImport,
  type LoadedManifestEntry,
  type LoadedServiceNetwork,
  type LoadedWorkflowDefinition
} from '../serviceConfigLoader';
import { serializeService } from './shared/serializers';
import { jsonValueSchema } from '../workflows/zodSchemas';
import { mergeServiceMetadata, serviceMetadataUpdateSchema } from '../serviceMetadata';
import { executeBootstrapPlan, registerWorkflowDefaults, getWorkflowDefaultParameters } from '../bootstrap';
import { buildWorkflowDagMetadata, applyDagMetadataToSteps } from '../workflows/dag';
import {
  applyPlaceholderValuesToManifest,
  buildBootstrapContext,
  updatePlaceholderSummaries
} from '../serviceManifestHelpers';
import { getServiceHealthSnapshot, getServiceHealthSnapshots } from '../serviceRegistry';
import { schemaRef } from '../openapi/definitions';
import type { WorkflowStepDefinition, WorkflowTriggerDefinition } from '../db/types';
import type { ModuleManifest } from '@apphub/module-sdk';

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

function sanitizeForPathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveModuleArtifactDirectory(moduleId: string, moduleVersion: string): string {
  const artifactsRoot = (process.env.APPHUB_MODULE_ARTIFACTS_DIR ?? '').trim();
  const scratchRoot = (process.env.APPHUB_SCRATCH_ROOT ?? '').trim();
  const baseDir = artifactsRoot || (scratchRoot ? path.join(scratchRoot, 'module-artifacts') : path.join(os.tmpdir(), 'apphub-modules'));
  return path.join(baseDir, sanitizeForPathSegment(moduleId), sanitizeForPathSegment(moduleVersion));
}

function sanitizeArtifactFilename(filename: unknown): string {
  const raw = typeof filename === 'string' ? filename.trim() : '';
  const cleaned = sanitizeForPathSegment(raw || 'module.js');
  return cleaned.length === 0 ? 'module.js' : cleaned;
}

function resolveArtifactPath(directory: string, filename: string): string {
  const resolvedDirectory = path.resolve(directory);
  const candidate = path.resolve(resolvedDirectory, filename);
  if (!candidate.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error('artifact filename resolved outside module artifact directory');
  }
  if (candidate === resolvedDirectory) {
    return path.join(resolvedDirectory, filename);
  }
  return candidate;
}

async function upsertModuleWorkflows(
  workflows: LoadedWorkflowDefinition[],
  options: { moduleId: string; logger: FastifyBaseLogger }
): Promise<void> {
  if (workflows.length === 0) {
    return;
  }

  const failures: Array<{ slug: string; error: Error }> = [];

  for (const workflow of workflows) {
    try {
      const parsed = workflow.definition;
      const slug = parsed.slug.trim();
      const name = parsed.name;
      const description = parsed.description ?? null;
      const version = parsed.version ?? undefined;

      const existingDefaults =
        parsed.defaultParameters && typeof parsed.defaultParameters === 'object' && !Array.isArray(parsed.defaultParameters)
          ? { ...(parsed.defaultParameters as Record<string, JsonValue>) }
          : {};
      const moduleDefaults = getWorkflowDefaultParameters(slug);
      if (moduleDefaults) {
        for (const [key, value] of Object.entries(moduleDefaults)) {
          existingDefaults[key] = value;
        }
      }
      const mergedDefaults = Object.keys(existingDefaults).length > 0 ? existingDefaults : null;

      const steps = (parsed.steps ?? []) as WorkflowStepDefinition[];
      const triggers = parsed.triggers as WorkflowTriggerDefinition[] | undefined;
      const dagMetadata = buildWorkflowDagMetadata(steps);
      const stepsWithDag = applyDagMetadataToSteps(steps, dagMetadata) as WorkflowStepDefinition[];
      const parametersSchema = parsed.parametersSchema ?? {};
      const outputSchema = parsed.outputSchema ?? {};
      const metadata = parsed.metadata ?? null;

      const existing = await getWorkflowDefinitionBySlug(slug);
      if (!existing) {
        await createWorkflowDefinition({
          slug,
          name,
          version,
          description,
          steps: stepsWithDag,
          triggers,
          parametersSchema,
          defaultParameters: mergedDefaults,
          outputSchema,
          metadata,
          dag: dagMetadata
        });
        options.logger.info(
          { workflow: slug, moduleId: options.moduleId, sources: workflow.sources },
          'Imported workflow definition from module'
        );
      } else {
        await updateWorkflowDefinition(slug, {
          name,
          version,
          description,
          steps: stepsWithDag,
          triggers,
          parametersSchema,
          defaultParameters: mergedDefaults,
          outputSchema,
          metadata,
          dag: dagMetadata
        });
        options.logger.info(
          { workflow: slug, moduleId: options.moduleId, sources: workflow.sources },
          'Updated workflow definition from module'
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      options.logger.error(
        { err: error, workflow: workflow.slug, moduleId: options.moduleId, sources: workflow.sources },
        'Failed to import workflow definition'
      );
      failures.push({ slug: workflow.slug, error });
    }
  }

  if (failures.length > 0) {
    const detail = failures.map((entry) => `${entry.slug}: ${entry.error.message}`).join('; ');
    throw new Error(`failed to import ${failures.length} workflow definitions: ${detail}`);
  }
}

const serviceStatusSchema = z.enum(['unknown', 'healthy', 'degraded', 'unreachable']);
const serviceRegistrationSourceSchema = z.enum(['external', 'module']);
const serviceSourceFilterSchema = z.enum(['module', 'external']);

function jsonResponse(schemaName: string, description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: schemaRef(schemaName)
      }
    }
  } as const;
}

const errorResponse = (description: string) => jsonResponse('ErrorResponse', description);

const serviceCapabilitiesSchema = z.record(z.string(), z.unknown());

export const serviceRegistrationSchema = z
  .object({
    slug: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.string().min(1),
    baseUrl: z.string().min(1).url(),
    source: serviceRegistrationSourceSchema.optional(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: serviceCapabilitiesSchema.optional(),
    metadata: serviceMetadataUpdateSchema
  })
  .strict();

const moduleArtifactUploadSchema = z
  .object({
    moduleId: z.string().min(1),
    moduleVersion: z.string().min(1),
    displayName: z.string().min(1).nullable().optional(),
    description: z.string().min(1).nullable().optional(),
    keywords: z.array(z.string().min(1)).optional(),
    manifest: z.unknown(),
    artifact: z
      .object({
        filename: z.string().min(1).optional(),
        contentType: z.string().min(1).optional(),
        data: z.string().min(1)
      })
      .strict()
  })
  .strict();

const moduleArtifactUploadOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['moduleId', 'moduleVersion', 'manifest', 'artifact'],
  properties: {
    moduleId: { type: 'string', minLength: 1 },
    moduleVersion: { type: 'string', minLength: 1 },
    displayName: { type: 'string', nullable: true },
    description: { type: 'string', nullable: true },
    keywords: {
      type: 'array',
      items: { type: 'string', minLength: 1 }
    },
    manifest: { type: 'object' },
    artifact: {
      type: 'object',
      additionalProperties: false,
      required: ['data'],
      properties: {
        filename: { type: 'string', minLength: 1 },
        contentType: { type: 'string', minLength: 1 },
        data: {
          type: 'string',
          minLength: 1,
          description: 'Base64-encoded module bundle contents.'
        }
      }
    }
  }
} as const;

const moduleArtifactResponseOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    module: { type: 'object', additionalProperties: true },
    artifact: { type: 'object', additionalProperties: true }
  }
} as const;

export const servicePatchSchema = z
  .object({
    baseUrl: z.string().min(1).url().optional(),
    status: serviceStatusSchema.optional(),
    statusMessage: z.string().nullable().optional(),
    capabilities: serviceCapabilitiesSchema.optional(),
    metadata: serviceMetadataUpdateSchema,
    lastHealthyAt: z
      .string()
      .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid ISO timestamp')
      .nullable()
      .optional()
  })
  .strict();

const servicePatchRequestOpenApiSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    baseUrl: { type: 'string', format: 'uri' },
    status: { type: 'string', enum: ['unknown', 'healthy', 'degraded', 'unreachable'] },
    statusMessage: { type: 'string', nullable: true },
    capabilities: schemaRef('JsonValue'),
    metadata: schemaRef('ServiceMetadata'),
    lastHealthyAt: { type: 'string', format: 'date-time', nullable: true }
  }
} as const;

const gitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{7,40}$/i, 'commit must be a git SHA');

const serviceConfigImportSchema = z
  .object({
    repo: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    image: z.string().min(1).optional(),
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
    const hasImage = typeof value.image === 'string' && value.image.trim().length > 0;

    const selectedSources = [hasRepo, hasPath, hasImage].filter(Boolean).length;

    if (selectedSources !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide exactly one of "repo", "path", or "image" when importing service configs.'
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
    importManifestModule: (options: {
      moduleId: string;
      entries: LoadedManifestEntry[];
      networks: LoadedServiceNetwork[];
    }) => Promise<{ servicesApplied: number; networksApplied: number }>;
  };
};

export async function registerServiceRoutes(app: FastifyInstance, options: ServiceRoutesOptions): Promise<void> {
  const { registry } = options;

  function extractPreviewProxyTarget(request: FastifyRequest, slugParam: string): string {
    const rawUrl = request.raw.url ?? '';
    const prefix = `/services/${slugParam}/preview`;
    let suffix = rawUrl.startsWith(prefix) ? rawUrl.slice(prefix.length) : '';
    if (!suffix) {
      return '/';
    }
    if (!suffix.startsWith('/')) {
      suffix = `/${suffix}`;
    }
    return suffix === '' ? '/' : suffix;
  }

  function buildForwardHeaders(request: FastifyRequest): Headers {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (!value) {
        continue;
      }
      const lower = key.toLowerCase();
      if (['host', 'connection', 'content-length'].includes(lower)) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry !== undefined) {
            headers.append(key, entry);
          }
        }
        continue;
      }
      headers.set(key, String(value));
    }
    return headers;
  }

  async function processServiceManifestImport(request: FastifyRequest, reply: FastifyReply) {
    const parseBody = serviceConfigImportSchema.safeParse(request.body ?? {});
    if (!parseBody.success) {
      reply.status(400);
      return { error: parseBody.error.flatten() };
    }

    const payload = parseBody.data;
    const repo = payload.repo?.trim() || null;
    const localPath = payload.path?.trim() || null;
    const image = payload.image?.trim() || null;
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
        image,
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

    if (requirePlaceholderValues && preview.placeholders.length > 0 && !variables) {
      reply.status(400);
      return {
        error: 'manifest placeholders require confirmation before import',
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

    const { placeholders: initialPlaceholders, variables: bootstrapVariables } = buildBootstrapContext(
      preview,
      variables
    );
    let placeholderValues = initialPlaceholders;
    let bootstrapResult: Awaited<ReturnType<typeof executeBootstrapPlan>> | null = null;
    const bootstrapPlan = preview.bootstrap;
    const hasBootstrapActions = Boolean(bootstrapPlan && bootstrapPlan.actions.length > 0);
    const bootstrapDisabled = process.env.APPHUB_DISABLE_MODULE_BOOTSTRAP === '1';

    if (hasBootstrapActions && !bootstrapDisabled) {
      try {
        bootstrapResult = await executeBootstrapPlan({
          moduleId: preview.moduleId,
          plan: bootstrapPlan,
          placeholders: initialPlaceholders,
          variables: bootstrapVariables,
          logger: request.log
        });
        placeholderValues = bootstrapResult.placeholders;
        if (bootstrapResult.workflowDefaults.size) {
          registerWorkflowDefaults(preview.moduleId, bootstrapResult.workflowDefaults);
        }
      } catch (err) {
        request.log.error(
          { err, module: preview.moduleId },
          'module bootstrap execution failed'
        );
        reply.status(500);
        return { error: 'failed to execute module bootstrap actions' };
      }
    } else if (hasBootstrapActions && bootstrapDisabled) {
      request.log.debug(
        { module: preview.moduleId, reason: 'disabled' },
        'module bootstrap skipped via APPHUB_DISABLE_MODULE_BOOTSTRAP'
      );
    }

    updatePlaceholderSummaries(preview.placeholders, placeholderValues);
    applyPlaceholderValuesToManifest(preview.placeholders, preview.entries, preview.networks, placeholderValues);

    try {
      await upsertModuleWorkflows(preview.workflows, {
        moduleId: preview.moduleId,
        logger: request.log
      });
    } catch (err) {
      request.log.error({ err, module: preview.moduleId }, 'failed to import workflows for module');
      reply.status(500);
      return { error: 'failed to import workflows for module' };
    }

    try {
      await registry.importManifestModule({
        moduleId: preview.moduleId,
        entries: preview.entries,
        networks: preview.networks
      });
    } catch (err) {
      request.log.error(
        { err, module: preview.moduleId },
        'service manifest import failed to apply'
      );
      reply.status(500);
      return { error: 'failed to apply service manifest' };
    }

    reply.status(201);
    return {
      data: {
        module: preview.moduleId,
        resolvedCommit: preview.resolvedCommit ?? commit ?? image ?? null,
        servicesDiscovered: preview.entries.length,
        networksDiscovered: preview.networks.length,
        workflowsDiscovered: preview.workflows.length
      }
    };
  }

  async function handleServicePreviewProxy(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { slug?: string };
    const slugParam = params.slug ?? '';
    const slug = slugParam.trim().toLowerCase();
    if (!slug) {
      reply.status(400);
      return { error: 'service slug required' };
    }

    const service = await getServiceBySlug(slug);
    if (!service) {
      reply.status(404);
      return { error: 'service not found' };
    }

    const targetPath = extractPreviewProxyTarget(request, slugParam);

    try {
      const headers = buildForwardHeaders(request);
      const { response } = await fetchFromService(service, targetPath, { headers });
      reply.status(response.status);
      for (const [headerKey, headerValue] of response.headers.entries()) {
        if (headerKey.toLowerCase() === 'content-length') {
          continue;
        }
        reply.header(headerKey, headerValue);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      reply.header('content-length', buffer.length);
      return reply.send(buffer);
    } catch (err) {
      request.log.error({ err, slug, targetPath }, 'Service preview proxy request failed');
      reply.status(502);
      return { error: 'service preview unavailable' };
    }
  }

  app.get(
    '/services',
    {
      schema: {
        tags: ['Services'],
        summary: 'List registered services',
        querystring: {
          type: 'object',
          additionalProperties: true,
          properties: {
            source: { type: 'string', enum: ['module', 'external'] }
          }
        },
        response: {
          200: jsonResponse('ServiceListResponse', 'Service inventory and health summary.'),
          400: errorResponse('The query parameters were invalid.')
        }
      }
    },
    async (request, reply) => {
      const parseQuery = z
        .object({ source: serviceSourceFilterSchema.optional() })
        .passthrough()
        .safeParse(request.query ?? {});

      if (!parseQuery.success) {
        reply.status(400);
        return { error: parseQuery.error.flatten() };
      }

      const { source } = parseQuery.data;
      const services = await listServices();
      const filteredServices = source
        ? services.filter((service) => service.source === source)
        : services;

      const healthSnapshots = await getServiceHealthSnapshots(
        filteredServices.map((service) => service.slug)
      );
      const healthyCount = filteredServices.filter((service) => service.status === 'healthy').length;
      const unhealthyCount = filteredServices.length - healthyCount;
      const sourceCounts = services.reduce(
        (acc, service) => {
          acc[service.source] = (acc[service.source] ?? 0) + 1;
          return acc;
        },
        { module: 0, external: 0 } as Record<'module' | 'external', number>
      );

      return {
        data: filteredServices.map((service) =>
          serializeService(service, healthSnapshots.get(service.slug) ?? null)
        ),
        meta: {
          total: filteredServices.length,
          healthyCount,
          unhealthyCount,
          filters: source ? { source } : null,
          sourceCounts
        }
      };
    }
  );

  app.get('/services/:slug/preview', handleServicePreviewProxy);
  app.get('/services/:slug/preview/*', handleServicePreviewProxy);

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
      const resolvedSource = payload.source ?? existing?.source ?? 'external';

      const upsertPayload: ServiceUpsertInput = {
        slug: payload.slug,
        displayName: payload.displayName,
        kind: payload.kind,
        baseUrl: payload.baseUrl,
        source: resolvedSource,
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
      const healthSnapshot = await getServiceHealthSnapshot(record.slug);
      return { data: serializeService(record, healthSnapshot) };
    });

  app.post(
    '/services/module',
    {
      schema: {
        tags: ['Services'],
        summary: 'Register or update a module-managed service',
        description:
          'Adds or updates a service provisioned via the AppHub module runtime.',
        security: [{ ServiceRegistryToken: [] }],
        body: {
          type: 'object',
          additionalProperties: true
        },
        response: {
          201: jsonResponse('ServiceResponse', 'Module service registered.'),
          200: jsonResponse('ServiceResponse', 'Module service updated.'),
          400: errorResponse('The service payload failed validation.'),
          401: errorResponse('Authorization header was missing.'),
          403: errorResponse('Authorization header was rejected.'),
          503: errorResponse('Service registry support is disabled on this deployment.')
        }
      },
      validatorCompiler: () => () => true
    },
    async (request, reply) => {
      if (!ensureServiceRegistryAuthorized(request, reply)) {
        return { error: 'service registry disabled' };
      }

      const parseBody = serviceRegistrationSchema.safeParse(request.body ?? {});
      if (!parseBody.success) {
        request.log.warn(
          { resourceType: 'service', issues: parseBody.error.flatten() },
          'module service registration validation failed'
        );
        reply.status(400);
        return { error: parseBody.error.flatten() };
      }

      const payload = { ...parseBody.data, source: 'module' as const };
      const existing = await getServiceBySlug(payload.slug);
      const metadataUpdate = mergeServiceMetadata(existing?.metadata ?? null, payload.metadata);

      const upsertPayload: ServiceUpsertInput = {
        slug: payload.slug,
        displayName: payload.displayName,
        kind: payload.kind,
        baseUrl: payload.baseUrl,
        source: 'module',
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
      const healthSnapshot = await getServiceHealthSnapshot(record.slug);
      return { data: serializeService(record, healthSnapshot) };
    }
  );

  app.post(
    '/module-runtime/artifacts',
    {
      schema: {
        tags: ['Modules'],
        summary: 'Publish a module artifact',
        description: 'Stores a module bundle on disk and registers it for module runtime execution.',
        security: [{ ServiceRegistryToken: [] }],
        body: moduleArtifactUploadOpenApiSchema,
        response: {
          200: jsonResponse('ModuleArtifactResponse', 'Module artifact registered.'),
          201: jsonResponse('ModuleArtifactResponse', 'Module artifact registered.'),
          400: errorResponse('The module artifact payload failed validation.'),
          401: errorResponse('Authorization header was missing.'),
          403: errorResponse('Authorization header was rejected.'),
          500: errorResponse('Failed to store the module artifact.'),
          503: errorResponse('Service registry support is disabled on this deployment.')
        }
      }
    },
    async (request, reply) => {
      if (!ensureServiceRegistryAuthorized(request, reply)) {
        return { error: 'service registry disabled' };
      }

      const parseBody = moduleArtifactUploadSchema.safeParse(request.body ?? {});
      if (!parseBody.success) {
        reply.status(400);
        return { error: parseBody.error.flatten() };
      }

      const payload = parseBody.data;
      if (typeof payload.manifest !== 'object' || payload.manifest === null) {
        reply.status(400);
        return { error: 'module manifest must be an object' };
      }

      let artifactBuffer: Buffer;
      try {
        artifactBuffer = Buffer.from(payload.artifact.data, 'base64');
      } catch (error) {
        request.log.warn({ error, moduleId: payload.moduleId }, 'failed to decode module artifact payload');
        reply.status(400);
        return { error: 'artifact data must be base64 encoded' };
      }

      if (artifactBuffer.length === 0) {
        reply.status(400);
        return { error: 'artifact data payload was empty' };
      }

      const filename = sanitizeArtifactFilename(payload.artifact.filename);
      const directory = resolveModuleArtifactDirectory(payload.moduleId, payload.moduleVersion);

      try {
        await fs.mkdir(directory, { recursive: true });
        const artifactPath = resolveArtifactPath(directory, filename);
        await fs.writeFile(artifactPath, artifactBuffer);
        const manifestPath = path.join(directory, 'module.json');
        await fs.writeFile(manifestPath, `${JSON.stringify(payload.manifest, null, 2)}\n`, 'utf8');

        const checksum = createHash('sha256').update(artifactBuffer).digest('hex');
        const result = await publishModuleArtifact({
          moduleId: payload.moduleId,
          moduleVersion: payload.moduleVersion,
          displayName: payload.displayName ?? null,
          description: payload.description ?? null,
          keywords: payload.keywords ?? [],
          manifest: payload.manifest as ModuleManifest,
          artifactPath,
          artifactChecksum: checksum,
          artifactStorage: 'filesystem',
          artifactContentType: payload.artifact.contentType ?? 'application/javascript',
          artifactSize: artifactBuffer.length
        });

        reply.status(201);

        return {
          data: {
            module: result.module,
            artifact: {
              id: result.artifact.id,
              version: result.artifact.version
            }
          }
        };
      } catch (error) {
        request.log.error({ err: error, moduleId: payload.moduleId, moduleVersion: payload.moduleVersion }, 'failed to publish module artifact');
        reply.status(500);
        return { error: 'failed to publish module artifact' };
      }
    }
  );

  app.post('/service-config/import', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }
    return processServiceManifestImport(request, reply);
  });

  app.post('/service-networks/import', async (request, reply) => {
    if (!ensureServiceRegistryAuthorized(request, reply)) {
      return { error: 'service registry disabled' };
    }
    return processServiceManifestImport(request, reply);
  });

  app.patch(
    '/services/:slug',
    {
      schema: {
        tags: ['Services'],
        summary: 'Update a registered service',
        description: 'Updates metadata for an existing service entry. Requires the service registry bearer token.',
        security: [{ ServiceRegistryToken: [] }],
        params: {
          type: 'object',
          additionalProperties: false,
          required: ['slug'],
          properties: {
            slug: { type: 'string', description: 'Service slug.' }
          }
        },
        body: servicePatchRequestOpenApiSchema,
        response: {
          200: jsonResponse('ServiceResponse', 'Updated service metadata.'),
          400: errorResponse('The service payload failed validation.'),
          401: errorResponse('Authorization header was missing.'),
          403: errorResponse('Authorization header was rejected.'),
          404: errorResponse('Service not found.'),
          500: errorResponse('Failed to update service.'),
          503: errorResponse('Service registry support is disabled on this deployment.')
        }
      }
    },
    async (request, reply) => {
      if (!ensureServiceRegistryAuthorized(request, reply)) {
        return { error: 'service registry disabled' };
      }

      const parseParams = z.object({ slug: z.string().min(1) }).safeParse(request.params);
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

      const healthSnapshot = await getServiceHealthSnapshot(updated.slug);
      return { data: serializeService(updated, healthSnapshot) };
    }
  );
}
