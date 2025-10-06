import type { WorkflowProvisioningEventTrigger } from '@apphub/module-registry';
import type {
  TriggerDefinitionBuilder,
  TriggerBuildContext
} from './trigger';
import type { JobDefinitionBuilder } from './job';
import type { BuildContext, JsonValue } from './types';

export interface TriggerRegistry<
  TSettings,
  TMap extends Record<string, TriggerDefinitionBuilder<TSettings>>
> {
  entries: TMap;
  slugs: Array<keyof TMap & string>;
  get<Slug extends keyof TMap & string>(slug: Slug): TMap[Slug];
  buildAll(context: TriggerBuildContext<TSettings>): WorkflowProvisioningEventTrigger[];
}

export function createTriggerRegistry<
  TSettings,
  TMap extends Record<string, TriggerDefinitionBuilder<TSettings>>
>(entries: TMap): TriggerRegistry<TSettings, TMap> {
  const slugs = Object.keys(entries) as Array<keyof TMap & string>;

  for (const slug of slugs) {
    const builder = entries[slug];
    if (!builder) {
      throw new Error(`Trigger '${slug}' is undefined`);
    }
    if (builder.slug !== slug) {
      throw new Error(
        `Trigger entry key '${slug}' does not match builder slug '${builder.slug}'`
      );
    }
  }

  function get<Slug extends keyof TMap & string>(slug: Slug): TMap[Slug] {
    const builder = entries[slug];
    if (!builder) {
      throw new Error(`Trigger '${slug}' is not registered`);
    }
    return builder;
  }

  function buildAll(context: TriggerBuildContext<TSettings>) {
    return slugs.map((slug) => get(slug).build(context));
  }

  return {
    entries,
    slugs,
    get,
    buildAll
  } satisfies TriggerRegistry<TSettings, TMap>;
}

export interface JobRegistry<
  TSettings,
  TMap extends Record<string, JobDefinitionBuilder<TSettings>>
> {
  entries: TMap;
  slugs: Array<keyof TMap & string>;
  get<Slug extends keyof TMap & string>(slug: Slug): TMap[Slug];
  buildAll(context: BuildContext<TSettings>): Record<string, JsonValue | string>[];
}

export function createJobRegistry<
  TSettings,
  TMap extends Record<string, JobDefinitionBuilder<TSettings>>
>(entries: TMap): JobRegistry<TSettings, TMap> {
  const slugs = Object.keys(entries) as Array<keyof TMap & string>;

  for (const slug of slugs) {
    const builder = entries[slug];
    if (!builder) {
      throw new Error(`Job '${slug}' is undefined`);
    }
    if (builder.slug !== slug && builder.slug !== 'job') {
      throw new Error(`Job entry key '${slug}' does not match builder slug '${builder.slug}'`);
    }
  }

  function get<Slug extends keyof TMap & string>(slug: Slug): TMap[Slug] {
    const builder = entries[slug];
    if (!builder) {
      throw new Error(`Job '${slug}' is not registered`);
    }
    return builder;
  }

  function buildAll(context: BuildContext<TSettings>) {
    return slugs.map((slug) => get(slug).build(context));
  }

  return {
    entries,
    slugs,
    get,
    buildAll
  } satisfies JobRegistry<TSettings, TMap>;
}

export interface TargetRegistry<
  TMap extends Record<string, TTarget>,
  TTarget = TMap[keyof TMap & string]
> {
  entries: TMap;
  slugs: Array<keyof TMap & string>;
  get<Slug extends keyof TMap & string>(slug: Slug): TMap[Slug];
  values(): TTarget[];
}

export function createTargetRegistry<
  TMap extends Record<string, TTarget>,
  TTarget = TMap[keyof TMap & string]
>(entries: TMap): TargetRegistry<TMap, TTarget> {
  const slugs = Object.keys(entries) as Array<keyof TMap & string>;

  for (const slug of slugs) {
    const target = entries[slug];
    if (!target) {
      throw new Error(`Target '${slug}' is undefined`);
    }
  }

  function get<Slug extends keyof TMap & string>(slug: Slug): TMap[Slug] {
    const target = entries[slug];
    if (!target) {
      throw new Error(`Target '${slug}' is not registered`);
    }
    return target;
  }

  function values(): TTarget[] {
    return slugs.map((slug) => get(slug));
  }

  return {
    entries,
    slugs,
    get,
    values
  } satisfies TargetRegistry<TMap, TTarget>;
}

type TargetMap<TTarget extends { name: string }> = {
  [Name in TTarget['name']]: Extract<TTarget, { name: Name }>;
};

export function createTargetRegistryFromArray<TTarget extends { name: string }>(
  targets: readonly TTarget[]
): TargetRegistry<TargetMap<TTarget>, TTarget> {
  const entries = Object.fromEntries(targets.map((target) => [target.name, target])) as TargetMap<TTarget>;
  return createTargetRegistry(entries);
}
