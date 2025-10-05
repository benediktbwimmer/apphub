import type { ModuleContext } from './context';
import {
  requireCapabilities,
  type CapabilitiesWith,
  type CapabilityKey,
  type CapabilitySelector,
  type ModuleCapabilityOverrides
} from './runtime/capabilities';
import type { ValueDescriptor } from './types';

export type ModuleTargetKind = 'job' | 'service' | 'workflow';

const inheritSettingsSymbol = Symbol('module-target-settings-inherit');
const inheritSecretsSymbol = Symbol('module-target-secrets-inherit');

export const INHERIT_MODULE_SETTINGS = inheritSettingsSymbol;
export const INHERIT_MODULE_SECRETS = inheritSecretsSymbol;

export type InheritModuleSettings = typeof inheritSettingsSymbol;
export type InheritModuleSecrets = typeof inheritSecretsSymbol;

export function inheritModuleSettings(): InheritModuleSettings {
  return inheritSettingsSymbol;
}

export function inheritModuleSecrets(): InheritModuleSecrets {
  return inheritSecretsSymbol;
}

type SelectorBase<S extends CapabilitySelector> = S extends `${infer Base}.${string}`
  ? Extract<Base, CapabilityKey>
  : Extract<S, CapabilityKey>;

type SelectorBaseUnion<T extends readonly CapabilitySelector[]> = SelectorBase<T[number]>;

export interface ModuleTargetBase<
  TSettings,
  TSecrets,
  TRequired extends readonly CapabilitySelector[] = readonly CapabilitySelector[]
> {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  capabilityOverrides?: ModuleCapabilityOverrides;
  requires?: TRequired;
  settings?: ValueDescriptor<TSettings> | InheritModuleSettings;
  secrets?: ValueDescriptor<TSecrets> | InheritModuleSecrets;
}

type CapabilityContext<
  TContext,
  TRequired extends readonly CapabilitySelector[]
> = TRequired extends []
  ? TContext
  : TContext & { capabilities: CapabilitiesWith<SelectorBaseUnion<TRequired>> };

export interface JobContext<
  TSettings,
  TSecrets,
  TParameters = Record<string, unknown>
> extends ModuleContext<TSettings, TSecrets> {
  job: {
    name: string;
    version: string;
  };
  parameters: TParameters;
}

export type JobHandler<
  TSettings,
  TSecrets,
  TParameters,
  TResult,
  TRequired extends readonly CapabilitySelector[] = []
> = (
  context: CapabilityContext<JobContext<TSettings, TSecrets, TParameters>, TRequired>
) => Promise<TResult> | TResult;

export interface ServiceContext<TSettings, TSecrets> extends ModuleContext<TSettings, TSecrets> {
  service: {
    name: string;
    version: string;
  };
}

export interface ServiceLifecycle {
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}

export interface ServiceRegistrationUiHints {
  previewPath?: string;
  spa?: boolean;
  icon?: string;
  description?: string;
}

export interface ServiceRegistration {
  slug: string;
  kind?: string;
  healthEndpoint: string;
  defaultPort?: number;
  basePath?: string;
  tags?: string[];
  env?: Record<string, string>;
  metadata?: Record<string, unknown>;
  ui?: ServiceRegistrationUiHints;
}

export type ServiceHandler<
  TSettings,
  TSecrets,
  TService extends ServiceLifecycle,
  TRequired extends readonly CapabilitySelector[] = []
> = (
  context: CapabilityContext<ServiceContext<TSettings, TSecrets>, TRequired>
) => Promise<TService> | TService;

export type WorkflowStepDefinition = Record<string, unknown>;

export interface WorkflowDefinition {
  slug: string;
  name?: string;
  version?: number;
  description?: string;
  defaultParameters?: Record<string, unknown>;
  parametersSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  steps: WorkflowStepDefinition[];
}

export type WorkflowTriggerPredicateOperator =
  | 'equals'
  | 'notEquals'
  | 'in'
  | 'notIn'
  | 'exists'
  | 'contains'
  | 'regex';

export interface WorkflowTriggerPredicate {
  path: string;
  operator: WorkflowTriggerPredicateOperator;
  value?: unknown;
  values?: unknown[];
}

export interface WorkflowTriggerThrottle {
  windowMs?: number | null;
  count?: number | null;
}

export interface WorkflowTriggerDefinition {
  name: string;
  description?: string;
  eventType: string;
  eventSource?: string | null;
  parameterTemplate?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  idempotencyKeyExpression?: string;
  runKeyTemplate?: string;
  maxConcurrency?: number | null;
  throttle?: WorkflowTriggerThrottle | null;
  predicates?: WorkflowTriggerPredicate[];
}

export interface WorkflowScheduleDefinition {
  name: string;
  description?: string;
  cron: string;
  timezone?: string;
  parameterTemplate?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  pauseUntil?: string | Date | null;
  enabled?: boolean;
}

export interface JobTargetDefinition<
  TSettings,
  TSecrets,
  TParameters,
  TResult,
  TRequired extends readonly CapabilitySelector[] = []
> extends ModuleTargetBase<TSettings, TSecrets, TRequired> {
  kind: 'job';
  parameters?: ValueDescriptor<TParameters>;
  handler: JobHandler<TSettings, TSecrets, TParameters, TResult, TRequired>;
}

export interface ServiceTargetDefinition<
  TSettings,
  TSecrets,
  TService extends ServiceLifecycle = ServiceLifecycle,
  TRequired extends readonly CapabilitySelector[] = []
> extends ModuleTargetBase<TSettings, TSecrets, TRequired> {
  kind: 'service';
  handler: ServiceHandler<TSettings, TSecrets, TService, TRequired>;
  registration?: ServiceRegistration;
}

export interface WorkflowTargetDefinition<TSettings, TSecrets>
  extends ModuleTargetBase<TSettings, TSecrets, readonly CapabilitySelector[]> {
  kind: 'workflow';
  definition: WorkflowDefinition;
  triggers?: WorkflowTriggerDefinition[];
  schedules?: WorkflowScheduleDefinition[];
}

export type ModuleTargetDefinition<TSettings, TSecrets> =
  | JobTargetDefinition<TSettings, TSecrets, any, unknown, readonly CapabilitySelector[]>
  | ServiceTargetDefinition<TSettings, TSecrets, ServiceLifecycle, readonly CapabilitySelector[]>
  | WorkflowTargetDefinition<TSettings, TSecrets>;

export interface CreateJobHandlerOptions<
  TSettings,
  TSecrets,
  TParameters,
  TResult,
  TRequired extends readonly CapabilitySelector[] = []
> extends ModuleTargetBase<TSettings, TSecrets, TRequired> {
  parameters?: ValueDescriptor<TParameters>;
  handler: JobHandler<TSettings, TSecrets, TParameters, TResult, TRequired>;
}

export interface CreateServiceOptions<
  TSettings,
  TSecrets,
  TService extends ServiceLifecycle,
  TRequired extends readonly CapabilitySelector[] = []
> extends ModuleTargetBase<TSettings, TSecrets, TRequired> {
  handler: ServiceHandler<TSettings, TSecrets, TService, TRequired>;
  registration?: ServiceRegistration;
}

export interface CreateWorkflowOptions<TSettings, TSecrets>
  extends ModuleTargetBase<TSettings, TSecrets, readonly CapabilitySelector[]> {
  definition: WorkflowDefinition;
  triggers?: WorkflowTriggerDefinition[];
  schedules?: WorkflowScheduleDefinition[];
}

export interface CreateWorkflowTriggerOptions extends WorkflowTriggerDefinition {}

export interface CreateWorkflowScheduleOptions extends WorkflowScheduleDefinition {}

export function createJobHandler<
  TSettings = Record<string, unknown>,
  TSecrets = Record<string, unknown>,
  TResult = unknown,
  TParameters = Record<string, unknown>,
  TRequired extends readonly CapabilitySelector[] = []
>(
  options: CreateJobHandlerOptions<TSettings, TSecrets, TParameters, TResult, TRequired>
): JobTargetDefinition<TSettings, TSecrets, TParameters, TResult, TRequired> {
  const requires = options.requires ?? ([] as unknown as TRequired);
  const normalizedRequires = requires.length
    ? (Object.freeze([...new Set(requires)]) as TRequired)
    : undefined;

  const handler: JobHandler<TSettings, TSecrets, TParameters, TResult, TRequired> = async (context) => {
    if (normalizedRequires && normalizedRequires.length > 0) {
      requireCapabilities(context.capabilities, normalizedRequires, `job ${options.name}`);
    }
    return options.handler(context as CapabilityContext<JobContext<TSettings, TSecrets, TParameters>, TRequired>);
  };

  const definition: JobTargetDefinition<TSettings, TSecrets, TParameters, TResult, TRequired> = {
    kind: 'job',
    name: options.name,
    version: options.version,
    displayName: options.displayName,
    description: options.description,
    capabilityOverrides: options.capabilityOverrides,
    requires: normalizedRequires,
    settings: options.settings,
    secrets: options.secrets,
    parameters: options.parameters,
    handler
  };
  return definition;
}

export function createService<
  TSettings = Record<string, unknown>,
  TSecrets = Record<string, unknown>,
  TService extends ServiceLifecycle = ServiceLifecycle,
  TRequired extends readonly CapabilitySelector[] = []
>(
  options: CreateServiceOptions<TSettings, TSecrets, TService, TRequired>
): ServiceTargetDefinition<TSettings, TSecrets, TService, TRequired> {
  const requires = options.requires ?? ([] as unknown as TRequired);
  const normalizedRequires = requires.length
    ? (Object.freeze([...new Set(requires)]) as TRequired)
    : undefined;

  const handler: ServiceHandler<TSettings, TSecrets, TService, TRequired> = async (context) => {
    if (normalizedRequires && normalizedRequires.length > 0) {
      requireCapabilities(context.capabilities, normalizedRequires, `service ${options.name}`);
    }
    return options.handler(context as CapabilityContext<ServiceContext<TSettings, TSecrets>, TRequired>);
  };

  const definition: ServiceTargetDefinition<TSettings, TSecrets, TService, TRequired> = {
    kind: 'service',
    name: options.name,
    version: options.version,
    displayName: options.displayName,
    description: options.description,
    capabilityOverrides: options.capabilityOverrides,
    requires: normalizedRequires,
    settings: options.settings,
    secrets: options.secrets,
    handler,
    registration: options.registration
  };
  return definition;
}

export function createWorkflow<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>>(
  options: CreateWorkflowOptions<TSettings, TSecrets>
): WorkflowTargetDefinition<TSettings, TSecrets> {
  const definition: WorkflowTargetDefinition<TSettings, TSecrets> = {
    kind: 'workflow',
    name: options.name,
    version: options.version,
    displayName: options.displayName,
    description: options.description,
    capabilityOverrides: options.capabilityOverrides,
    requires: options.requires,
    settings: options.settings,
    secrets: options.secrets,
    definition: options.definition,
    triggers: options.triggers?.map((trigger) => ({
      ...trigger,
      predicates: trigger.predicates ?? []
    })),
    schedules: options.schedules?.map((schedule) => ({
      ...schedule
    }))
  };
  return definition;
}

export function createWorkflowTrigger(options: CreateWorkflowTriggerOptions): WorkflowTriggerDefinition {
  return {
    ...options,
    predicates: options.predicates ?? [],
    throttle: options.throttle ?? null
  };
}

export function createWorkflowSchedule(options: CreateWorkflowScheduleOptions): WorkflowScheduleDefinition {
  return {
    ...options
  };
}
