import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { Pool } from 'pg';
import type { JsonValue } from '../serviceManifestTypes';
import { bootstrapPlanSchema, type BootstrapActionSpec, type BootstrapPlanSpec } from './schema';
import {
  cloneJsonValue,
  ensureJsonObject,
  renderJsonTemplates,
  renderTemplateString
} from './template';

export type BootstrapExecutionOptions = {
  moduleId: string;
  plan?: BootstrapPlanSpec | null;
  placeholders: Map<string, string>;
  variables?: Record<string, string> | null;
  logger?: FastifyBaseLogger;
  workspaceRoot?: string;
  poolFactory?: PoolFactory;
};

export type BootstrapExecutionResult = {
  placeholders: Map<string, string>;
  variables: Map<string, string>;
  workflowDefaults: Map<string, Record<string, JsonValue>>;
  warnings: string[];
  actions: Array<{ type: string; description?: string }>;
};

type TemplateScope = Record<string, unknown>;

type PoolFactory = (options: { connectionString: string }) => {
  query: <T>(query: string, params: unknown[]) => Promise<{ rows: T[] }>;
  end: () => Promise<void> | void;
};

type ExecutionContext = {
  moduleId: string;
  logger?: FastifyBaseLogger;
  placeholders: Map<string, string>;
  variables: Map<string, string>;
  outputs: Record<string, unknown>;
  workspaceRoot: string;
  warnings: string[];
  actions: Array<{ type: string; description?: string }>;
  workflowDefaults: Map<string, Record<string, JsonValue>>;
  poolFactory: PoolFactory;
};

function determineWorkspaceRoot(explicit?: string): string {
  if (explicit && explicit.trim().length > 0) {
    return path.resolve(explicit.trim());
  }
  const envRoot = process.env.APPHUB_REPO_ROOT;
  if (envRoot && envRoot.trim().length > 0) {
    return path.resolve(envRoot.trim());
  }
  return path.resolve(__dirname, '..', '..', '..');
}

const defaultPoolFactory: PoolFactory = ({ connectionString }) => {
  const pool = new Pool({ connectionString, max: 1 });
  return {
    query: (text, params) => pool.query(text, params),
    end: () => pool.end()
  };
};

function createScope(context: ExecutionContext): TemplateScope {
  return {
    env: process.env,
    module: { id: context.moduleId },
    placeholders: Object.fromEntries(context.placeholders.entries()),
    variables: Object.fromEntries(context.variables.entries()),
    outputs: { ...context.outputs },
    paths: {
      repoRoot: context.workspaceRoot,
      workspaceRoot: context.workspaceRoot,
      cwd: process.cwd()
    },
    now: new Date().toISOString()
  } satisfies TemplateScope;
}

async function ensureDirectories(action: Extract<BootstrapActionSpec, { type: 'ensureDirectories' }>, context: ExecutionContext) {
  const scope = createScope(context);
  for (const entry of action.directories) {
    const resolved = renderTemplateString(entry, scope).trim();
    if (!resolved) {
      continue;
    }
    const absolute = path.isAbsolute(resolved) ? resolved : path.resolve(context.workspaceRoot, resolved);
    await mkdir(absolute, { recursive: true });
    context.logger?.debug?.({ moduleId: context.moduleId, directory: absolute }, 'bootstrap ensured directory');
  }
}

async function ensureFilestoreBackend(
  action: Extract<BootstrapActionSpec, { type: 'ensureFilestoreBackend' }>,
  context: ExecutionContext
) {
  const scope = createScope(context);
  const mountKey = renderTemplateString(action.mountKey, scope).trim();
  if (!mountKey) {
    throw new Error('filestore backend mountKey resolved to an empty string');
  }

  const backend = action.backend ?? { kind: 'local', rootPath: path.join(context.workspaceRoot, 'data', mountKey) };
  if (backend.kind !== 'local') {
    throw new Error(`unsupported filestore backend kind: ${backend.kind}`);
  }
  const rootPathResolved = renderTemplateString(backend.rootPath, scope).trim();
  if (!rootPathResolved) {
    throw new Error('filestore backend root path resolved to an empty string');
  }
  const backendRoot = path.isAbsolute(rootPathResolved)
    ? rootPathResolved
    : path.resolve(context.workspaceRoot, rootPathResolved);

  const connectionStringRaw = action.connection?.connectionString
    ? renderTemplateString(action.connection.connectionString, scope).trim()
    : (process.env.FILESTORE_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://apphub:apphub@127.0.0.1:5432/apphub');
  const connectionString = connectionStringRaw.trim();
  if (!connectionString) {
    throw new Error('filestore backend connection string resolved to an empty value');
  }

  const schemaRaw = action.connection?.schema
    ? renderTemplateString(action.connection.schema, scope).trim()
    : (process.env.FILESTORE_PG_SCHEMA ?? 'filestore');
  const schema = schemaRaw.trim();
  if (!schema) {
    throw new Error('filestore backend schema resolved to an empty value');
  }

  await mkdir(backendRoot, { recursive: true });

  const pool = context.poolFactory({ connectionString });
  let backendId: number | null = null;
  try {
    const quotedSchema = `"${schema.replace(/"/g, '""')}"`;
    const resolvedConfig = action.config ? renderJsonTemplates(action.config, scope) : undefined;
    const configJson = resolvedConfig !== undefined ? JSON.stringify(resolvedConfig) : JSON.stringify({});
    const result = await pool.query<{ id: number }>(
      `INSERT INTO ${quotedSchema}.backend_mounts (mount_key, backend_kind, root_path, access_mode, state, config)
       VALUES ($1, 'local', $2, $3, $4, $5::jsonb)
       ON CONFLICT (mount_key)
       DO UPDATE SET
         root_path = EXCLUDED.root_path,
         access_mode = EXCLUDED.access_mode,
         state = EXCLUDED.state,
         config = ${quotedSchema}.backend_mounts.config || EXCLUDED.config,
         updated_at = NOW()
       RETURNING id`,
      [
        mountKey,
        backendRoot,
        action.accessMode ?? 'rw',
        action.state ?? 'active',
        configJson
      ]
    );
    backendId = result.rows[0]?.id ?? null;
    if (backendId === null || !Number.isFinite(backendId)) {
      throw new Error('failed to resolve backend id after upsert');
    }
    context.logger?.info?.(
      { moduleId: context.moduleId, mountKey, backendId, backendRoot },
      'bootstrap ensured filestore backend'
    );
  } finally {
    await Promise.resolve(pool.end()).catch(() => undefined);
  }

  context.outputs.lastFilestoreBackendId = backendId;
  if (backendId !== null) {
    context.variables.set('LAST_FILESTORE_BACKEND_ID', String(backendId));
  }

  if (action.assign?.placeholders) {
    const assignmentScope = createScope(context);
    for (const [key, template] of Object.entries(action.assign.placeholders)) {
      const value = renderTemplateString(template, assignmentScope);
      context.placeholders.set(key, value);
      context.variables.set(key, value);
    }
  }

  if (action.assign?.variables) {
    const assignmentScope = createScope(context);
    for (const [key, template] of Object.entries(action.assign.variables)) {
      const value = renderTemplateString(template, assignmentScope);
      context.variables.set(key, value);
    }
  }
}

async function writeJsonFile(action: Extract<BootstrapActionSpec, { type: 'writeJsonFile' }>, context: ExecutionContext) {
  const scope = createScope(context);
  const pathRaw = renderTemplateString(action.path, scope).trim();
  if (!pathRaw) {
    throw new Error('writeJsonFile path resolved to an empty string');
  }
  const absolutePath = path.isAbsolute(pathRaw) ? pathRaw : path.resolve(context.workspaceRoot, pathRaw);
  const directory = path.dirname(absolutePath);
  if (action.createParents ?? true) {
    await mkdir(directory, { recursive: true });
  }

  const rendered = renderJsonTemplates(cloneJsonValue(action.content), scope);
  const serialized = (action.pretty ?? true) ? `${JSON.stringify(rendered, null, 2)}\n` : `${JSON.stringify(rendered)}\n`;

  try {
    const existing = await readFile(absolutePath, 'utf8');
    if (existing === serialized) {
      context.logger?.debug?.({ moduleId: context.moduleId, path: absolutePath }, 'bootstrap json file already up to date');
      return;
    }
  } catch {
    // ignore read errors; we'll write the file below
  }

  await writeFile(absolutePath, serialized, 'utf8');
  context.logger?.info?.({ moduleId: context.moduleId, path: absolutePath }, 'bootstrap wrote json file');
}

function applyWorkflowDefaults(
  action: Extract<BootstrapActionSpec, { type: 'applyWorkflowDefaults' }>,
  context: ExecutionContext
) {
  for (const workflow of action.workflows) {
    const scope = createScope(context);
    const slug = renderTemplateString(workflow.slug, scope).trim();
    if (!slug) {
      throw new Error('workflow default slug resolved to an empty string');
    }

    const defaultsRaw = workflow.defaults
      ? renderJsonTemplates(cloneJsonValue(workflow.defaults), scope)
      : {};
    const defaults = ensureJsonObject(defaultsRaw, `workflow defaults for ${slug}`);

    const existing = context.workflowDefaults.get(slug);
    if (!existing || workflow.strategy === 'replace') {
      context.workflowDefaults.set(slug, { ...defaults });
    } else {
      context.workflowDefaults.set(slug, { ...existing, ...defaults });
    }
    context.logger?.debug?.(
      { moduleId: context.moduleId, workflow: slug },
      'bootstrap registered workflow defaults'
    );
  }
}

function setEnvDefaults(action: Extract<BootstrapActionSpec, { type: 'setEnvDefaults' }>, context: ExecutionContext) {
  const scope = createScope(context);
  for (const [key, template] of Object.entries(action.values)) {
    const value = renderTemplateString(template, scope);
    context.placeholders.set(key, value);
    context.variables.set(key, value);
  }
}

async function executeAction(action: BootstrapActionSpec, context: ExecutionContext): Promise<void> {
  switch (action.type) {
    case 'ensureDirectories':
      await ensureDirectories(action, context);
      return;
    case 'ensureFilestoreBackend':
      await ensureFilestoreBackend(action, context);
      return;
    case 'writeJsonFile':
      await writeJsonFile(action, context);
      return;
    case 'applyWorkflowDefaults':
      applyWorkflowDefaults(action, context);
      return;
    case 'setEnvDefaults':
      setEnvDefaults(action, context);
      return;
    default: {
      /* istanbul ignore next */
      const exhaustive: never = action;
      throw new Error(`unsupported bootstrap action ${(exhaustive as { type: string }).type}`);
    }
  }
}

export async function executeBootstrapPlan(
  options: BootstrapExecutionOptions
): Promise<BootstrapExecutionResult> {
  const plan = options.plan ? bootstrapPlanSchema.parse(options.plan) : { actions: [] };
  const placeholders = new Map(options.placeholders.entries());
  const variables = new Map(Object.entries(options.variables ?? {}));
  for (const [key, value] of placeholders.entries()) {
    if (!variables.has(key)) {
      variables.set(key, value);
    }
  }

  const context: ExecutionContext = {
    moduleId: options.moduleId,
    logger: options.logger,
    placeholders,
    variables,
    outputs: {},
    workspaceRoot: determineWorkspaceRoot(options.workspaceRoot),
    warnings: [],
    actions: [],
    workflowDefaults: new Map(),
    poolFactory: options.poolFactory ?? defaultPoolFactory
  };

  if (plan.actions.length === 0) {
    return {
      placeholders: context.placeholders,
      variables: context.variables,
      workflowDefaults: context.workflowDefaults,
      warnings: context.warnings,
      actions: context.actions
    };
  }

  for (const action of plan.actions) {
    context.actions.push({ type: action.type, description: action.description });
    try {
      await executeAction(action, context);
    } catch (err) {
      context.logger?.error?.(
        { moduleId: context.moduleId, action: action.type, description: action.description, err },
        'module bootstrap action failed'
      );
      throw new Error(`bootstrap action ${action.type} failed: ${(err as Error).message}`);
    }
  }

  return {
    placeholders: context.placeholders,
    variables: context.variables,
    workflowDefaults: context.workflowDefaults,
    warnings: context.warnings,
    actions: context.actions
  };
}
