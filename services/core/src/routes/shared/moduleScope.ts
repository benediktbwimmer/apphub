import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  getModuleById,
  listModuleResourceContextsForModule
} from '../../db';
import type { ModuleResourceType } from '../../db/types';

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
    identifiers: { id?: string | null; slug?: string | null }
  ) => boolean;
  filter: <T>(
    records: T[],
    resourceType: ModuleResourceType,
    getIdentifiers: (record: T) => { id?: string | null; slug?: string | null }
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

  return {
    moduleIds,
    hasFilters: true,
    matches: (resourceType, identifiers) => matchesResource(resources, resourceType, identifiers),
    filter: (records, resourceType, getIdentifiers) =>
      records.filter((record) => matchesResource(resources, resourceType, getIdentifiers(record))),
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
  }

  return resources;
}

function matchesResource(
  resources: Map<ModuleResourceType, ResourceEntry>,
  resourceType: ModuleResourceType,
  identifiers: { id?: string | null; slug?: string | null }
): boolean {
  const entry = resources.get(resourceType);
  if (!entry) {
    return false;
  }
  const identifierId = identifiers.id?.trim();
  if (identifierId && entry.ids.has(identifierId)) {
    return true;
  }
  const slug = identifiers.slug?.trim().toLowerCase();
  if (slug && entry.slugLookup.has(slug)) {
    return true;
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
