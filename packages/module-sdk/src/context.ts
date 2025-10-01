import { ModuleLogger, noopLogger } from './logger';
import {
  createModuleCapabilities,
  mergeCapabilityOverrides,
  type ModuleCapabilities,
  type ModuleCapabilityConfig,
  type ModuleCapabilityOverrides
} from './runtime/capabilities';
import { ModuleMetadata, type ValueDescriptor } from './types';

function resolveValue<TValue>(
  descriptor: ValueDescriptor<TValue> | undefined,
  raw: unknown,
  label: string,
  options: { optional?: boolean } = {}
): TValue {
  if (descriptor?.resolve) {
    const resolved = descriptor.resolve(raw ?? descriptor.defaults);
    if (resolved !== undefined) {
      return resolved;
    }
  } else if (raw !== undefined) {
    return raw as TValue;
  } else if (descriptor?.defaults !== undefined) {
    return descriptor.defaults;
  }

  if (options.optional) {
    return undefined as TValue;
  }

  throw new Error(`${label} not provided and no defaults or resolver defined.`);
}

export interface ModuleContext<TSettings = unknown, TSecrets = unknown> {
  module: ModuleMetadata;
  settings: TSettings;
  secrets: TSecrets;
  capabilities: ModuleCapabilities;
  logger: ModuleLogger;
}

export interface CreateModuleContextOptions<TSettings, TSecrets> {
  module: ModuleMetadata;
  settingsDescriptor?: ValueDescriptor<TSettings>;
  secretsDescriptor?: ValueDescriptor<TSecrets>;
  capabilityConfig?: ModuleCapabilityConfig;
  capabilityOverrides?: ModuleCapabilityOverrides[];
  settings?: unknown;
  secrets?: unknown;
  logger?: ModuleLogger;
}

export function createModuleContext<TSettings, TSecrets>(
  options: CreateModuleContextOptions<TSettings, TSecrets>
): ModuleContext<TSettings, TSecrets> {
  const capabilityOverrides = mergeCapabilityOverrides(...(options.capabilityOverrides ?? []));
  const capabilities = createModuleCapabilities(options.capabilityConfig, capabilityOverrides);
  const settings = resolveValue(options.settingsDescriptor, options.settings, 'Module settings');
  const secrets = resolveValue(options.secretsDescriptor, options.secrets, 'Module secrets', { optional: true });

  return {
    module: options.module,
    settings,
    secrets,
    capabilities,
    logger: options.logger ?? noopLogger
  } satisfies ModuleContext<TSettings, TSecrets>;
}
