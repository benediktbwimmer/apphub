import { Buffer } from 'node:buffer';
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
import type { WorkflowStepDefinition, WorkflowTriggerDefinition } from '../db/types';

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

  app.get('/services', async () => {
    const services = await listServices();
    const healthSnapshots = await getServiceHealthSnapshots(services.map((service) => service.slug));
    const healthyCount = services.filter((service) => service.status === 'healthy').length;
    const unhealthyCount = services.length - healthyCount;
    return {
      data: services.map((service) =>
        serializeService(service, healthSnapshots.get(service.slug) ?? null)
      ),
      meta: {
        total: services.length,
        healthyCount,
        unhealthyCount
      }
    };
  });

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
    const healthSnapshot = await getServiceHealthSnapshot(record.slug);
    return { data: serializeService(record, healthSnapshot) };
  });

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

    const healthSnapshot = await getServiceHealthSnapshot(updated.slug);
    return { data: serializeService(updated, healthSnapshot) };
  });
}
