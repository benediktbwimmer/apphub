import {
  createCoreHttpCapability,
  createEventBusCapability,
  createFilestoreCapability,
  createMetastoreCapability,
  createTimestoreCapability,
  createCoreWorkflowsCapability,
  type CoreHttpCapability,
  type CoreHttpCapabilityConfig,
  type EventBusCapability,
  type EventBusCapabilityConfig,
  type FilestoreCapability,
  type FilestoreCapabilityConfig,
  type MetastoreCapability,
  type MetastoreCapabilityConfig,
  type TimestoreCapability,
  type TimestoreCapabilityConfig,
  type CoreWorkflowsCapability,
  type CoreWorkflowsCapabilityConfig
} from '../capabilities';

export interface CapabilityValueReference<T = unknown> {
  $ref: string;
  fallback?: CapabilityValueTemplate<T>;
  optional?: boolean;
}

export type CapabilityValueTemplate<T> =
  | T
  | CapabilityValueReference<T>
  | (T extends Array<infer U> ? CapabilityValueTemplate<U>[] : never)
  | (T extends Record<string, unknown>
      ? { [K in keyof T]: CapabilityValueTemplate<T[K]> }
      : never);

export type CapabilityConfigTemplate<TConfig> = {
  [K in keyof TConfig]?: CapabilityValueTemplate<TConfig[K]>;
};

export interface ModuleCapabilityConfig {
  filestore?: CapabilityConfigTemplate<FilestoreCapabilityConfig>;
  metastore?: CapabilityConfigTemplate<MetastoreCapabilityConfig>;
  timestore?: CapabilityConfigTemplate<TimestoreCapabilityConfig>;
  events?: CapabilityConfigTemplate<EventBusCapabilityConfig>;
  coreHttp?: CapabilityConfigTemplate<CoreHttpCapabilityConfig>;
  coreWorkflows?: CapabilityConfigTemplate<CoreWorkflowsCapabilityConfig>;
}

export interface ResolvedModuleCapabilityConfig {
  filestore?: FilestoreCapabilityConfig;
  metastore?: MetastoreCapabilityConfig;
  timestore?: TimestoreCapabilityConfig;
  events?: EventBusCapabilityConfig;
  coreHttp?: CoreHttpCapabilityConfig;
  coreWorkflows?: CoreWorkflowsCapabilityConfig;
}

export type CapabilityOverrideFactory<TCapability, TConfig> = (
  config: TConfig | undefined,
  createDefault: () => TCapability | undefined
) => TCapability | undefined;

export type CapabilityOverride<TCapability, TConfig> =
  | TCapability
  | CapabilityOverrideFactory<TCapability, TConfig>
  | null
  | undefined;

export interface ModuleCapabilityOverrides {
  filestore?: CapabilityOverride<FilestoreCapability, FilestoreCapabilityConfig>;
  metastore?: CapabilityOverride<MetastoreCapability, MetastoreCapabilityConfig>;
  timestore?: CapabilityOverride<TimestoreCapability, TimestoreCapabilityConfig>;
  events?: CapabilityOverride<EventBusCapability, EventBusCapabilityConfig>;
  coreHttp?: CapabilityOverride<CoreHttpCapability, CoreHttpCapabilityConfig>;
  coreWorkflows?: CapabilityOverride<CoreWorkflowsCapability, CoreWorkflowsCapabilityConfig>;
}

export interface ModuleCapabilities {
  filestore?: FilestoreCapability;
  metastore?: MetastoreCapability;
  timestore?: TimestoreCapability;
  events?: EventBusCapability;
  coreHttp?: CoreHttpCapability;
  coreWorkflows?: CoreWorkflowsCapability;
}

type ResolveContext = {
  settings: unknown;
  secrets: unknown;
};

function isCapabilityValueReference<T>(value: unknown): value is CapabilityValueReference<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return '$ref' in (value as Record<string, unknown>) && typeof (value as Record<string, unknown>).$ref === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getReferenceValue(reference: string, context: ResolveContext): unknown {
  const trimmed = reference.trim();
  if (!trimmed) {
    throw new Error('Capability reference path must not be empty');
  }
  const segments = trimmed.split('.');
  const scope = segments.shift();
  let current: unknown;
  if (scope === 'settings') {
    current = context.settings;
  } else if (scope === 'secrets') {
    current = context.secrets;
  } else {
    throw new Error(`Capability reference must start with "settings" or "secrets": ${reference}`);
  }
  if (segments.length === 0) {
    return current;
  }
  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) {
      return undefined;
    }
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveReference<T>(
  reference: CapabilityValueReference<T>,
  context: ResolveContext,
  label: string
): T {
  const raw = getReferenceValue(reference.$ref, context);
  if (raw === undefined) {
    if (reference.fallback !== undefined) {
      return resolveTemplate(reference.fallback, context, `${label} (fallback)`);
    }
    if (reference.optional) {
      return undefined as T;
    }
    throw new Error(`Capability reference "${reference.$ref}" resolved to undefined for ${label}`);
  }
  return raw as T;
}

function resolveTemplate<T>(
  value: CapabilityValueTemplate<T>,
  context: ResolveContext,
  label: string
): T {
  if (isCapabilityValueReference<T>(value)) {
    return resolveReference(value, context, label);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, index) =>
        resolveTemplate(entry as CapabilityValueTemplate<unknown>, context, `${label}[${index}]`)
      ) as T;
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const resolved = resolveTemplate(entry as CapabilityValueTemplate<unknown>, context, `${label}.${key}`);
      if (resolved !== undefined) {
        result[key] = resolved;
      }
    }
    return result as T;
  }
  return value as T;
}

function resolveCapabilitySection<TConfig>(
  template: CapabilityConfigTemplate<TConfig> | null | undefined,
  context: ResolveContext,
  label: string
): TConfig | undefined {
  if (template === undefined || template === null) {
    return undefined;
  }
  const resolved = resolveTemplate(template as CapabilityValueTemplate<TConfig>, context, label);
  if (resolved === undefined) {
    return undefined;
  }
  return resolved;
}

export function resolveModuleCapabilityConfig(
  config: ModuleCapabilityConfig | undefined,
  context: ResolveContext
): ResolvedModuleCapabilityConfig {
  if (!config) {
    return {};
  }
  const resolved: ResolvedModuleCapabilityConfig = {};

  const filestore = resolveCapabilitySection(config.filestore, context, 'capabilities.filestore');
  if (filestore !== undefined) {
    resolved.filestore = filestore;
  }

  const metastore = resolveCapabilitySection(config.metastore, context, 'capabilities.metastore');
  if (metastore !== undefined) {
    resolved.metastore = metastore;
  }

  const timestore = resolveCapabilitySection(config.timestore, context, 'capabilities.timestore');
  if (timestore !== undefined) {
    resolved.timestore = timestore;
  }

  const events = resolveCapabilitySection(config.events, context, 'capabilities.events');
  if (events !== undefined) {
    resolved.events = events;
  }

  const coreHttp = resolveCapabilitySection(config.coreHttp, context, 'capabilities.coreHttp');
  if (coreHttp !== undefined) {
    resolved.coreHttp = coreHttp;
  }

  const coreWorkflows = resolveCapabilitySection(
    config.coreWorkflows,
    context,
    'capabilities.coreWorkflows'
  );
  if (coreWorkflows !== undefined) {
    resolved.coreWorkflows = coreWorkflows;
  }

  return resolved;
}

function resolveCapability<TCapability, TConfig>(
  config: TConfig | undefined,
  override: CapabilityOverride<TCapability, TConfig>,
  factory: (config: TConfig) => TCapability
): TCapability | undefined {
  if (typeof override === 'function') {
    return (override as CapabilityOverrideFactory<TCapability, TConfig>)(config, () =>
      config ? factory(config) : undefined
    );
  }
  if (override === null) {
    return undefined;
  }
  if (override !== undefined) {
    return override as TCapability;
  }
  if (!config) {
    return undefined;
  }
  return factory(config);
}

export function createModuleCapabilities(
  config: ResolvedModuleCapabilityConfig = {},
  overrides: ModuleCapabilityOverrides = {}
): ModuleCapabilities {
  return {
    filestore: resolveCapability(config.filestore, overrides.filestore, createFilestoreCapability),
    metastore: resolveCapability(config.metastore, overrides.metastore, createMetastoreCapability),
    timestore: resolveCapability(config.timestore, overrides.timestore, createTimestoreCapability),
    events: resolveCapability(config.events, overrides.events, createEventBusCapability),
    coreHttp: resolveCapability(config.coreHttp, overrides.coreHttp, createCoreHttpCapability),
    coreWorkflows: resolveCapability(
      config.coreWorkflows,
      overrides.coreWorkflows,
      createCoreWorkflowsCapability
    )
  } satisfies ModuleCapabilities;
}

export function mergeCapabilityOverrides(
  ...values: Array<ModuleCapabilityOverrides | undefined>
): ModuleCapabilityOverrides {
  const merged: ModuleCapabilityOverrides = {};
  for (const entry of values) {
    if (!entry) {
      continue;
    }
    if (entry.filestore !== undefined) {
      merged.filestore = entry.filestore;
    }
    if (entry.metastore !== undefined) {
      merged.metastore = entry.metastore;
    }
    if (entry.timestore !== undefined) {
      merged.timestore = entry.timestore;
    }
    if (entry.events !== undefined) {
      merged.events = entry.events;
    }
    if (entry.coreHttp !== undefined) {
      merged.coreHttp = entry.coreHttp;
    }
    if (entry.coreWorkflows !== undefined) {
      merged.coreWorkflows = entry.coreWorkflows;
    }
  }
  return merged;
}
