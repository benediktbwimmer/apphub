import type { ModuleContext } from './context';
import type { ModuleCapabilityOverrides } from './runtime/capabilities';
import type { ValueDescriptor } from './types';

export type ModuleTargetKind = 'job' | 'service' | 'workflow';

export interface ModuleTargetBase<TSettings, TSecrets> {
  name: string;
  displayName?: string;
  description?: string;
  capabilityOverrides?: ModuleCapabilityOverrides;
  settings?: ValueDescriptor<TSettings>;
  secrets?: ValueDescriptor<TSecrets>;
}

export interface JobContext<TSettings, TSecrets> extends ModuleContext<TSettings, TSecrets> {
  job: {
    name: string;
  };
}

export type JobHandler<TSettings, TSecrets, TResult> = (
  context: JobContext<TSettings, TSecrets>
) => Promise<TResult> | TResult;

export interface ServiceContext<TSettings, TSecrets> extends ModuleContext<TSettings, TSecrets> {
  service: {
    name: string;
  };
}

export interface ServiceLifecycle {
  start?(): Promise<void> | void;
  stop?(): Promise<void> | void;
}

export type ServiceHandler<TSettings, TSecrets, TService extends ServiceLifecycle> = (
  context: ServiceContext<TSettings, TSecrets>
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
  | 'exists';

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

export interface JobTargetDefinition<TSettings, TSecrets, TResult>
  extends ModuleTargetBase<TSettings, TSecrets> {
  kind: 'job';
  handler: JobHandler<TSettings, TSecrets, TResult>;
}

export interface ServiceTargetDefinition<
  TSettings,
  TSecrets,
  TService extends ServiceLifecycle = ServiceLifecycle
> extends ModuleTargetBase<TSettings, TSecrets> {
  kind: 'service';
  handler: ServiceHandler<TSettings, TSecrets, TService>;
}

export interface WorkflowTargetDefinition<TSettings, TSecrets>
  extends ModuleTargetBase<TSettings, TSecrets> {
  kind: 'workflow';
  definition: WorkflowDefinition;
  triggers?: WorkflowTriggerDefinition[];
  schedules?: WorkflowScheduleDefinition[];
}

export type ModuleTargetDefinition<TSettings, TSecrets> =
  | JobTargetDefinition<TSettings, TSecrets, unknown>
  | ServiceTargetDefinition<TSettings, TSecrets>
  | WorkflowTargetDefinition<TSettings, TSecrets>;

export interface CreateJobHandlerOptions<TSettings, TSecrets, TResult>
  extends ModuleTargetBase<TSettings, TSecrets> {
  handler: JobHandler<TSettings, TSecrets, TResult>;
}

export interface CreateServiceOptions<TSettings, TSecrets, TService extends ServiceLifecycle>
  extends ModuleTargetBase<TSettings, TSecrets> {
  handler: ServiceHandler<TSettings, TSecrets, TService>;
}

export interface CreateWorkflowOptions<TSettings, TSecrets> extends ModuleTargetBase<TSettings, TSecrets> {
  definition: WorkflowDefinition;
  triggers?: WorkflowTriggerDefinition[];
  schedules?: WorkflowScheduleDefinition[];
}

export interface CreateWorkflowTriggerOptions extends WorkflowTriggerDefinition {}

export interface CreateWorkflowScheduleOptions extends WorkflowScheduleDefinition {}

export function createJobHandler<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>, TResult = unknown>(
  options: CreateJobHandlerOptions<TSettings, TSecrets, TResult>
): JobTargetDefinition<TSettings, TSecrets, TResult> {
  const definition: JobTargetDefinition<TSettings, TSecrets, TResult> = {
    kind: 'job',
    name: options.name,
    displayName: options.displayName,
    description: options.description,
    capabilityOverrides: options.capabilityOverrides,
    settings: options.settings,
    secrets: options.secrets,
    handler: options.handler
  };
  return definition;
}

export function createService<
  TSettings = Record<string, unknown>,
  TSecrets = Record<string, unknown>,
  TService extends ServiceLifecycle = ServiceLifecycle
>(
  options: CreateServiceOptions<TSettings, TSecrets, TService>
): ServiceTargetDefinition<TSettings, TSecrets, TService> {
  const definition: ServiceTargetDefinition<TSettings, TSecrets, TService> = {
    kind: 'service',
    name: options.name,
    displayName: options.displayName,
    description: options.description,
    capabilityOverrides: options.capabilityOverrides,
    settings: options.settings,
    secrets: options.secrets,
    handler: options.handler
  };
  return definition;
}

export function createWorkflow<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>>(
  options: CreateWorkflowOptions<TSettings, TSecrets>
): WorkflowTargetDefinition<TSettings, TSecrets> {
  const definition: WorkflowTargetDefinition<TSettings, TSecrets> = {
    kind: 'workflow',
    name: options.name,
    displayName: options.displayName,
    description: options.description,
    capabilityOverrides: options.capabilityOverrides,
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
