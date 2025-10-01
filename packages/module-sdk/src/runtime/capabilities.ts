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

export interface ModuleCapabilityConfig {
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
  config: ModuleCapabilityConfig = {},
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
