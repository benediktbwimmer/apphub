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
import { jsonPath, type JsonPathBuilder } from './jsonPath';

type TriggerValueContext<TMetadata> = { metadata: TMetadata };

export type PredicateBuilder<TSettings> =
  | WorkflowProvisioningEventTriggerPredicate
  | ((context: BuildContext<TSettings>) => WorkflowProvisioningEventTriggerPredicate | null | undefined);

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
    ValueBuilder<TEvent, TriggerValueContext<TTriggerMetadata>, TSettings> | JsonValue
  >;
  metadata?:
    | JsonValue
    | ((context: BuildContext<TSettings>) => JsonValue);
  runKey?: ValueBuilder<TEvent, TriggerValueContext<TTriggerMetadata>, TSettings> | string;
  idempotencyKey?: ValueBuilder<TEvent, TriggerValueContext<TTriggerMetadata>, TSettings> | string;
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
        const builder = ensureBuilder<TEvent, TriggerValueContext<TTriggerMetadata>, TSettings>(value);
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

export function eventField<
  TEvent,
  TValue = unknown,
  TTrigger = unknown,
  TSettings = unknown
>(
  selector: (builder: JsonPathBuilder<TEvent>) => JsonPathBuilder<TValue, any>
): ValueBuilder<TEvent, TTrigger, TSettings> {
  const builder = selector(jsonPath<TEvent>());
  const path = builder.$path as JsonPath<TEvent>;
  return eventPath<TEvent, typeof path, TTrigger, TSettings>(path);
}

export function triggerMetadataField<
  TTriggerMetadata,
  TValue = unknown,
  TEvent = unknown,
  TSettings = unknown
>(
  selector: (builder: JsonPathBuilder<TTriggerMetadata>) => JsonPathBuilder<TValue, any>
): ValueBuilder<TEvent, TriggerValueContext<TTriggerMetadata>, TSettings> {
  const builder = selector(jsonPath<TTriggerMetadata>());
  const metadataPath = (builder.$path ?? '') as string;
  const fullPath = (metadataPath.length > 0
    ? `metadata.${metadataPath}`
    : 'metadata') as JsonPath<TriggerValueContext<TTriggerMetadata>>;
  return triggerPath<
    TriggerValueContext<TTriggerMetadata>,
    JsonPath<TriggerValueContext<TTriggerMetadata>>,
    TEvent,
    TSettings
  >(fullPath);
}

export function predicateEquals(
  path: string,
  value: JsonValue
): WorkflowProvisioningEventTriggerPredicate {
  return {
    path,
    operator: 'equals',
    value
  } satisfies WorkflowProvisioningEventTriggerPredicate;
}

export function predicateExists(path: string): WorkflowProvisioningEventTriggerPredicate {
  return {
    path,
    operator: 'exists'
  } satisfies WorkflowProvisioningEventTriggerPredicate;
}

export function predicateIn(
  path: string,
  values: JsonValue[]
): WorkflowProvisioningEventTriggerPredicate {
  return {
    path,
    operator: 'in',
    values
  } satisfies WorkflowProvisioningEventTriggerPredicate;
}

export function predicateEqualsConfig<TSettings>(
  path: string,
  resolve: (settings: TSettings) => JsonValue
): PredicateBuilder<TSettings> {
  return (context) => predicateEquals(path, resolve(context.settings));
}

export function resolvePredicates<TSettings>(
  context: BuildContext<TSettings>,
  ...builders: PredicateBuilder<TSettings>[]
): WorkflowProvisioningEventTriggerPredicate[] {
  const predicates: WorkflowProvisioningEventTriggerPredicate[] = [];
  for (const builder of builders) {
    if (typeof builder === 'function') {
      const result = builder(context);
      if (result) {
        predicates.push(result);
      }
    } else if (builder) {
      predicates.push(builder);
    }
  }
  return predicates;
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
