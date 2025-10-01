import type { ModuleContext } from './context';
import type { ModuleCapabilityConfig } from './runtime/capabilities';
import type { ModuleMetadata, ValueDescriptor } from './types';
import type { ModuleTargetDefinition } from './targets';

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function assertSemver(value: string, label: string): void {
  if (!SEMVER_PATTERN.test(value)) {
    throw new Error(`${label} must be a valid semver string, received "${value}".`);
  }
}

export interface ModuleDefinition<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>> {
  metadata: ModuleMetadata;
  settings?: ValueDescriptor<TSettings>;
  secrets?: ValueDescriptor<TSecrets>;
  capabilities?: ModuleCapabilityConfig;
  targets: ModuleTargetDefinition<TSettings, TSecrets>[];
}

export function defineModule<TSettings = Record<string, unknown>, TSecrets = Record<string, unknown>>(
  definition: ModuleDefinition<TSettings, TSecrets>
): ModuleDefinition<TSettings, TSecrets> {
  assertSemver(definition.metadata.version, `Module ${definition.metadata.name} version`);

  const normalizedTargets = definition.targets.map((target) => {
    const targetVersion = target.version ?? definition.metadata.version;
    assertSemver(
      targetVersion,
      `${target.kind} target "${target.name}" version`
    );

    return Object.freeze({
      ...target,
      version: targetVersion
    }) as ModuleTargetDefinition<TSettings, TSecrets>;
  });

  const normalizedDefinition = {
    ...definition,
    targets: Object.freeze([...normalizedTargets])
  } as ModuleDefinition<TSettings, TSecrets>;

  return Object.freeze(normalizedDefinition);
}

export type ModuleDefinitionOf<T> = T extends ModuleDefinition<infer TSettings, infer TSecrets>
  ? ModuleDefinition<TSettings, TSecrets>
  : ModuleDefinition;

export type ModuleContextFromDefinition<TDefinition extends ModuleDefinition> = ModuleContext<
  TDefinition extends ModuleDefinition<infer TSettings, infer TSecrets> ? TSettings : Record<string, unknown>,
  TDefinition extends ModuleDefinition<infer _TSettings, infer TSecrets> ? TSecrets : Record<string, unknown>
>;
