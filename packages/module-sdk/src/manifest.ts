import type { ModuleDefinition } from './module';
import type { ValueDescriptor } from './types';
import {
  JobTargetDefinition,
  ModuleTargetDefinition,
  ModuleTargetKind,
  WorkflowScheduleDefinition,
  WorkflowTargetDefinition,
  WorkflowTriggerDefinition,
  INHERIT_MODULE_SETTINGS,
  INHERIT_MODULE_SECRETS
} from './targets';
import type { InheritModuleSettings, InheritModuleSecrets } from './targets';

export interface ModuleManifestValueDescriptor {
  defaults?: unknown;
  hasResolve: boolean;
  inherit?: boolean;
}

export interface ModuleManifestWorkflowDetails {
  definition: unknown;
  triggers: WorkflowTriggerDefinition[];
  schedules: WorkflowScheduleDefinition[];
}

export interface ModuleManifestTarget {
  name: string;
  kind: ModuleTargetKind;
  version: string;
  displayName?: string;
  description?: string;
  capabilityOverrides?: string[];
  requiredCapabilities?: string[];
  fingerprint: string;
  settings?: ModuleManifestValueDescriptor;
  secrets?: ModuleManifestValueDescriptor;
  parameters?: ModuleManifestValueDescriptor;
  workflow?: ModuleManifestWorkflowDetails;
  service?: ModuleManifestServiceDetails;
}

export interface ModuleManifest {
  metadata: ModuleDefinition['metadata'];
  settings?: ModuleManifestValueDescriptor;
  secrets?: ModuleManifestValueDescriptor;
  configuredCapabilities: string[];
  targets: ModuleManifestTarget[];
}

export interface ModuleManifestServiceDetails {
  registration?: unknown;
}

function cloneJsonValue<T>(value: T, context: string): T {
  if (value === undefined) {
    return value;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (error) {
    throw new Error(`Failed to serialize ${context}: ${(error as Error).message}`);
  }
}

function toValueDescriptorManifest(
  descriptor: ValueDescriptor<unknown> | InheritModuleSettings | InheritModuleSecrets | undefined,
  context: string
): ModuleManifestValueDescriptor | undefined {
  if (descriptor === INHERIT_MODULE_SETTINGS || descriptor === INHERIT_MODULE_SECRETS) {
    return {
      defaults: undefined,
      hasResolve: false,
      inherit: true
    } satisfies ModuleManifestValueDescriptor;
  }
  if (!descriptor) {
    return undefined;
  }
  const valueDescriptor = descriptor as ValueDescriptor<unknown>;
  return {
    defaults:
      valueDescriptor.defaults !== undefined
        ? cloneJsonValue(valueDescriptor.defaults, `${context} defaults`)
        : undefined,
    hasResolve: typeof valueDescriptor.resolve === 'function'
  } satisfies ModuleManifestValueDescriptor;
}

function normalizeCapabilityOverrides(overrides: unknown): string[] | undefined {
  if (!overrides || typeof overrides !== 'object') {
    return undefined;
  }
  return Object.keys(overrides as Record<string, unknown>).sort();
}

function buildTargetFingerprint(moduleVersion: string, targetVersion: string, targetName: string): string {
  return `${moduleVersion}:${targetVersion}:${targetName}`;
}

function isWorkflowTarget(
  target: ModuleTargetDefinition<unknown, unknown>
): target is WorkflowTargetDefinition<unknown, unknown> {
  return target.kind === 'workflow';
}

function isJobTarget(
  target: ModuleTargetDefinition<unknown, unknown>
): target is JobTargetDefinition<unknown, unknown, any, unknown> {
  return target.kind === 'job';
}

function buildTargetManifest<TSettings, TSecrets>(
  moduleVersion: string,
  target: ModuleTargetDefinition<TSettings, TSecrets>
): ModuleManifestTarget {
  const genericTarget = target as ModuleTargetDefinition<unknown, unknown>;

  const version = genericTarget.version;
  if (!version) {
    throw new Error(`Target "${genericTarget.name}" (kind: ${genericTarget.kind}) is missing a version.`);
  }

  const base: ModuleManifestTarget = {
    name: genericTarget.name,
    kind: genericTarget.kind,
    version,
    displayName: genericTarget.displayName,
    description: genericTarget.description,
    capabilityOverrides: normalizeCapabilityOverrides(genericTarget.capabilityOverrides),
    requiredCapabilities: genericTarget.requires?.length
      ? Array.from(new Set(genericTarget.requires.map(String))).sort()
      : undefined,
    fingerprint: buildTargetFingerprint(moduleVersion, version, genericTarget.name),
    settings: toValueDescriptorManifest(
      genericTarget.settings,
      `${genericTarget.kind}:${genericTarget.name} settings`
    ),
    secrets: toValueDescriptorManifest(
      genericTarget.secrets,
      `${genericTarget.kind}:${genericTarget.name} secrets`
    )
  } satisfies ModuleManifestTarget;

  if (isJobTarget(genericTarget)) {
    base.parameters = toValueDescriptorManifest(
      genericTarget.parameters,
      `${genericTarget.kind}:${genericTarget.name} parameters`
    );
  }

  if (isWorkflowTarget(genericTarget)) {
    base.workflow = {
      definition: cloneJsonValue(
        genericTarget.definition,
        `${genericTarget.kind}:${genericTarget.name} definition`
      ),
      triggers: genericTarget.triggers
        ? cloneJsonValue(genericTarget.triggers, `${genericTarget.kind}:${genericTarget.name} triggers`)
        : [],
      schedules: genericTarget.schedules
        ? cloneJsonValue(genericTarget.schedules, `${genericTarget.kind}:${genericTarget.name} schedules`)
        : []
    } satisfies ModuleManifestWorkflowDetails;
  }

  if (genericTarget.kind === 'service' && (genericTarget as { registration?: unknown }).registration) {
    base.service = {
      registration: cloneJsonValue(
        (genericTarget as { registration?: unknown }).registration,
        `${genericTarget.kind}:${genericTarget.name} registration`
      )
    } satisfies ModuleManifestServiceDetails;
  }

  return base;
}

export function serializeModuleDefinition<TSettings, TSecrets>(
  definition: ModuleDefinition<TSettings, TSecrets>
): ModuleManifest {
  const configuredCapabilities = definition.capabilities
    ? Object.keys(definition.capabilities as Record<string, unknown>).sort()
    : [];

  const targets = definition.targets.map((target) => buildTargetManifest(definition.metadata.version, target));

  return {
    metadata: definition.metadata,
    settings: toValueDescriptorManifest(definition.settings, 'module settings'),
    secrets: toValueDescriptorManifest(definition.secrets, 'module secrets'),
    configuredCapabilities,
    targets
  } satisfies ModuleManifest;
}
