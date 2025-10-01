import type { ModuleContext } from './context';
import type { ModuleCapabilityConfig } from './runtime/capabilities';
import type { ModuleMetadata, ValueDescriptor } from './types';
import type { ModuleTargetDefinition } from './targets';

export interface ModuleDefinition<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>> {
  metadata: ModuleMetadata;
  settings?: ValueDescriptor<TSettings>;
  secrets?: ValueDescriptor<TSecrets>;
  capabilities?: ModuleCapabilityConfig;
  targets: ModuleTargetDefinition<TSettings, TSecrets, unknown>[];
}

export function defineModule<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>>(
  definition: ModuleDefinition<TSettings, TSecrets>
): ModuleDefinition<TSettings, TSecrets> {
  return Object.freeze({ ...definition });
}

export type ModuleDefinitionOf<T> = T extends ModuleDefinition<infer TSettings, infer TSecrets>
  ? ModuleDefinition<TSettings, TSecrets>
  : ModuleDefinition;

export type ModuleContextFromDefinition<TDefinition extends ModuleDefinition> = ModuleContext<
  TDefinition extends ModuleDefinition<infer TSettings, infer TSecrets> ? TSettings : Record<string, unknown>,
  TDefinition extends ModuleDefinition<infer _TSettings, infer TSecrets> ? TSecrets : Record<string, unknown>
>;
