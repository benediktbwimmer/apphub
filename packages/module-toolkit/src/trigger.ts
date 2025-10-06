import type {
  WorkflowProvisioningEventTrigger,
  WorkflowProvisioningEventTriggerPredicate
} from '@apphub/module-registry';
import type { BuildContext, JsonValue } from './types';
import {
  ValueBuilder,
  eventValue,
  triggerValue,
  configValue,
  fromConstant
} from './valueBuilder';
import type { JsonPath } from './paths';

export interface TriggerOptions<TEvent, TTriggerMetadata, TSettings> {
  slug: string;
  workflowSlug: string;
  name: string;
  description?: string;
  eventType: string;
  eventSource?: string;
  predicates?:
    | WorkflowProvisioningEventTriggerPredicate[]
    | ((context: BuildContext<TSettings>) => WorkflowProvisioningEventTriggerPredicate[]);
  parameters?: Record<
    string,
    ValueBuilder<TEvent, TTriggerMetadata, TSettings> | JsonValue
  >;
  metadata?:
    | JsonValue
    | ((context: BuildContext<TSettings>) => JsonValue);
  runKey?: ValueBuilder<TEvent, TTriggerMetadata, TSettings> | string;
  idempotencyKey?: ValueBuilder<TEvent, TTriggerMetadata, TSettings> | string;
}

export interface TriggerBuildContext<TSettings> extends BuildContext<TSettings> {}

export interface TriggerDefinitionBuilder<TSettings> {
  slug: string;
  workflowSlug: string;
  build(context: TriggerBuildContext<TSettings>): WorkflowProvisioningEventTrigger;
}

export function defineTrigger<
  TEvent,
  TTriggerMetadata,
  TSettings
>(options: TriggerOptions<TEvent, TTriggerMetadata, TSettings>): TriggerDefinitionBuilder<TSettings> {
  const parameterEntries = Object.entries(options.parameters ?? {});

  return {
    slug: options.slug,
    workflowSlug: options.workflowSlug,
    build(context: TriggerBuildContext<TSettings>): WorkflowProvisioningEventTrigger {
      const parameterTemplate: Record<string, unknown> = {};

      for (const [key, value] of parameterEntries) {
        const builder = ensureBuilder<TEvent, TTriggerMetadata, TSettings>(value);
        const result = builder.build(context);
        if (result.type === 'literal') {
          parameterTemplate[key] = result.value;
        } else {
          parameterTemplate[key] = result.template;
        }
      }

      const metadata = typeof options.metadata === 'function'
        ? options.metadata(context)
        : options.metadata;

      const predicates = typeof options.predicates === 'function'
        ? options.predicates(context)
        : options.predicates;

      const trigger: WorkflowProvisioningEventTrigger = {
        name: options.name,
        eventType: options.eventType,
        description: options.description,
        eventSource: options.eventSource,
        predicates: predicates ?? [],
        parameterTemplate: Object.keys(parameterTemplate).length > 0
          ? (parameterTemplate as Record<string, JsonValue | string>)
          : undefined,
        metadata: metadata as JsonValue | undefined,
        runKeyTemplate: resolveTemplate(options.runKey, context),
        idempotencyKeyExpression: resolveTemplate(options.idempotencyKey, context)
      };

      return trigger;
    }
  } satisfies TriggerDefinitionBuilder<TSettings>;
}

export function eventPath<
  TEvent,
  Path extends JsonPath<TEvent>,
  TTrigger = unknown,
  TSettings = unknown
>(path: Path): ValueBuilder<TEvent, TTrigger, TSettings> {
  return new ValueBuilder([eventValue(path)]);
}

export function triggerPath<
  TTriggerMetadata,
  Path extends JsonPath<TTriggerMetadata>,
  TEvent = unknown,
  TSettings = unknown
>(path: Path): ValueBuilder<TEvent, TTriggerMetadata, TSettings> {
  return new ValueBuilder([triggerValue(path)]);
}

export function fromConfig<
  TSettings,
  TResult extends JsonValue | undefined,
  TEvent = unknown,
  TTrigger = unknown
>(resolver: (settings: TSettings) => TResult): ValueBuilder<TEvent, TTrigger, TSettings> {
  return new ValueBuilder([configValue(resolver)]);
}

export function literal<
  TEvent = unknown,
  TTrigger = unknown,
  TSettings = unknown
>(value: JsonValue): ValueBuilder<TEvent, TTrigger, TSettings> {
  return fromConstant<TEvent, TTrigger, TSettings>(value);
}

function ensureBuilder<TEvent, TTrigger, TSettings>(
  value: ValueBuilder<TEvent, TTrigger, TSettings> | JsonValue
): ValueBuilder<TEvent, TTrigger, TSettings> {
  if (value instanceof ValueBuilder) {
    return value;
  }
  return fromConstant(value);
}

function resolveTemplate<TEvent, TTrigger, TSettings>(
  input: ValueBuilder<TEvent, TTrigger, TSettings> | string | undefined,
  context: BuildContext<TSettings>
): string | undefined {
  if (!input) {
    return undefined;
  }
  if (typeof input === 'string') {
    return input;
  }
  const result = input.build(context);
  if (result.type === 'literal') {
    return typeof result.value === 'string' ? result.value : JSON.stringify(result.value);
  }
  return result.template;
}
