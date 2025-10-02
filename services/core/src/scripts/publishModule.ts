import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { serializeModuleDefinition } from '@apphub/module-sdk';
import {
  ensureDatabase,
  closePool,
  publishModuleArtifact,
  upsertJobDefinition,
  deleteJobDefinitionBySlug,
  getWorkflowDefinitionBySlug,
  createWorkflowDefinition,
  updateWorkflowDefinition,
  listWorkflowEventTriggers,
  createWorkflowEventTrigger,
  updateWorkflowEventTrigger,
  deleteWorkflowEventTrigger,
  listWorkflowSchedulesForDefinition,
  createWorkflowSchedule,
  updateWorkflowSchedule,
  deleteWorkflowSchedule
} from '../db';
import { shutdownApphubEvents } from '../events';
import type { ModuleArtifactPublishResult } from '../db/modules';
import type { ModuleDefinition } from '@apphub/module-sdk';
import type {
  ModuleTargetBinding,
  WorkflowDefinitionRecord,
  WorkflowEventTriggerPredicate,
  WorkflowStepDefinition,
  WorkflowTriggerDefinition,
  JsonValue
} from '../db/types';

interface CliOptions {
  moduleDir: string | null;
  workspace?: string | null;
  skipBuild?: boolean;
  databaseUrl?: string | null;
  artifactContentType?: string | null;
  registerJobs?: boolean;
  help?: boolean;
  unknown?: string[];
}

interface ModuleArtifactInfo {
  manifestPath: string;
  modulePath: string;
  checksum: string;
  size: number;
}

interface JobDefinitionFile {
  slug?: string;
  name?: string;
  defaultParameters?: unknown;
  parametersSchema?: unknown;
  outputSchema?: unknown;
  metadata?: unknown;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { moduleDir: null, unknown: [] };
  for (let idx = 0; idx < argv.length; idx += 1) {
    const arg = argv[idx];
    switch (arg) {
      case '--module':
      case '-m':
        options.moduleDir = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--workspace':
      case '-w':
        options.workspace = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--database-url':
        options.databaseUrl = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--artifact-content-type':
        options.artifactContentType = argv[idx + 1] ?? null;
        idx += 1;
        break;
      case '--register-jobs':
        options.registerJobs = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        options.unknown?.push(arg);
        break;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`Usage: npm run module:publish -- --module <path> [options]\n\n` +
    `Options:\n` +
    `  --module, -m <path>          Path to the module workspace directory (required)\n` +
    `  --workspace, -w <name>       Optional npm workspace name to build via npm run build --workspace\n` +
    `  --skip-build                 Skip running the module build step\n` +
    `  --database-url <url>         Override DATABASE_URL when publishing\n` +
    `  --artifact-content-type <t>  Override artifact content type (default: application/javascript)\n` +
    `  --register-jobs              Upsert job definitions for module job targets after publish\n` +
    `  --help, -h                   Show this help message\n`);
}

async function runCommand(command: string, args: string[], options: { cwd?: string } = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const spawned = spawn(command, args, {
      stdio: 'inherit',
      cwd: options.cwd ?? process.cwd(),
      env: process.env
    });
    spawned.on('error', reject);
    spawned.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function buildModule(options: { moduleDir: string; workspace?: string | null }): Promise<void> {
  if (options.workspace) {
    await runCommand('npm', ['run', 'build', '--workspace', options.workspace]);
    return;
  }
  await runCommand('npm', ['run', 'build'], { cwd: options.moduleDir });
}

async function loadModuleDefinition(modulePath: string): Promise<ModuleDefinition> {
  const moduleUrl = pathToFileURL(modulePath).href;
  const loaded = await import(moduleUrl);
  const definition: ModuleDefinition | undefined = loaded.default ?? loaded.module ?? null;
  if (!definition || typeof definition !== 'object') {
    throw new Error(`Module definition not found in ${modulePath}`);
  }
  return definition as ModuleDefinition;
}

async function ensureFileExists(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch (error) {
    throw new Error(`File not found: ${filePath}`);
  }
}

async function writeManifest(manifestPath: string, data: unknown): Promise<void> {
  const serialized = JSON.stringify(data, null, 2);
  await fs.writeFile(manifestPath, serialized, 'utf8');
}

async function computeArtifactInfo(modulePath: string, manifestPath: string): Promise<ModuleArtifactInfo> {
  const artifactData = await fs.readFile(modulePath);
  const stats = await fs.stat(modulePath);
  const checksum = createHash('sha256').update(artifactData).digest('hex');
  await ensureFileExists(manifestPath);
  return {
    manifestPath,
    modulePath,
    checksum,
    size: stats.size
  } satisfies ModuleArtifactInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadModuleJobDefinition(
  moduleDir: string | undefined,
  candidates: Iterable<string>
): Promise<JobDefinitionFile | null> {
  if (!moduleDir) {
    return null;
  }
  const tried = new Set<string>();
  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || tried.has(normalized)) {
      continue;
    }
    tried.add(normalized);
    const jobDefinitionPath = path.join(moduleDir, 'dist', 'bundles', normalized, 'job-definition.json');
    try {
      const raw = await fs.readFile(jobDefinitionPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) {
        return parsed as JobDefinitionFile;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn('[module:publish] Failed to read job definition', { jobDefinitionPath, error });
      }
    }
  }
  return null;
}

async function registerModuleJobs(
  result: ModuleArtifactPublishResult,
  options: { moduleDir?: string } = {}
): Promise<void> {
  if (!result.targets || result.targets.length === 0) {
    console.log('[module:publish] No module targets to register');
    return;
  }

  const jobs = result.targets.filter((target) => target.kind === 'job');
  if (jobs.length === 0) {
    console.log('[module:publish] No job targets found; skipping job definition registration');
    return;
  }

  const moduleDir = options.moduleDir;

  for (const target of jobs) {
    const binding: ModuleTargetBinding = {
      moduleId: result.module.id,
      moduleVersion: result.artifact.version,
      moduleArtifactId: result.artifact.id,
      targetName: target.name,
      targetVersion: target.version,
      targetFingerprint: target.fingerprint ?? null
    };

    const preferredSlugCandidate = (target.metadata as { job?: { slug?: string } } | null | undefined)?.job?.slug;
    const primarySlug = typeof preferredSlugCandidate === 'string' && preferredSlugCandidate.trim().length > 0
      ? preferredSlugCandidate.trim()
      : target.name;

    let slug = primarySlug;
    let displayName = target.displayName ?? target.name;

    const metadataShape = target.metadata as
      | {
          job?: { slug?: string; name?: string };
          parameters?: { defaults?: JsonValue; schema?: JsonValue };
          output?: { schema?: JsonValue };
        }
      | undefined;

    let defaultParameters: JsonValue = metadataShape?.parameters?.defaults ?? {};
    let parametersSchema: JsonValue = metadataShape?.parameters?.schema ?? {};
    let outputSchema: JsonValue = metadataShape?.output?.schema ?? {};

    const jobDefinition = await loadModuleJobDefinition(moduleDir, [
      target.name,
      primarySlug,
      preferredSlugCandidate ?? ''
    ]);
    if (jobDefinition) {
      if (typeof jobDefinition.slug === 'string' && jobDefinition.slug.trim().length > 0) {
        slug = jobDefinition.slug.trim();
      }
      if (typeof jobDefinition.name === 'string' && jobDefinition.name.trim().length > 0) {
        displayName = jobDefinition.name.trim();
      }
      if (jobDefinition.defaultParameters !== undefined) {
        defaultParameters = jobDefinition.defaultParameters as JsonValue;
      }
      if (jobDefinition.parametersSchema !== undefined) {
        parametersSchema = jobDefinition.parametersSchema as JsonValue;
      }
      if (jobDefinition.outputSchema !== undefined) {
        outputSchema = jobDefinition.outputSchema as JsonValue;
      }
    }

    const jobMetadata: JsonValue = {
      module: {
        id: result.module.id,
        version: result.artifact.version,
        targetName: target.name,
        targetVersion: target.version,
        fingerprint: target.fingerprint ?? null
      }
    };

    await upsertJobDefinition({
      slug,
      name: displayName,
      type: 'batch',
      runtime: 'module',
      entryPoint: `module://${result.module.id}/${target.name}`,
      version: 1,
      defaultParameters,
      parametersSchema,
      metadata: jobMetadata,
      outputSchema,
      moduleBinding: binding
    });

    const legacySlug = `${result.module.id}.${target.name}`;
    if (legacySlug !== slug) {
      await deleteJobDefinitionBySlug(legacySlug);
    }

    console.log('[module:publish] Registered job definition', {
      slug,
      moduleId: binding.moduleId,
      targetName: binding.targetName,
      targetVersion: binding.targetVersion
    });
  }
}

interface WorkflowTargetContext {
  moduleId: string;
  targetName: string;
  targetVersion: string | null | undefined;
  defaultParameters: Record<string, unknown>;
}

const DEFAULT_PARAMETER_EXACT_PATTERN = /^\{\{\s*defaultParameters\.([A-Za-z0-9_.-]+)\s*}}$/;
const DEFAULT_PARAMETER_GLOBAL_PATTERN = /\{\{\s*defaultParameters\.([A-Za-z0-9_.-]+)\s*}}/g;

function toDefaultParameterRecord(value: JsonValue | null | undefined): Record<string, unknown> {
  if (isPlainObject(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function resolveDefaultParameterValue(
  path: string,
  context: WorkflowTargetContext
): JsonValue | undefined {
  const segments = path.split('.');
  let current: unknown = context.defaultParameters;

  for (const segment of segments) {
    if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, segment)) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      if (Number.isInteger(index) && index >= 0 && index < current.length) {
        current = current[index];
        continue;
      }
    }

    console.warn('[module:publish] Missing default parameter reference', {
      moduleId: context.moduleId,
      targetName: context.targetName,
      targetVersion: context.targetVersion,
      placeholder: path
    });
    return undefined;
  }

  return current as JsonValue;
}

function resolveDefaultParameterString(
  value: string | null,
  context: WorkflowTargetContext
): string | null {
  if (!value) {
    return value;
  }

  const match = value.trim().match(DEFAULT_PARAMETER_EXACT_PATTERN);
  if (match) {
    const resolved = resolveDefaultParameterValue(match[1], context);
    if (resolved === undefined) {
      return value;
    }
    if (resolved === null) {
      return '';
    }
    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }
    return String(resolved);
  }

  return value.replace(DEFAULT_PARAMETER_GLOBAL_PATTERN, (_, expression) => {
    const resolved = resolveDefaultParameterValue(expression, context);
    if (resolved === undefined || resolved === null) {
      return '';
    }
    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }
    return String(resolved);
  });
}

function resolveDefaultParameterJsonValue(
  value: JsonValue | null,
  context: WorkflowTargetContext
): JsonValue | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const match = trimmed.match(DEFAULT_PARAMETER_EXACT_PATTERN);
    if (match) {
      const resolved = resolveDefaultParameterValue(match[1], context);
      if (resolved === undefined) {
        return value;
      }
      return (resolved ?? null) as JsonValue | null;
    }

    const replaced = value.replace(DEFAULT_PARAMETER_GLOBAL_PATTERN, (_, expression) => {
      const resolved = resolveDefaultParameterValue(expression, context);
      if (resolved === undefined || resolved === null) {
        return '';
      }
      if (typeof resolved === 'object') {
        return JSON.stringify(resolved);
      }
      return String(resolved);
    });
    return replaced;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => resolveDefaultParameterJsonValue(entry as JsonValue, context) as JsonValue);
  }

  if (isPlainObject(value)) {
    const output: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = resolveDefaultParameterJsonValue(entry as JsonValue, context) as JsonValue;
    }
    return output;
  }

  return value;
}

function resolveTriggerPredicatesWithDefaults(
  predicates: WorkflowEventTriggerPredicate[],
  context: WorkflowTargetContext
): WorkflowEventTriggerPredicate[] {
  return predicates.map((predicate) => {
    switch (predicate.operator) {
      case 'equals':
      case 'notEquals':
      case 'contains':
        return {
          ...predicate,
          value: resolveDefaultParameterJsonValue(predicate.value ?? null, context) ?? predicate.value
        };
      case 'in':
      case 'notIn':
        return {
          ...predicate,
          values: predicate.values.map(
            (entry) => resolveDefaultParameterJsonValue(entry ?? null, context) ?? entry
          )
        };
      case 'regex':
        return {
          ...predicate,
          value: resolveDefaultParameterString(predicate.value, context) ?? predicate.value
        };
      default:
        return predicate;
    }
  });
}

interface DesiredTrigger {
  key: string;
  name: string | null;
  description: string | null;
  eventType: string;
  eventSource: string | null;
  predicates: WorkflowEventTriggerPredicate[];
  parameterTemplate: JsonValue | null;
  runKeyTemplate: string | null;
  idempotencyKeyExpression: string | null;
  throttleWindowMs: number | null;
  throttleCount: number | null;
  maxConcurrency: number | null;
  metadata: JsonValue | null;
  status: 'active' | 'disabled';
}

interface DesiredSchedule {
  key: string;
  name: string | null;
  description: string | null;
  cron: string;
  timezone: string | null;
  parameters: JsonValue | null;
  startWindow: string | null;
  endWindow: string | null;
  catchUp: boolean;
  isActive: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function coerceJsonValue(value: unknown): JsonValue | null {
  if (value === undefined) {
    return null;
  }
  return value as JsonValue;
}

function buildTriggerKey(name: string | null | undefined, eventType: string, eventSource: string | null | undefined): string {
  const normalizedName = typeof name === 'string' ? name.trim().toLowerCase() : '';
  const normalizedType = eventType.trim().toLowerCase();
  const normalizedSource = typeof eventSource === 'string' ? eventSource.trim().toLowerCase() : '';
  return `${normalizedName}::${normalizedType}::${normalizedSource}`;
}

function buildScheduleKey(name: string | null | undefined, fallback: string): string {
  const normalizedName = typeof name === 'string' && name.trim().length > 0 ? name.trim().toLowerCase() : '';
  return normalizedName || fallback;
}

function sanitizeTriggerPredicate(input: unknown): WorkflowEventTriggerPredicate | null {
  if (!isPlainObject(input)) {
    return null;
  }
  const path = typeof input.path === 'string' && input.path.trim().length > 0 ? input.path : null;
  const operator = typeof input.operator === 'string' ? input.operator : null;
  if (!path || !operator) {
    return null;
  }

  const base: Record<string, unknown> = {
    type: 'jsonPath',
    path,
    operator
  };

  if ('caseSensitive' in input) {
    base.caseSensitive = Boolean((input as Record<string, unknown>).caseSensitive);
  }

  switch (operator) {
    case 'exists':
      break;
    case 'equals':
    case 'notEquals':
    case 'contains':
      base.value = 'value' in input ? (input as Record<string, unknown>).value ?? null : null;
      break;
    case 'in':
    case 'notIn': {
      const values = (input as Record<string, unknown>).values;
      base.values = Array.isArray(values) ? (values as JsonValue[]) : [];
      break;
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const rawValue = (input as Record<string, unknown>).value;
      const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
      if (!Number.isFinite(numeric)) {
        return null;
      }
      base.value = numeric;
      break;
    }
    case 'regex': {
      const regexValue = typeof (input as Record<string, unknown>).value === 'string'
        ? ((input as Record<string, unknown>).value as string)
        : '';
      if (!regexValue) {
        return null;
      }
      base.value = regexValue;
      if (typeof (input as Record<string, unknown>).flags === 'string') {
        base.flags = (input as Record<string, unknown>).flags;
      }
      break;
    }
    default:
      return null;
  }

  return base as WorkflowEventTriggerPredicate;
}

function buildDesiredTrigger(
  raw: unknown,
  index: number,
  context: WorkflowTargetContext
): DesiredTrigger | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const eventTypeRaw = raw.eventType;
  const eventType = typeof eventTypeRaw === 'string' ? eventTypeRaw.trim() : '';
  if (!eventType) {
    return null;
  }

  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : null;
  const description = typeof raw.description === 'string' ? raw.description : null;
  const eventSource = typeof raw.eventSource === 'string' && raw.eventSource.trim().length > 0 ? raw.eventSource.trim() : null;
  const status = raw.enabled === false ? 'disabled' : 'active';
  const predicatesRaw = Array.isArray(raw.predicates) ? raw.predicates : [];
  const predicates = predicatesRaw
    .map((predicate, predicateIndex) => {
      const sanitized = sanitizeTriggerPredicate(predicate);
      if (!sanitized) {
        console.warn('[module:publish] Skipping invalid workflow trigger predicate', {
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          index,
          predicateIndex
        });
      }
      return sanitized;
    })
    .filter((predicate): predicate is WorkflowEventTriggerPredicate => predicate !== null);

  const throttle = isPlainObject(raw.throttle) ? (raw.throttle as Record<string, unknown>) : null;
  const throttleWindowMsRaw = throttle?.windowMs;
  const throttleCountRaw = throttle?.count;
  const maxConcurrencyRaw = raw.maxConcurrency;

  const key = buildTriggerKey(name, eventType, eventSource) || `${context.targetName}::trigger::${index}`;

  return {
    key,
    name,
    description,
    eventType,
    eventSource,
    predicates: resolveTriggerPredicatesWithDefaults(predicates, context),
    parameterTemplate: resolveDefaultParameterJsonValue(
      coerceJsonValue(raw.parameterTemplate ?? null),
      context
    ),
    runKeyTemplate:
      typeof raw.runKeyTemplate === 'string'
        ? resolveDefaultParameterString(raw.runKeyTemplate, context)
        : null,
    idempotencyKeyExpression:
      typeof raw.idempotencyKeyExpression === 'string'
        ? resolveDefaultParameterString(raw.idempotencyKeyExpression, context)
        : null,
    throttleWindowMs:
      typeof throttleWindowMsRaw === 'number'
        ? throttleWindowMsRaw
        : Number.isFinite(Number(throttleWindowMsRaw))
          ? Number(throttleWindowMsRaw)
          : null,
    throttleCount:
      typeof throttleCountRaw === 'number'
        ? throttleCountRaw
        : Number.isFinite(Number(throttleCountRaw))
          ? Number(throttleCountRaw)
          : null,
    maxConcurrency:
      typeof maxConcurrencyRaw === 'number'
        ? maxConcurrencyRaw
        : Number.isFinite(Number(maxConcurrencyRaw))
          ? Number(maxConcurrencyRaw)
          : null,
    metadata: resolveDefaultParameterJsonValue(coerceJsonValue(raw.metadata ?? null), context),
    status
  } satisfies DesiredTrigger;
}

function buildDesiredSchedule(
  raw: unknown,
  index: number,
  context: WorkflowTargetContext
): DesiredSchedule | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const cron = typeof raw.cron === 'string' ? raw.cron.trim() : '';
  if (!cron) {
    return null;
  }

  const rawName = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : null;
  const rawDescription = typeof raw.description === 'string' ? raw.description : null;
  const rawTimezone = typeof raw.timezone === 'string' && raw.timezone.trim().length > 0 ? raw.timezone.trim() : null;
  const rawParameters = coerceJsonValue(raw.parameterTemplate ?? null);
  const rawStartWindow = typeof raw.startWindow === 'string' ? raw.startWindow : null;
  const rawEndWindow = typeof raw.endWindow === 'string' ? raw.endWindow : null;

  const name = resolveDefaultParameterString(rawName, context);
  const description = resolveDefaultParameterString(rawDescription, context);
  const timezone = resolveDefaultParameterString(rawTimezone, context);
  const parameters = resolveDefaultParameterJsonValue(rawParameters, context);
  const startWindow = resolveDefaultParameterString(rawStartWindow, context);
  const endWindow = resolveDefaultParameterString(rawEndWindow, context);

  let catchUp = true;
  if (typeof raw.catchUp === 'boolean') {
    catchUp = raw.catchUp;
  } else if (isPlainObject(raw.metadata) && typeof raw.metadata.catchUp === 'boolean') {
    catchUp = raw.metadata.catchUp as boolean;
  }

  const isActive = raw.enabled === false ? false : true;

  const keyFallback = `${context.targetName}::schedule::${index}`;
  const key = buildScheduleKey(name, keyFallback);

  return {
    key,
    name,
    description,
    cron,
    timezone,
    parameters,
    startWindow,
    endWindow,
    catchUp,
    isActive
  } satisfies DesiredSchedule;
}

async function syncWorkflowTriggers(
  definition: WorkflowDefinitionRecord,
  rawTriggers: unknown,
  context: WorkflowTargetContext
): Promise<void> {
  const triggerArray = Array.isArray(rawTriggers) ? rawTriggers : [];
  const desiredTriggers = triggerArray
    .map((entry, index) => buildDesiredTrigger(entry, index, context))
    .filter((entry): entry is DesiredTrigger => entry !== null);

  const existingTriggers = await listWorkflowEventTriggers({ workflowDefinitionId: definition.id });
  type ExistingTriggerRecord = (typeof existingTriggers)[number];
  const existingMap = new Map<string, ExistingTriggerRecord>();
  existingTriggers.forEach((trigger) => {
    const key = buildTriggerKey(trigger.name, trigger.eventType, trigger.eventSource);
    existingMap.set(key || `existing::${trigger.id}`, trigger);
  });

  const processedKeys = new Set<string>();

  for (const desired of desiredTriggers) {
    const existing = existingMap.get(desired.key);
    if (!existing) {
      try {
        await createWorkflowEventTrigger({
          workflowDefinitionId: definition.id,
          name: desired.name,
          description: desired.description,
          eventType: desired.eventType,
          eventSource: desired.eventSource,
          predicates: desired.predicates,
          parameterTemplate: desired.parameterTemplate,
          runKeyTemplate: desired.runKeyTemplate,
          throttleWindowMs: desired.throttleWindowMs,
          throttleCount: desired.throttleCount,
          maxConcurrency: desired.maxConcurrency,
          idempotencyKeyExpression: desired.idempotencyKeyExpression,
          metadata: desired.metadata,
          status: desired.status,
          createdBy: 'module:publish'
        });
        console.log('[module:publish] Registered workflow trigger', {
          workflowSlug: definition.slug,
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          name: desired.name ?? desired.key
        });
      } catch (error) {
        console.error('[module:publish] Failed to register workflow trigger', {
          workflowSlug: definition.slug,
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          name: desired.name ?? desired.key,
          error
        });
      }
    } else {
      try {
        await updateWorkflowEventTrigger(existing.id, {
          name: desired.name,
          description: desired.description,
          eventType: desired.eventType,
          eventSource: desired.eventSource,
          predicates: desired.predicates,
          parameterTemplate: desired.parameterTemplate,
          runKeyTemplate: desired.runKeyTemplate,
          throttleWindowMs: desired.throttleWindowMs,
          throttleCount: desired.throttleCount,
          maxConcurrency: desired.maxConcurrency,
          idempotencyKeyExpression: desired.idempotencyKeyExpression,
          metadata: desired.metadata,
          status: desired.status,
          updatedBy: 'module:publish'
        });
      } catch (error) {
        console.error('[module:publish] Failed to update workflow trigger', {
          workflowSlug: definition.slug,
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          name: desired.name ?? desired.key,
          error
        });
      }
    }

    processedKeys.add(desired.key);
  }

  for (const [key, trigger] of existingMap.entries()) {
    if (processedKeys.has(key)) {
      continue;
    }
    try {
      await deleteWorkflowEventTrigger(trigger.id);
      console.log('[module:publish] Removed workflow trigger not present in module metadata', {
        workflowSlug: definition.slug,
        moduleId: context.moduleId,
        targetName: context.targetName,
        targetVersion: context.targetVersion,
        name: trigger.name ?? key
      });
    } catch (error) {
      console.error('[module:publish] Failed to delete workflow trigger', {
        workflowSlug: definition.slug,
        moduleId: context.moduleId,
        targetName: context.targetName,
        targetVersion: context.targetVersion,
        name: trigger.name ?? key,
        error
      });
    }
  }
}

async function syncWorkflowSchedules(
  definition: WorkflowDefinitionRecord,
  rawSchedules: unknown,
  context: WorkflowTargetContext
): Promise<void> {
  const scheduleArray = Array.isArray(rawSchedules) ? rawSchedules : [];
  const desiredSchedules = scheduleArray
    .map((entry, index) => buildDesiredSchedule(entry, index, context))
    .filter((entry): entry is DesiredSchedule => entry !== null);

  const existingSchedules = await listWorkflowSchedulesForDefinition(definition.id);
  type ExistingScheduleRecord = (typeof existingSchedules)[number];
  const existingMap = new Map<string, ExistingScheduleRecord>();
  existingSchedules.forEach((schedule) => {
    const key = buildScheduleKey(schedule.name, schedule.id);
    existingMap.set(key, schedule);
  });

  const processedKeys = new Set<string>();

  for (const desired of desiredSchedules) {
    const existing = existingMap.get(desired.key);
    if (!existing) {
      try {
        await createWorkflowSchedule({
          workflowDefinitionId: definition.id,
          name: desired.name,
          description: desired.description,
          cron: desired.cron,
          timezone: desired.timezone ?? undefined,
          parameters: desired.parameters,
          startWindow: desired.startWindow ?? null,
          endWindow: desired.endWindow ?? null,
          catchUp: desired.catchUp,
          isActive: desired.isActive
        });
        console.log('[module:publish] Registered workflow schedule', {
          workflowSlug: definition.slug,
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          name: desired.name ?? desired.key
        });
      } catch (error) {
        console.error('[module:publish] Failed to register workflow schedule', {
          workflowSlug: definition.slug,
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          name: desired.name ?? desired.key,
          error
        });
      }
    } else {
      try {
        await updateWorkflowSchedule(existing.id, {
          name: desired.name,
          description: desired.description,
          cron: desired.cron,
          timezone: desired.timezone ?? null,
          parameters: desired.parameters,
          startWindow: desired.startWindow ?? null,
          endWindow: desired.endWindow ?? null,
          catchUp: desired.catchUp,
          isActive: desired.isActive
        });
      } catch (error) {
        console.error('[module:publish] Failed to update workflow schedule', {
          workflowSlug: definition.slug,
          moduleId: context.moduleId,
          targetName: context.targetName,
          targetVersion: context.targetVersion,
          name: desired.name ?? desired.key,
          error
        });
      }
    }

    processedKeys.add(desired.key);
  }

  for (const [key, schedule] of existingMap.entries()) {
    if (processedKeys.has(key)) {
      continue;
    }
    try {
      await deleteWorkflowSchedule(schedule.id);
      console.log('[module:publish] Removed workflow schedule not present in module metadata', {
        workflowSlug: definition.slug,
        moduleId: context.moduleId,
        targetName: context.targetName,
        targetVersion: context.targetVersion,
        name: schedule.name ?? key
      });
    } catch (error) {
      console.error('[module:publish] Failed to delete workflow schedule', {
        workflowSlug: definition.slug,
        moduleId: context.moduleId,
        targetName: context.targetName,
        targetVersion: context.targetVersion,
        name: schedule.name ?? key,
        error
      });
    }
  }
}

async function registerModuleWorkflows(result: ModuleArtifactPublishResult): Promise<void> {
  if (!result.targets || result.targets.length === 0) {
    return;
  }

  const workflows = result.targets.filter((target) => target.kind === 'workflow');
  if (workflows.length === 0) {
    console.log('[module:publish] No workflow targets found; skipping workflow registration');
    return;
  }

  for (const target of workflows) {
    const workflowMeta = (target.metadata as { workflow?: unknown } | null | undefined)?.workflow;
    if (!isPlainObject(workflowMeta)) {
      console.warn('[module:publish] Workflow target missing definition; skipping', {
        moduleId: result.module.id,
        targetName: target.name
      });
      continue;
    }

    const workflowConfig = workflowMeta as Record<string, unknown>;
    const definitionValue = workflowConfig.definition;
    if (!isPlainObject(definitionValue)) {
      console.warn('[module:publish] Workflow target missing definition; skipping', {
        moduleId: result.module.id,
        targetName: target.name
      });
      continue;
    }

    const definitionData = definitionValue as Record<string, unknown>;

    const slugRaw = (definitionData.slug ?? target.name) as string;
    const slug = typeof slugRaw === 'string' ? slugRaw.trim() : target.name;
    if (!slug) {
      console.warn('[module:publish] Workflow target missing slug; skipping', {
        moduleId: result.module.id,
        targetName: target.name
      });
      continue;
    }

    const nameCandidate = definitionData.name ?? target.displayName ?? target.name;
    const name = typeof nameCandidate === 'string' && nameCandidate.trim().length > 0 ? nameCandidate.trim() : slug;
    const description =
      typeof definitionData.description === 'string'
        ? (definitionData.description as string)
        : target.description ?? null;
    const versionValue = typeof definitionData.version === 'number' ? (definitionData.version as number) : Number(target.version ?? '1');
    const version = Number.isFinite(versionValue) && versionValue > 0 ? Math.trunc(versionValue) : 1;
    const stepsValue = Array.isArray(definitionData.steps)
      ? (definitionData.steps as WorkflowStepDefinition[])
      : ([] as WorkflowStepDefinition[]);
    const steps = stepsValue;
    if (steps.length === 0) {
      console.warn('[module:publish] Workflow target has no steps; skipping', {
        moduleId: result.module.id,
        targetName: target.name,
        slug
      });
      continue;
    }

    const moduleMetadata = {
      id: result.module.id,
      version: result.artifact.version,
      targetName: target.name,
      targetVersion: target.version,
      fingerprint: target.fingerprint ?? null
    } as const;

    const metadataRecord: Record<string, unknown> = { module: moduleMetadata };
    if (isPlainObject(definitionData.metadata)) {
      Object.assign(metadataRecord, definitionData.metadata as Record<string, unknown>);
    }

    const metadata: JsonValue = metadataRecord as JsonValue;

    const definitionTriggers = Array.isArray(definitionData.triggers)
      ? (definitionData.triggers as WorkflowTriggerDefinition[])
      : undefined;

    const parametersSchemaValue: JsonValue = isPlainObject(definitionData.parametersSchema)
      ? (definitionData.parametersSchema as JsonValue)
      : {};
    const defaultParametersValue: JsonValue = isPlainObject(definitionData.defaultParameters)
      ? (definitionData.defaultParameters as JsonValue)
      : {};
    const outputSchemaValue: JsonValue = {};

    const definitionInput = {
      slug,
      name,
      version,
      description,
      steps,
      triggers: definitionTriggers,
      parametersSchema: parametersSchemaValue,
      defaultParameters: defaultParametersValue,
      outputSchema: outputSchemaValue,
      metadata
    } satisfies Parameters<typeof createWorkflowDefinition>[0];

    let definitionRecord: WorkflowDefinitionRecord | null = null;
    const existing = await getWorkflowDefinitionBySlug(slug);
    if (!existing) {
      definitionRecord = await createWorkflowDefinition(definitionInput);
      console.log('[module:publish] Registered workflow definition', {
        slug: definitionRecord.slug,
        moduleId: moduleMetadata.id,
        targetName: target.name,
        targetVersion: target.version
      });
    } else {
      const updated = await updateWorkflowDefinition(slug, {
        name,
        version,
        description,
        steps,
        triggers: definitionInput.triggers,
        parametersSchema: definitionInput.parametersSchema,
        defaultParameters: definitionInput.defaultParameters,
        outputSchema: definitionInput.outputSchema,
        metadata: definitionInput.metadata
      });

      definitionRecord = updated ?? existing;

      console.log('[module:publish] Updated workflow definition', {
        slug,
        moduleId: moduleMetadata.id,
        targetName: target.name,
        targetVersion: target.version
      });
    }

    if (!definitionRecord) {
      definitionRecord = await getWorkflowDefinitionBySlug(slug);
    }

    if (!definitionRecord) {
      console.warn('[module:publish] Unable to resolve workflow definition record for trigger/schedule sync', {
        moduleId: moduleMetadata.id,
        targetName: target.name,
        targetVersion: target.version,
        slug
      });
      continue;
    }

    const defaultParametersRecord = toDefaultParameterRecord(definitionRecord.defaultParameters);

    const workflowContext: WorkflowTargetContext = {
      moduleId: moduleMetadata.id,
      targetName: target.name,
      targetVersion: target.version,
      defaultParameters: defaultParametersRecord
    };

    await syncWorkflowTriggers(definitionRecord, workflowConfig.triggers, workflowContext);

    await syncWorkflowSchedules(definitionRecord, workflowConfig.schedules, workflowContext);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.moduleDir) {
    printHelp();
    throw new Error('Missing required --module argument');
  }

  const moduleDir = path.resolve(process.cwd(), options.moduleDir);
  const distDir = path.join(moduleDir, 'dist');
  const moduleJsPath = path.join(distDir, 'module.js');
  const manifestPath = path.join(distDir, 'module.json');

  const modulePkgRaw = await fs.readFile(path.join(moduleDir, 'package.json'), 'utf8');
  const modulePkg = JSON.parse(modulePkgRaw) as { name?: string };

  if (!options.skipBuild) {
    await buildModule({ moduleDir, workspace: options.workspace ?? modulePkg.name ?? null });
  }

  await ensureFileExists(moduleJsPath);

  const moduleDefinition = await loadModuleDefinition(moduleJsPath);
  const manifest = serializeModuleDefinition(moduleDefinition);

  await writeManifest(manifestPath, manifest);

  const artifactInfo = await computeArtifactInfo(moduleJsPath, manifestPath);

  if (options.databaseUrl) {
    process.env.DATABASE_URL = options.databaseUrl;
  }

  await ensureDatabase();

  const artifactRecord = await publishModuleArtifact({
    moduleId: manifest.metadata.name,
    moduleVersion: manifest.metadata.version,
    displayName: manifest.metadata.displayName ?? null,
    description: manifest.metadata.description ?? null,
    keywords: manifest.metadata.keywords ?? [],
    manifest,
    artifactPath: artifactInfo.modulePath,
    artifactChecksum: artifactInfo.checksum,
    artifactStorage: 'filesystem',
    artifactContentType: options.artifactContentType ?? 'application/javascript',
    artifactSize: artifactInfo.size
  });

  console.log('\nModule publication complete:');
  console.log(`  Module:   ${artifactRecord.module.id}@${artifactRecord.artifact.version}`);
  console.log(`  Targets:  ${artifactRecord.targets.length}`);
  console.log(`  Manifest: ${path.relative(process.cwd(), artifactInfo.manifestPath)}`);
  console.log(`  Bundle:   ${path.relative(process.cwd(), artifactInfo.modulePath)} (sha256 ${artifactInfo.checksum})`);

  if (options.registerJobs) {
    await registerModuleJobs(artifactRecord, { moduleDir });
    await registerModuleWorkflows(artifactRecord);
  }
}

main()
  .catch(async (error) => {
    console.error('[module:publish] Failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await shutdownApphubEvents();
    } catch (err) {
      if (err) {
        console.warn('[module:publish] Failed to shut down event bus', err);
      }
    }
    try {
      await closePool();
    } catch (err) {
      if (err) {
        console.warn('[module:publish] Failed to close DB pool', err);
      }
    }
  });
