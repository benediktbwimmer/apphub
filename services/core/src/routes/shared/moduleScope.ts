import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getModuleById,
  listModuleResourceContextsForModule
} from '../../db';
import type { ModuleResourceType } from '../../db/types';
import type { ModuleTargetRow } from '../../db/rowTypes';
import { useConnection } from '../../db/utils';
import { mapModuleTargetRow } from '../../db/rowMappers';
import { getWorkflowDefinitionBySlug } from '../../workflows/repositories/definitionsRepository';

const moduleIdSchema = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    if (Array.isArray(value)) {
      return value.flatMap((entry) => splitModuleIds(entry));
    }
    return splitModuleIds(value);
  });

function splitModuleIds(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export class ModuleScopeError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export type ModuleScope = {
  moduleIds: string[];
  hasFilters: boolean;
  matches: (
    resourceType: ModuleResourceType,
    identifiers: { id?: string | null; slug?: string | null; moduleId?: string | null }
  ) => boolean;
  filter: <T>(
    records: T[],
    resourceType: ModuleResourceType,
    getIdentifiers: (record: T) => { id?: string | null; slug?: string | null; moduleId?: string | null }
  ) => T[];
  getSlugs: (resourceType: ModuleResourceType) => string[];
  getIds: (resourceType: ModuleResourceType) => string[];
};

export async function resolveModuleScope(
  request: FastifyRequest,
  moduleIdValue: unknown,
  resourceTypes: readonly ModuleResourceType[]
): Promise<ModuleScope | null> {
  const rawModuleIds = parseModuleIds(moduleIdValue ?? request.headers['x-apphub-module-id']);
  if (!rawModuleIds || rawModuleIds.length === 0) {
    return {
      moduleIds: [],
      hasFilters: false,
      matches: () => true,
      filter: (records) => records,
      getSlugs: () => [],
      getIds: () => []
    } satisfies ModuleScope;
  }

  const moduleIds = Array.from(new Set(rawModuleIds));
  const resources = await loadModuleResources(moduleIds, resourceTypes);
  const moduleIdSet = new Set(moduleIds.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0));

  return {
    moduleIds,
    hasFilters: true,
    matches: (resourceType, identifiers) => matchesResource(resources, moduleIdSet, resourceType, identifiers),
    filter: (records, resourceType, getIdentifiers) =>
      records.filter((record) => matchesResource(resources, moduleIdSet, resourceType, getIdentifiers(record))),
    getSlugs: (resourceType) => {
      const entry = resources.get(resourceType);
      return entry ? Array.from(entry.slugs.values()) : [];
    },
    getIds: (resourceType) => {
      const entry = resources.get(resourceType);
      return entry ? Array.from(entry.ids) : [];
    }
  } satisfies ModuleScope;
}

function parseModuleIds(input: unknown): string[] | null {
  if (!input) {
    return null;
  }
  const result = moduleIdSchema.safeParse(input);
  if (!result.success) {
    throw new ModuleScopeError(400, 'Invalid moduleId parameter');
  }
  return result.data;
}

type ResourceEntry = {
  ids: Set<string>;
  slugs: Set<string>;
  slugLookup: Set<string>;
};

async function loadModuleResources(
  moduleIds: string[],
  resourceTypes: readonly ModuleResourceType[]
): Promise<Map<ModuleResourceType, ResourceEntry>> {
  const typeSet = new Set(resourceTypes);
  const resources = new Map<ModuleResourceType, ResourceEntry>();

  for (const moduleId of moduleIds) {
    const record = await getModuleById(moduleId);
    if (!record) {
      throw new ModuleScopeError(404, `Module not found: ${moduleId}`);
    }
    const contexts = await listModuleResourceContextsForModule(moduleId, {});
    for (const context of contexts) {
      const resourceType = context.resourceType as ModuleResourceType;
      if (!typeSet.has(resourceType)) {
        continue;
      }
      let entry = resources.get(resourceType);
      if (!entry) {
        entry = { ids: new Set<string>(), slugs: new Set<string>(), slugLookup: new Set<string>() } satisfies ResourceEntry;
        resources.set(resourceType, entry);
      }
      const normalizedId = context.resourceId.trim();
      if (normalizedId) {
        entry.ids.add(normalizedId);
      }
      if (context.resourceSlug) {
        const slug = context.resourceSlug.trim();
        if (slug) {
          entry.slugs.add(slug);
          entry.slugLookup.add(slug.toLowerCase());
        }
      }
    }

    if (typeSet.has('workflow-definition')) {
      let entry = resources.get('workflow-definition');
      if (!entry || entry.ids.size === 0) {
        const fallbacks = await loadWorkflowDefinitionsFromTargets(moduleId);
        if (fallbacks.length > 0) {
          if (!entry) {
            entry = {
              ids: new Set<string>(),
              slugs: new Set<string>(),
              slugLookup: new Set<string>()
            } satisfies ResourceEntry;
            resources.set('workflow-definition', entry);
          }
          for (const def of fallbacks) {
            entry.ids.add(def.id);
            entry.slugs.add(def.slug);
            entry.slugLookup.add(def.slug.toLowerCase());
          }
        }
      }
    }
  }

  return resources;
}

async function loadWorkflowDefinitionsFromTargets(
  moduleId: string
): Promise<Array<{ id: string; slug: string }>> {
  const { rows } = await useConnection((client) =>
    client.query<ModuleTargetRow>(
      `SELECT *
         FROM module_targets
        WHERE module_id = $1
          AND target_kind = 'workflow'
        ORDER BY target_name ASC`,
      [moduleId]
    )
  );

  if (rows.length === 0) {
    return [];
  }

  const slugPromises = rows.map(async (row) => {
    const mapped = mapModuleTargetRow(row);
    const workflowMetadata = mapped.metadata?.workflow;
    const definitionMetadata =
      workflowMetadata && typeof workflowMetadata === 'object'
        ? (workflowMetadata as Record<string, unknown>).definition
        : null;
    const slugValue =
      definitionMetadata && typeof definitionMetadata === 'object'
        ? (definitionMetadata as Record<string, unknown>).slug
        : undefined;
    const slug =
      typeof slugValue === 'string' && slugValue.trim().length > 0
        ? slugValue.trim()
        : mapped.name.trim();
    if (!slug) {
      return null;
    }
    const definition = await getWorkflowDefinitionBySlug(slug);
    if (!definition) {
      return null;
    }
    return { id: definition.id, slug: definition.slug };
  });

  const resolved = await Promise.all(slugPromises);
  return resolved.filter((entry): entry is { id: string; slug: string } => entry !== null);
}

function matchesResource(
  resources: Map<ModuleResourceType, ResourceEntry>,
  moduleIdSet: Set<string>,
  resourceType: ModuleResourceType,
  identifiers: { id?: string | null; slug?: string | null; moduleId?: string | null }
): boolean {
  const entry = resources.get(resourceType);
  if (!entry) {
    return matchesFallback(moduleIdSet, identifiers);
  }
  const identifierId = identifiers.id?.trim();
  if (identifierId && entry.ids.has(identifierId)) {
    return true;
  }
  const slug = identifiers.slug?.trim().toLowerCase();
  if (slug && entry.slugLookup.has(slug)) {
    return true;
  }
  return matchesFallback(moduleIdSet, identifiers);
}

function matchesFallback(
  moduleIdSet: Set<string>,
  identifiers: { slug?: string | null; moduleId?: string | null }
): boolean {
  if (moduleIdSet.size === 0) {
    return false;
  }

  const explicitModuleId = typeof identifiers.moduleId === 'string' ? identifiers.moduleId.trim() : '';
  if (explicitModuleId && moduleIdSet.has(explicitModuleId.toLowerCase())) {
    return true;
  }

  const slug = typeof identifiers.slug === 'string' ? identifiers.slug.trim().toLowerCase() : '';
  if (!slug) {
    return false;
  }

  for (const moduleId of moduleIdSet) {
    if (slug === moduleId || slug.startsWith(`${moduleId}-`)) {
      return true;
    }
  }
  return false;
}

export function handleModuleScopeError(reply: FastifyReply, error: unknown): { error: string } | never {
  if (error instanceof ModuleScopeError) {
    reply.status(error.statusCode);
    return { error: error.message };
  }
  throw error;
}
