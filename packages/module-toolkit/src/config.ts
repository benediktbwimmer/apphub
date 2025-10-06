import type { ZodTypeAny, infer as ZodInfer } from 'zod';
import type { ModuleSecurityRegistry } from './security';

export interface SettingsLoaderOptions<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined
> {
  settingsSchema: TSettingsSchema;
  secretsSchema?: TSecretsSchema;
  readSettings?: (env: Record<string, string | undefined>) => unknown;
  readSecrets?: (env: Record<string, string | undefined>) => unknown;
}

export interface SettingsLoadInput {
  env?: Record<string, string | undefined>;
  secretsEnv?: Record<string, string | undefined>;
}

export interface SettingsLoadResult<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined
> {
  settings: ZodInfer<TSettingsSchema>;
  secrets: TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;
}

export function createSettingsLoader<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined
>(
  options: SettingsLoaderOptions<TSettingsSchema, TSecretsSchema>
) {
  const readSettings = options.readSettings ?? ((env: Record<string, string | undefined>) => env);
  const readSecrets = options.readSecrets ?? ((env: Record<string, string | undefined>) => env);

  return function loadSettings(
    input: SettingsLoadInput = {}
  ): SettingsLoadResult<TSettingsSchema, TSecretsSchema> {
    const env = input.env ?? process.env;
    const secretsEnv = input.secretsEnv ?? process.env;

    const settings = options.settingsSchema.parse(readSettings(env));
    const secrets = options.secretsSchema
      ? options.secretsSchema.parse(readSecrets(secretsEnv))
      : undefined;

    return { settings, secrets } as SettingsLoadResult<TSettingsSchema, TSecretsSchema>;
  };
}

type PlainObject = Record<string, unknown>;

export interface EnvBindingInput<TTarget> {
  value: string;
  current: unknown;
  env: Record<string, string | undefined>;
  draft: TTarget;
}

export interface EnvBinding<TTarget> {
  key: string;
  path: string;
  map?: (input: EnvBindingInput<TTarget>) => unknown;
  parse?: (value: string) => unknown;
  when?: (input: Omit<EnvBindingInput<TTarget>, 'current'>) => boolean;
  trim?: boolean;
}

export interface EnvBindingPreset<TTarget> {
  resolve(): EnvBinding<TTarget>[];
}

export type EnvBindingPresetLike<TTarget> =
  | EnvBindingPreset<TTarget>
  | (() => EnvBinding<TTarget>[])
  | EnvBinding<TTarget>[];

export function createEnvBindingPreset<TTarget>(
  bindings: EnvBinding<TTarget>[]
): EnvBindingPreset<TTarget> {
  return {
    resolve: () => bindings.map((binding) => ({ ...binding }))
  } satisfies EnvBindingPreset<TTarget>;
}

type EnvBindingPresetEntry = EnvBindingPresetLike<any>;

const envBindingPresetRegistry = new Map<string, EnvBindingPresetEntry>();

export function registerEnvBindingPreset<TTarget>(
  name: string,
  preset: EnvBindingPresetLike<TTarget>
): void {
  envBindingPresetRegistry.set(name, preset as EnvBindingPresetEntry);
}

export function getEnvBindingPreset<TTarget>(name: string): EnvBindingPresetLike<TTarget> {
  const preset = envBindingPresetRegistry.get(name);
  if (!preset) {
    throw new Error(`Env binding preset '${name}' is not registered`);
  }
  return preset as EnvBindingPresetLike<TTarget>;
}

type EnvSourceMode = 'fill' | 'override';

export interface EnvSourceResult {
  values: Record<string, string | undefined>;
  mode?: EnvSourceMode;
}

export interface EnvSourceInput extends SettingsLoadInput {
  currentEnv: Record<string, string | undefined>;
}

export type EnvSourceHandler = (input: EnvSourceInput) => EnvSourceResult | Record<string, string | undefined> | void;

export interface EnvSource {
  resolve(input: EnvSourceInput): EnvSourceResult | Record<string, string | undefined> | void;
}

export function createEnvSource(handler: EnvSourceHandler): EnvSource {
  return {
    resolve: handler
  } satisfies EnvSource;
}

type EnvSourceLike = EnvSource | EnvSourceHandler;

export interface DefineSettingsOptions<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined
> {
  settingsSchema: TSettingsSchema;
  secretsSchema?: TSecretsSchema;
  defaults: () => ZodInfer<TSettingsSchema>;
  secretsDefaults?: () => TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;
  envBindings?: EnvBinding<ZodInfer<TSettingsSchema>>[];
  envBindingPresets?: EnvBindingPresetLike<ZodInfer<TSettingsSchema>>[];
  envBindingPresetKeys?: string[];
  secretsEnvBindings?: EnvBinding<
    TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : Record<string, unknown>
  >[];
  secretsEnvBindingPresets?: EnvBindingPresetLike<
    TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : Record<string, unknown>
  >[];
  secretsEnvBindingPresetKeys?: string[];
  resolveEnv?: (input: SettingsLoadInput) => Record<string, string | undefined>;
  resolveSecretsEnv?: (input: SettingsLoadInput) => Record<string, string | undefined>;
  envSources?: EnvSourceLike[];
  secretsEnvSources?: EnvSourceLike[];
}

export interface DefinedSettings<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined
> {
  load(input?: SettingsLoadInput): SettingsLoadResult<TSettingsSchema, TSecretsSchema>;
  defaultSettings(): ZodInfer<TSettingsSchema>;
  defaultSecrets(): TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;
  resolveSettings(raw: unknown): ZodInfer<TSettingsSchema>;
  resolveSecrets(raw: unknown): TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;
  mergeSettingsOverrides(
    base: ZodInfer<TSettingsSchema>,
    overrides: Record<string, unknown>
  ): ZodInfer<TSettingsSchema>;
  mergeSecretsOverrides(
    base: TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined,
    overrides: Record<string, unknown>
  ): TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;
}

export interface ModuleSettingsDefinitionOptions<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined,
  TSecurity extends ModuleSecurityRegistry<any, any, any> | undefined = undefined
> extends Omit<
    DefineSettingsOptions<TSettingsSchema, TSecretsSchema>,
    'envBindingPresets' | 'envBindingPresetKeys' | 'secretsEnvBindingPresets' | 'secretsEnvBindingPresetKeys'
  > {
  envPresetKeys?: string[];
  envPresets?: EnvBindingPresetLike<ZodInfer<TSettingsSchema>>[];
  secretsEnvPresetKeys?: string[];
  secretsEnvPresets?: EnvBindingPresetLike<
    TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : Record<string, unknown>
  >[];
  security?: TSecurity;
  principalOverrides?: Record<string, string>;
  applyPrincipalDefaults?: (
    settings: ZodInfer<TSettingsSchema>,
    principals: Record<string, string>
  ) => void;
}

export function defineSettings<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined
>(
  options: DefineSettingsOptions<TSettingsSchema, TSecretsSchema>
): DefinedSettings<TSettingsSchema, TSecretsSchema> {
  type Settings = ZodInfer<TSettingsSchema>;
  type Secrets = TSecretsSchema extends ZodTypeAny ? ZodInfer<TSecretsSchema> : undefined;

  const settingsDefaults = () => cloneDeep(options.defaults());
  const secretsDefaults = options.secretsSchema
    ? () =>
        cloneDeep(
          (options.secretsDefaults
            ? options.secretsDefaults()
            : ({} as ZodInfer<NonNullable<TSecretsSchema>>)) as NonNullable<Secrets>
        )
    : undefined;

  const envBindingPresets = normalizeBindingPresets(
    options.envBindingPresets,
    options.envBindingPresetKeys
  );
  const secretsEnvBindingPresets = normalizeBindingPresets(
    options.secretsEnvBindingPresets,
    options.secretsEnvBindingPresetKeys
  );

  function resolveEnv(input: SettingsLoadInput): Record<string, string | undefined> {
    const base = { ...(options.resolveEnv ? options.resolveEnv(input) : input.env ?? process.env) };
    return applyEnvSources(base, options.envSources ?? [], input);
  }

  function resolveSecretsEnv(input: SettingsLoadInput): Record<string, string | undefined> {
    if (options.resolveSecretsEnv) {
      const base = { ...options.resolveSecretsEnv(input) };
      return applyEnvSources(base, options.secretsEnvSources ?? [], input);
    }
    if (input.secretsEnv) {
      const base = { ...input.secretsEnv };
      return applyEnvSources(base, options.secretsEnvSources ?? [], input);
    }
    if (options.resolveEnv) {
      const base = { ...options.resolveEnv(input) };
      return applyEnvSources(base, options.secretsEnvSources ?? [], input);
    }
    const base = { ...(input.env ?? process.env) };
    return applyEnvSources(base, options.secretsEnvSources ?? [], input);
  }

  function buildSettings(env: Record<string, string | undefined>): Settings {
    const draft = settingsDefaults();
    const bindings = [...envBindingPresets, ...(options.envBindings ?? [])];
    if (bindings.length) {
      applyEnvBindings(draft, env, bindings);
    }
    return options.settingsSchema.parse(draft);
  }

  function buildSecrets(env: Record<string, string | undefined>): Secrets {
    if (!options.secretsSchema) {
      return undefined as Secrets;
    }
    const draft = (secretsDefaults ? secretsDefaults() : ({} as NonNullable<Secrets>)) as NonNullable<Secrets>;
    const bindings = [
      ...secretsEnvBindingPresets,
      ...((options.secretsEnvBindings as EnvBinding<NonNullable<Secrets>>[]) ?? [])
    ];
    if (bindings.length) {
      applyEnvBindings(draft, env, bindings as EnvBinding<NonNullable<Secrets>>[]);
    }
    return options.secretsSchema.parse(draft) as Secrets;
  }

  function load(input: SettingsLoadInput = {}): SettingsLoadResult<TSettingsSchema, TSecretsSchema> {
    const env = resolveEnv(input);
    const secretsEnv = resolveSecretsEnv(input);
    const settings = buildSettings(env);
    const secrets = options.secretsSchema ? buildSecrets(secretsEnv) : undefined;
    return { settings, secrets } as SettingsLoadResult<TSettingsSchema, TSecretsSchema>;
  }

  function defaultSettings(): Settings {
    return buildSettings(resolveEnv({}));
  }

  function defaultSecrets(): Secrets {
    if (!options.secretsSchema) {
      return undefined as Secrets;
    }
    return buildSecrets(resolveSecretsEnv({}));
  }

  function mergeSettingsOverrides(
    base: Settings,
    overrides: Record<string, unknown>
  ): Settings {
    const clone = cloneDeep(base);
    mergeInto(clone as PlainObject, overrides);
    return options.settingsSchema.parse(clone);
  }

  function mergeSecretsOverrides(
    base: Secrets,
    overrides: Record<string, unknown>
  ): Secrets {
    if (!options.secretsSchema) {
      return undefined as Secrets;
    }
    const draft = cloneDeep(base ?? ({} as Secrets));
    mergeSecrets(draft as PlainObject, overrides);
    return options.secretsSchema.parse(draft as NonNullable<Secrets>) as Secrets;
  }

  function resolveSettings(raw: unknown): Settings {
    if (!isPlainObject(raw)) {
      return defaultSettings();
    }
    const base = defaultSettings();
    return mergeSettingsOverrides(base, raw);
  }

  function resolveSecrets(raw: unknown): Secrets {
    if (!options.secretsSchema) {
      return undefined as Secrets;
    }
    if (!isPlainObject(raw)) {
      return defaultSecrets();
    }
    const base = defaultSecrets();
    return mergeSecretsOverrides(base, raw);
  }

  return {
    load,
    defaultSettings,
    defaultSecrets,
    resolveSettings,
    resolveSecrets,
    mergeSettingsOverrides,
    mergeSecretsOverrides
  } satisfies DefinedSettings<TSettingsSchema, TSecretsSchema>;
}

export function coerceNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function coerceNullableNumber(
  value: string | undefined,
  fallback: number | null
): number | null {
  if (value === undefined || value === null || value.trim().length === 0) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function coerceBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function applyEnvBindings<TTarget>(
  draft: TTarget,
  env: Record<string, string | undefined>,
  bindings: EnvBinding<TTarget>[]
): void {
  for (const binding of bindings) {
    const raw = env[binding.key];
    if (raw === undefined || raw === null) {
      continue;
    }

    const trimmed = binding.trim === false ? raw : raw.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const current = getPath(draft, binding.path);
    const baseInput = {
      value: trimmed,
      current,
      env,
      draft
    } satisfies EnvBindingInput<TTarget>;

    if (binding.when && !binding.when({ value: trimmed, env, draft })) {
      continue;
    }

    let next: unknown;
    if (binding.map) {
      next = binding.map(baseInput);
    } else if (binding.parse) {
      next = binding.parse(trimmed);
    } else {
      next = trimmed;
    }

    if (next === undefined) {
      continue;
    }

    setPath(draft, binding.path, next);
  }
}

function normalizeBindingPresets<TTarget>(
  presets?: EnvBindingPresetLike<TTarget>[],
  presetKeys?: string[]
): EnvBinding<TTarget>[] {
  const inputs: Array<EnvBindingPresetLike<TTarget>> = [];
  if (presetKeys?.length) {
    for (const key of presetKeys) {
      inputs.push(getEnvBindingPreset<TTarget>(key));
    }
  }
  if (presets?.length) {
    inputs.push(...presets);
  }
  if (inputs.length === 0) {
    return [];
  }
  const resolved: EnvBinding<TTarget>[] = [];
  for (const preset of inputs) {
    if (Array.isArray(preset)) {
      resolved.push(...preset.map((binding) => ({ ...binding })));
      continue;
    }
    if (typeof preset === 'function') {
      resolved.push(...preset().map((binding) => ({ ...binding })));
      continue;
    }
    resolved.push(...preset.resolve().map((binding) => ({ ...binding })));
  }
  return resolved;
}

function applyEnvSources(
  base: Record<string, string | undefined>,
  sources: EnvSourceLike[],
  input: SettingsLoadInput
): Record<string, string | undefined> {
  if (!sources.length) {
    return base;
  }
  for (const source of sources) {
    const handler = typeof source === 'function' ? source : source.resolve.bind(source);
    const result = handler({ ...input, currentEnv: base });
    if (!result) {
      continue;
    }
    const normalized = normalizeEnvSourceResult(result);
    if (normalized.mode === 'fill') {
      for (const [key, value] of Object.entries(normalized.values)) {
        const current = base[key];
        const hasCurrent = typeof current === 'string' && current.trim().length > 0;
        if (!hasCurrent && value !== undefined) {
          base[key] = value;
        }
      }
    } else {
      for (const [key, value] of Object.entries(normalized.values)) {
        if (value === undefined) {
          delete base[key];
        } else {
          base[key] = value;
        }
      }
    }
  }
  return base;
}

function normalizeEnvSourceResult(
  result: EnvSourceResult | Record<string, string | undefined>
): EnvSourceResult {
  if ('values' in result) {
    const sourceResult = result as EnvSourceResult;
    const mode = (sourceResult.mode ?? 'override') as EnvSourceMode;
    return {
      values: Object.assign({}, sourceResult.values),
      mode
    } satisfies EnvSourceResult;
  }
  return {
    values: { ...result },
    mode: 'override'
  } satisfies EnvSourceResult;
}

function hasPrincipalsSlot(value: unknown): value is { principals: Record<string, string> } {
  return Boolean(value) && typeof value === 'object' && 'principals' in (value as Record<string, unknown>);
}

export function createModuleSettingsDefinition<
  TSettingsSchema extends ZodTypeAny,
  TSecretsSchema extends ZodTypeAny | undefined = undefined,
  TSecurity extends ModuleSecurityRegistry<any, any, any> | undefined = undefined
>(
  options: ModuleSettingsDefinitionOptions<TSettingsSchema, TSecretsSchema, TSecurity>
) {
  const {
    envPresetKeys,
    envPresets,
    secretsEnvPresetKeys,
    secretsEnvPresets,
    security,
    principalOverrides,
    applyPrincipalDefaults,
    defaults,
    ...rest
  } = options;

  const principalDefaults = security
    ? security.principalSettings(principalOverrides)
    : undefined;

  const wrappedDefaults = () => {
    const base = defaults();
    if (principalDefaults) {
      if (applyPrincipalDefaults) {
        applyPrincipalDefaults(base, principalDefaults);
      } else if (hasPrincipalsSlot(base)) {
        base.principals = {
          ...principalDefaults,
          ...(base.principals as Record<string, string>)
        } as Record<string, string>;
      }
    }
    return base;
  };

  return defineSettings({
    ...rest,
    defaults: wrappedDefaults,
    envBindingPresetKeys: envPresetKeys,
    envBindingPresets: envPresets,
    secretsEnvBindingPresetKeys: secretsEnvPresetKeys,
    secretsEnvBindingPresets: secretsEnvPresets
  });
}

function mergeInto(target: PlainObject, overrides: Record<string, unknown>): PlainObject {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    if (isPlainObject(value)) {
      const existing = target[key];
      if (isPlainObject(existing)) {
        mergeInto(existing as PlainObject, value as PlainObject);
      } else {
        target[key] = cloneDeep(value) as unknown;
      }
      continue;
    }
    target[key] = value as unknown;
  }
  return target;
}

function mergeSecrets(target: PlainObject, overrides: Record<string, unknown>): PlainObject {
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete target[key];
      continue;
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      delete target[key];
      continue;
    }
    if (isPlainObject(value)) {
      const existing = target[key];
      if (isPlainObject(existing)) {
        mergeSecrets(existing as PlainObject, value as PlainObject);
      } else {
        target[key] = cloneDeep(value);
      }
      continue;
    }
    target[key] = value;
  }
  return target;
}

function cloneDeep<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is PlainObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPath(target: unknown, path: string): unknown {
  if (!path) {
    return target;
  }
  const segments = path.split('.');
  let cursor: any = target as any;
  for (const segment of segments) {
    if (cursor == null) {
      return undefined;
    }
    const key = toKey(segment);
    cursor = cursor[key];
  }
  return cursor;
}

function setPath(target: unknown, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor: any = target as any;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const key = toKey(segment);
    if (index === segments.length - 1) {
      cursor[key] = value;
      return;
    }
    if (!isPlainObject(cursor[key]) && !Array.isArray(cursor[key])) {
      cursor[key] = isNumericKey(segments[index + 1]) ? [] : {};
    }
    cursor = cursor[key];
  }
}

function toKey(segment: string): string | number {
  if (isNumericKey(segment)) {
    return Number(segment);
  }
  return segment;
}

function isNumericKey(value: string): boolean {
  return /^\d+$/.test(value);
}
