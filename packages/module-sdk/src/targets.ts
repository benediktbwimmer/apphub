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

export interface JobTargetDefinition<TSettings, TSecrets, TResult>
  extends ModuleTargetBase<TSettings, TSecrets> {
  kind: 'job';
  handler: JobHandler<TSettings, TSecrets, TResult>;
}

export type ModuleTargetDefinition<TSettings, TSecrets, TResult> = JobTargetDefinition<TSettings, TSecrets, TResult>;

export interface CreateJobHandlerOptions<TSettings, TSecrets, TResult>
  extends ModuleTargetBase<TSettings, TSecrets> {
  handler: JobHandler<TSettings, TSecrets, TResult>;
}

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
