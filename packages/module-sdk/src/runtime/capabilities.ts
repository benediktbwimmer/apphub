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

const namedCapabilityConfigSymbol = Symbol('namedCapabilityConfig');
const namedCapabilityOverrideSymbol = Symbol('namedCapabilityOverride');

export interface CapabilityValueReference<T = unknown> {
  $ref: string;
  fallback?: CapabilityValueTemplate<T>;
  optional?: boolean;
}

export interface CapabilityRefOptions<T> {
  fallback?: CapabilityValueTemplate<T>;
  optional?: boolean;
}

function createCapabilityReference<T>(
  scope: 'settings' | 'secrets',
  path: string,
  options: CapabilityRefOptions<T> = {}
): CapabilityValueReference<T> {
  const trimmedPath = path.trim();
  if (!trimmedPath) {
    throw new Error('Capability reference path must not be empty');
  }

  const reference: CapabilityValueReference<T> = {
    $ref: `${scope}.${trimmedPath}`
  };

  if (options.fallback !== undefined) {
    reference.fallback = options.fallback;
  }

  if (options.optional !== undefined) {
    reference.optional = options.optional;
  } else if (scope === 'secrets') {
    reference.optional = true;
  }

  return reference;
}

export function settingsRef<T = unknown>(
  path: string,
  options: CapabilityRefOptions<T> = {}
): CapabilityValueReference<T> {
  return createCapabilityReference('settings', path, options);
}

export function secretsRef<T = unknown>(
  path: string,
  options: CapabilityRefOptions<T> = {}
): CapabilityValueReference<T> {
  return createCapabilityReference('secrets', path, options);
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

export interface NamedCapabilityConfig<TConfig> {
  readonly __kind: typeof namedCapabilityConfigSymbol;
  readonly entries: Record<string, CapabilityConfigTemplate<TConfig>>;
}

export function namedCapabilities<TConfig>(
  entries: Record<string, CapabilityConfigTemplate<TConfig>>
): NamedCapabilityConfig<TConfig> {
  if (!entries || typeof entries !== 'object') {
    throw new Error('namedCapabilities requires an object map of capability configurations');
  }
  return Object.freeze({
    __kind: namedCapabilityConfigSymbol,
    entries: { ...entries }
  });
}

type CapabilityConfigInput<TConfig> = CapabilityConfigTemplate<TConfig> | NamedCapabilityConfig<TConfig>;

interface NamedResolvedCapabilityConfig<TConfig> {
  readonly __kind: typeof namedCapabilityConfigSymbol;
  readonly entries: Record<string, TConfig>;
}

type ResolvedCapabilityConfig<TConfig> = TConfig | NamedResolvedCapabilityConfig<TConfig>;

function isNamedCapabilityConfig<TConfig>(
  value: CapabilityConfigInput<TConfig> | null | undefined
): value is NamedCapabilityConfig<TConfig> {
  return Boolean(value && typeof value === 'object' && (value as NamedCapabilityConfig<TConfig>).__kind === namedCapabilityConfigSymbol);
}

function isNamedResolvedCapabilityConfig<TConfig>(
  value: ResolvedCapabilityConfig<TConfig> | null | undefined
): value is NamedResolvedCapabilityConfig<TConfig> {
  return Boolean(value && typeof value === 'object' && (value as NamedResolvedCapabilityConfig<TConfig>).__kind === namedCapabilityConfigSymbol);
}

export interface ModuleCapabilityConfig {
  filestore?: CapabilityConfigInput<FilestoreCapabilityConfig>;
  metastore?: CapabilityConfigInput<MetastoreCapabilityConfig>;
  timestore?: CapabilityConfigInput<TimestoreCapabilityConfig>;
  events?: CapabilityConfigInput<EventBusCapabilityConfig>;
  coreHttp?: CapabilityConfigInput<CoreHttpCapabilityConfig>;
  coreWorkflows?: CapabilityConfigInput<CoreWorkflowsCapabilityConfig>;
}

export interface ResolvedModuleCapabilityConfig {
  filestore?: ResolvedCapabilityConfig<FilestoreCapabilityConfig>;
  metastore?: ResolvedCapabilityConfig<MetastoreCapabilityConfig>;
  timestore?: ResolvedCapabilityConfig<TimestoreCapabilityConfig>;
  events?: ResolvedCapabilityConfig<EventBusCapabilityConfig>;
  coreHttp?: ResolvedCapabilityConfig<CoreHttpCapabilityConfig>;
  coreWorkflows?: ResolvedCapabilityConfig<CoreWorkflowsCapabilityConfig>;
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

export interface NamedCapabilityOverride<TCapability, TConfig> {
  readonly __kind: typeof namedCapabilityOverrideSymbol;
  readonly entries: Record<string, CapabilityOverride<TCapability, TConfig>>;
}

export function namedCapabilityOverrides<TCapability, TConfig>(
  entries: Record<string, CapabilityOverride<TCapability, TConfig>>
): NamedCapabilityOverride<TCapability, TConfig> {
  if (!entries || typeof entries !== 'object') {
    throw new Error('namedCapabilityOverrides requires an object map of overrides');
  }
  return Object.freeze({
    __kind: namedCapabilityOverrideSymbol,
    entries: { ...entries }
  });
}

type CapabilityOverrideInput<TCapability, TConfig> =
  | CapabilityOverride<TCapability, TConfig>
  | NamedCapabilityOverride<TCapability, TConfig>;

function isNamedCapabilityOverride<TCapability, TConfig>(
  value: CapabilityOverrideInput<TCapability, TConfig> | null | undefined
): value is NamedCapabilityOverride<TCapability, TConfig> {
  return Boolean(value && typeof value === 'object' && (value as NamedCapabilityOverride<TCapability, TConfig>).__kind === namedCapabilityOverrideSymbol);
}

export interface ModuleCapabilityOverrides {
  filestore?: CapabilityOverrideInput<FilestoreCapability, FilestoreCapabilityConfig>;
  metastore?: CapabilityOverrideInput<MetastoreCapability, MetastoreCapabilityConfig>;
  timestore?: CapabilityOverrideInput<TimestoreCapability, TimestoreCapabilityConfig>;
  events?: CapabilityOverrideInput<EventBusCapability, EventBusCapabilityConfig>;
  coreHttp?: CapabilityOverrideInput<CoreHttpCapability, CoreHttpCapabilityConfig>;
  coreWorkflows?: CapabilityOverrideInput<CoreWorkflowsCapability, CoreWorkflowsCapabilityConfig>;
}

export interface ModuleCapabilities {
  filestore?: FilestoreCapability | Record<string, FilestoreCapability>;
  metastore?: MetastoreCapability | Record<string, MetastoreCapability>;
  timestore?: TimestoreCapability | Record<string, TimestoreCapability>;
  events?: EventBusCapability | Record<string, EventBusCapability>;
  coreHttp?: CoreHttpCapability | Record<string, CoreHttpCapability>;
  coreWorkflows?: CoreWorkflowsCapability | Record<string, CoreWorkflowsCapability>;
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
  template: CapabilityConfigInput<TConfig> | null | undefined,
  context: ResolveContext,
  label: string
): ResolvedCapabilityConfig<TConfig> | undefined {
  if (template === undefined || template === null) {
    return undefined;
  }

  if (isNamedCapabilityConfig(template)) {
    const entries: Record<string, TConfig> = {};
    for (const [name, entry] of Object.entries(template.entries)) {
      const resolved = resolveTemplate(entry as CapabilityValueTemplate<TConfig>, context, `${label}.${name}`);
      if (resolved !== undefined) {
        entries[name] = resolved;
      }
    }
    return {
      __kind: namedCapabilityConfigSymbol,
      entries
    } satisfies NamedResolvedCapabilityConfig<TConfig>;
  }

  const resolved = resolveTemplate(template as CapabilityValueTemplate<TConfig>, context, label);
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
  config: ResolvedCapabilityConfig<TConfig> | undefined,
  override: CapabilityOverrideInput<TCapability, TConfig> | undefined,
  factory: (config: TConfig) => TCapability
): TCapability | Record<string, TCapability> | undefined {
  if (isNamedResolvedCapabilityConfig(config)) {
    const overrides = isNamedCapabilityOverride(override) ? override.entries : undefined;
    const result: Record<string, TCapability> = {};
    for (const [name, entryConfig] of Object.entries(config.entries)) {
      const entryOverride = overrides ? overrides[name] : override;
      const resolved = resolveCapability(entryConfig, entryOverride as CapabilityOverrideInput<TCapability, TConfig>, factory);
      if (resolved) {
        result[name] = resolved as TCapability;
      }
    }
    return result;
  }

  if (typeof override === 'function') {
    return (override as CapabilityOverrideFactory<TCapability, TConfig>)(config, () =>
      config ? factory(config) : undefined
    );
  }
  if (override === null) {
    return undefined;
  }
  if (override !== undefined && !isNamedCapabilityOverride(override)) {
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

function mergeOverrideValue<TCapability, TConfig>(
  current: CapabilityOverrideInput<TCapability, TConfig> | undefined,
  incoming: CapabilityOverrideInput<TCapability, TConfig> | undefined
): CapabilityOverrideInput<TCapability, TConfig> | undefined {
  if (incoming === undefined) {
    return current;
  }
  if (isNamedCapabilityOverride(incoming)) {
    if (isNamedCapabilityOverride(current)) {
      const mergedEntries = { ...current.entries, ...incoming.entries };
      return namedCapabilityOverrides(mergedEntries);
    }
    return incoming;
  }
  return incoming;
}

export function mergeCapabilityOverrides(
  ...values: Array<ModuleCapabilityOverrides | undefined>
): ModuleCapabilityOverrides {
  const merged: ModuleCapabilityOverrides = {};
  for (const entry of values) {
    if (!entry) {
      continue;
    }
    merged.filestore = mergeOverrideValue(merged.filestore, entry.filestore);
    merged.metastore = mergeOverrideValue(merged.metastore, entry.metastore);
    merged.timestore = mergeOverrideValue(merged.timestore, entry.timestore);
    merged.events = mergeOverrideValue(merged.events, entry.events);
    merged.coreHttp = mergeOverrideValue(merged.coreHttp, entry.coreHttp);
    merged.coreWorkflows = mergeOverrideValue(merged.coreWorkflows, entry.coreWorkflows);
  }
  return merged;
}

export type CapabilityKey = keyof ModuleCapabilities & string;
export type CapabilitySelector = CapabilityKey | `${CapabilityKey}.${string}`;

export type CapabilitiesWith<T extends CapabilityKey> = ModuleCapabilities & {
  [K in T]-?: NonNullable<ModuleCapabilities[K]>;
};

function baseCapabilityFromSelector(selector: CapabilitySelector): CapabilityKey {
  return selector.split('.')[0] as CapabilityKey;
}

type SelectorBase<S extends CapabilitySelector> = S extends `${infer Base}.${string}`
  ? Extract<Base, CapabilityKey>
  : Extract<S, CapabilityKey>;

type SelectorBaseUnion<T extends readonly CapabilitySelector[]> = SelectorBase<T[number]>;

export function requireCapabilities<
  TCapabilities extends ModuleCapabilities,
  TSelectors extends readonly CapabilitySelector[]
>(
  capabilities: TCapabilities,
  required: TSelectors,
  contextLabel = 'module'
): asserts capabilities is TCapabilities & CapabilitiesWith<SelectorBaseUnion<TSelectors>> {
  for (const selector of required) {
    const [base, ...path] = selector.split('.');
    const capability = (capabilities as Record<string, unknown>)[base];
    if (!capability) {
      throw new Error(`${contextLabel} requires capability "${selector}" but it was not configured.`);
    }
    if (path.length > 0) {
      let current: unknown = capability;
      for (const segment of path) {
        if (!segment) {
          continue;
        }
        if (current === null || current === undefined || typeof current !== 'object') {
          throw new Error(`${contextLabel} requires capability "${selector}" but it was not configured.`);
        }
        current = (current as Record<string, unknown>)[segment];
      }
      if (current === undefined || current === null) {
        throw new Error(`${contextLabel} requires capability "${selector}" but it was not configured.`);
      }
    }
  }
}
