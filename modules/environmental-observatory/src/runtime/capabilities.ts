import type {
  CoreWorkflowsCapability,
  EventBusCapability,
  FilestoreCapability,
  MetastoreCapability,
  ModuleCapabilities
} from '@apphub/module-sdk';

type TimestoreCapability = {
  ingestRecords: (...args: unknown[]) => Promise<unknown>;
  getDataset: (...args: unknown[]) => Promise<unknown>;
  queryDataset: (...args: unknown[]) => Promise<unknown>;
};

function isMetastoreCapability(value: unknown): value is MetastoreCapability {
  return Boolean(value && typeof value === 'object' && typeof (value as MetastoreCapability).upsertRecord === 'function');
}

function isEventBusCapability(value: unknown): value is EventBusCapability {
  return Boolean(value && typeof value === 'object' && typeof (value as EventBusCapability).publish === 'function');
}

function isFilestoreCapability(value: unknown): value is FilestoreCapability {
  return Boolean(value && typeof value === 'object' && typeof (value as FilestoreCapability).ensureDirectory === 'function');
}

function isTimestoreCapability(value: unknown): value is TimestoreCapability {
  return Boolean(value && typeof value === 'object' && typeof (value as TimestoreCapability).ingestRecords === 'function');
}

function isCoreWorkflowsCapability(value: unknown): value is CoreWorkflowsCapability {
  return Boolean(value && typeof value === 'object' && typeof (value as CoreWorkflowsCapability).enqueueWorkflowRun === 'function');
}

function selectNamedCapability<T>(
  capability: T | Record<string, T> | undefined,
  key: string,
  isCapability: (value: unknown) => value is T,
  fallbackKey?: string
): T | undefined {
  if (!capability) {
    return undefined;
  }
  if (isCapability(capability)) {
    return capability;
  }
  if (typeof capability === 'object' && capability !== null) {
    const map = capability as Record<string, unknown>;
    if (key in map && isCapability(map[key])) {
      return map[key] as T;
    }
    if (fallbackKey && fallbackKey in map && isCapability(map[fallbackKey])) {
      return map[fallbackKey] as T;
    }
    const values = Object.values(map);
    for (const entry of values) {
      if (isCapability(entry)) {
        return entry;
      }
    }
  }
  return undefined;
}

export function selectMetastore(
  capabilities: ModuleCapabilities,
  key: 'reports' | 'calibrations' = 'reports'
): MetastoreCapability | undefined {
  return selectNamedCapability<MetastoreCapability>(
    capabilities.metastore as MetastoreCapability | Record<string, MetastoreCapability> | undefined,
    key,
    isMetastoreCapability,
    'reports'
  );
}

export function selectEventBus(
  capabilities: ModuleCapabilities,
  key = 'default'
): EventBusCapability | undefined {
  return selectNamedCapability<EventBusCapability>(
    capabilities.events as EventBusCapability | Record<string, EventBusCapability> | undefined,
    key,
    isEventBusCapability,
    'default'
  );
}

function selectSingleCapability<T>(
  capability: T | Record<string, T> | undefined,
  isCapability: (value: unknown) => value is T
): T | undefined {
  if (!capability) {
    return undefined;
  }
  if (isCapability(capability)) {
    return capability;
  }
  if (typeof capability === 'object' && capability !== null) {
    const values = Object.values(capability as Record<string, unknown>);
    for (const value of values) {
      if (isCapability(value)) {
        return value as T;
      }
    }
  }
  return undefined;
}

export function selectFilestore(capabilities: ModuleCapabilities): FilestoreCapability | undefined {
  return selectSingleCapability<FilestoreCapability>(
    capabilities.filestore as FilestoreCapability | Record<string, FilestoreCapability> | undefined,
    isFilestoreCapability
  );
}

export function selectTimestore(capabilities: ModuleCapabilities): TimestoreCapability | undefined {
  return selectSingleCapability<TimestoreCapability>(
    capabilities.timestore as TimestoreCapability | Record<string, TimestoreCapability> | undefined,
    isTimestoreCapability
  );
}

export function selectCoreWorkflows(
  capabilities: ModuleCapabilities,
  key = 'default'
): CoreWorkflowsCapability | undefined {
  return selectNamedCapability<CoreWorkflowsCapability>(
    capabilities.coreWorkflows as CoreWorkflowsCapability | Record<string, CoreWorkflowsCapability> | undefined,
    key,
    isCoreWorkflowsCapability,
    'default'
  );
}
