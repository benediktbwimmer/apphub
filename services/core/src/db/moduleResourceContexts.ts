import type { PoolClient } from 'pg';
import { mapModuleResourceContextRow } from './rowMappers';
import type { ModuleResourceContextRow } from './rowTypes';
import {
  type JsonValue,
  type ModuleResourceContextDeleteInput,
  type ModuleResourceContextRecord,
  type ModuleResourceContextUpsertInput,
  type ModuleResourceType
} from './types';
import { useConnection } from './utils';
import {
  publishServiceRegistryInvalidation,
  type ServiceRegistryInvalidationMessage
} from '../serviceRegistry/invalidationBus';
import { emitApphubEvent } from '../events';

function normalizeIdentifier(value: string, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} is required`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  return trimmed;
}

function normalizeResourceType(resourceType: ModuleResourceType): string {
  return resourceType.trim().toLowerCase();
}

function normalizeUpsertInput(input: ModuleResourceContextUpsertInput) {
  const moduleId = normalizeIdentifier(input.moduleId, 'moduleId');
  const resourceId = normalizeIdentifier(input.resourceId, 'resourceId');
  const resourceType = normalizeResourceType(input.resourceType);
  const moduleVersion = input.moduleVersion === undefined || input.moduleVersion === null
    ? null
    : String(input.moduleVersion).trim() || null;
  const resourceVersion = input.resourceVersion === undefined || input.resourceVersion === null
    ? null
    : String(input.resourceVersion).trim() || null;
  const resourceSlug = input.resourceSlug === undefined || input.resourceSlug === null
    ? null
    : input.resourceSlug.trim() || null;
  const resourceName = input.resourceName === undefined || input.resourceName === null
    ? null
    : input.resourceName.trim() || null;
  const metadata = input.metadata === undefined ? null : (input.metadata as JsonValue | null);
  const isShared = Boolean(input.isShared);

  return {
    moduleId,
    moduleVersion,
    resourceType,
    resourceId,
    resourceSlug,
    resourceName,
    resourceVersion,
    isShared,
    metadata
  };
}

function toInvalidationMessage(
  record: ModuleResourceContextRecord,
  action: 'upsert' | 'delete'
): ServiceRegistryInvalidationMessage {
  return {
    kind: 'module-context',
    moduleId: record.moduleId,
    moduleVersion: record.moduleVersion ?? null,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    resourceSlug: record.resourceSlug ?? undefined,
    resourceName: record.resourceName ?? undefined,
    action
  } satisfies ServiceRegistryInvalidationMessage;
}

async function notifyModuleResourceContextChange(
  record: ModuleResourceContextRecord,
  action: 'upsert' | 'delete'
): Promise<void> {
  try {
    await publishServiceRegistryInvalidation(toInvalidationMessage(record, action));
  } catch (err) {
    console.warn('[module-resource-contexts] failed to publish invalidation', {
      moduleId: record.moduleId,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      action,
      error: err instanceof Error ? err.message : String(err)
    });
  }

  try {
    emitApphubEvent({
      type: action === 'upsert' ? 'module.context.updated' : 'module.context.deleted',
      data: { context: record }
    });
  } catch (err) {
    console.warn('[module-resource-contexts] failed to emit module context event', {
      moduleId: record.moduleId,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      action,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

async function runUpsertWithClient(
  client: PoolClient,
  input: ModuleResourceContextUpsertInput
): Promise<ModuleResourceContextRecord> {
  const normalized = normalizeUpsertInput(input);
  const { rows } = await client.query<ModuleResourceContextRow>(
    `INSERT INTO module_resource_contexts (
       module_id,
       module_version,
       resource_type,
       resource_id,
       resource_slug,
       resource_name,
       resource_version,
       is_shared,
       metadata,
       created_at,
       updated_at
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       $9::jsonb,
       NOW(),
       NOW()
     )
     ON CONFLICT (module_id, resource_type, resource_id) DO UPDATE SET
       module_version = EXCLUDED.module_version,
       resource_slug = EXCLUDED.resource_slug,
       resource_name = EXCLUDED.resource_name,
       resource_version = EXCLUDED.resource_version,
       is_shared = EXCLUDED.is_shared,
       metadata = EXCLUDED.metadata,
       updated_at = NOW()
     RETURNING *`,
    [
      normalized.moduleId,
      normalized.moduleVersion,
      normalized.resourceType,
      normalized.resourceId,
      normalized.resourceSlug,
      normalized.resourceName,
      normalized.resourceVersion,
      normalized.isShared,
      normalized.metadata
    ]
  );

  if (rows.length === 0) {
    throw new Error('failed to upsert module resource context');
  }

  return mapModuleResourceContextRow(rows[0]);
}

async function runDeleteWithClient(
  client: PoolClient,
  input: ModuleResourceContextDeleteInput
): Promise<ModuleResourceContextRecord | null> {
  const moduleId = normalizeIdentifier(input.moduleId, 'moduleId');
  const resourceId = normalizeIdentifier(input.resourceId, 'resourceId');
  const resourceType = normalizeResourceType(input.resourceType);
  const { rows } = await client.query<ModuleResourceContextRow>(
    `SELECT *
       FROM module_resource_contexts
      WHERE module_id = $1 AND resource_type = $2 AND resource_id = $3`,
    [moduleId, resourceType, resourceId]
  );
  if (rows.length === 0) {
    return null;
  }
  await client.query(
    `DELETE FROM module_resource_contexts
      WHERE module_id = $1 AND resource_type = $2 AND resource_id = $3`,
    [moduleId, resourceType, resourceId]
  );
  return mapModuleResourceContextRow(rows[0]);
}

export async function upsertModuleResourceContext(
  input: ModuleResourceContextUpsertInput,
  options: { client?: PoolClient } = {}
): Promise<ModuleResourceContextRecord> {
  if (options.client) {
    return runUpsertWithClient(options.client, input);
  }
  const record = await useConnection((client) => runUpsertWithClient(client, input));
  await notifyModuleResourceContextChange(record, 'upsert');
  return record;
}

export async function upsertModuleResourceContexts(
  inputs: ModuleResourceContextUpsertInput[],
  options: { client?: PoolClient } = {}
): Promise<ModuleResourceContextRecord[]> {
  if (inputs.length === 0) {
    return [];
  }
  if (options.client) {
    const results: ModuleResourceContextRecord[] = [];
    for (const input of inputs) {
      results.push(await runUpsertWithClient(options.client, input));
    }
    return results;
  }
  const results = await useConnection(async (client) => {
    const produced: ModuleResourceContextRecord[] = [];
    for (const input of inputs) {
      produced.push(await runUpsertWithClient(client, input));
    }
    return produced;
  });
  await Promise.all(results.map((record) => notifyModuleResourceContextChange(record, 'upsert')));
  return results;
}

export async function deleteModuleResourceContext(
  input: ModuleResourceContextDeleteInput,
  options: { client?: PoolClient } = {}
): Promise<boolean> {
  if (options.client) {
    const removed = await runDeleteWithClient(options.client, input);
    return removed !== null;
  }
  const removed = await useConnection((client) => runDeleteWithClient(client, input));
  if (removed) {
    await notifyModuleResourceContextChange(removed, 'delete');
    return true;
  }
  return false;
}

export async function listModuleResourceContextsForModule(
  moduleId: string,
  options: { client?: PoolClient; resourceType?: ModuleResourceType }
): Promise<ModuleResourceContextRecord[]> {
  const normalizedModuleId = normalizeIdentifier(moduleId, 'moduleId');
  const resourceType = options.resourceType ? normalizeResourceType(options.resourceType) : null;

  const runner = async (client: PoolClient) => {
    const params: unknown[] = [normalizedModuleId];
    let query =
      'SELECT * FROM module_resource_contexts WHERE module_id = $1 ORDER BY resource_type ASC, resource_id ASC';
    if (resourceType) {
      query =
        'SELECT * FROM module_resource_contexts WHERE module_id = $1 AND resource_type = $2 ORDER BY resource_type ASC, resource_id ASC';
      params.push(resourceType);
    }
    const { rows } = await client.query<ModuleResourceContextRow>(query, params);
    return rows.map(mapModuleResourceContextRow);
  };

  if (options.client) {
    return runner(options.client);
  }
  return useConnection(runner);
}

export async function listModuleAssignmentsForResource(
  resourceType: ModuleResourceType,
  resourceId: string,
  options: { client?: PoolClient } = {}
): Promise<ModuleResourceContextRecord[]> {
  const normalizedResourceId = normalizeIdentifier(resourceId, 'resourceId');
  const normalizedResourceType = normalizeResourceType(resourceType);

  const runner = async (client: PoolClient) => {
    const { rows } = await client.query<ModuleResourceContextRow>(
      `SELECT *
         FROM module_resource_contexts
        WHERE resource_type = $1 AND resource_id = $2
        ORDER BY module_id ASC`,
      [normalizedResourceType, normalizedResourceId]
    );
    return rows.map(mapModuleResourceContextRow);
  };

  if (options.client) {
    return runner(options.client);
  }
  return useConnection(runner);
}

export async function deleteModuleAssignmentsForResource(
  resourceType: ModuleResourceType,
  resourceId: string,
  options: { client?: PoolClient } = {}
): Promise<number> {
  const normalizedResourceId = normalizeIdentifier(resourceId, 'resourceId');
  const normalizedResourceType = normalizeResourceType(resourceType);

  const runner = async (client: PoolClient) => {
    const { rows } = await client.query<ModuleResourceContextRow>(
      `SELECT *
         FROM module_resource_contexts
        WHERE resource_type = $1 AND resource_id = $2`,
      [normalizedResourceType, normalizedResourceId]
    );
    if (rows.length === 0) {
      return { count: 0, contexts: [] as ModuleResourceContextRecord[] };
    }
    await client.query(
      `DELETE FROM module_resource_contexts
        WHERE resource_type = $1 AND resource_id = $2`,
      [normalizedResourceType, normalizedResourceId]
    );
    return {
      count: rows.length,
      contexts: rows.map(mapModuleResourceContextRow)
    };
  };

  if (options.client) {
    const { count } = await runner(options.client);
    return count;
  }
  const { count, contexts } = await useConnection(runner);
  if (contexts.length > 0) {
    await Promise.all(contexts.map((record) => notifyModuleResourceContextChange(record, 'delete')));
  }
  return count;
}
