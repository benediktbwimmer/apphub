import type { BuildContext, BuildResult, JsonValue } from './types';
import { ensurePath } from './paths';

export type ConfigResolver<TSettings> = (settings: TSettings) => JsonValue | undefined;

export type ValueSourceKind = 'event' | 'trigger' | 'config' | 'constant';

type AnyValueBuilder = ValueBuilder<any, any, any>;

interface EventSource {
  kind: 'event';
  path: string;
}

interface TriggerSource {
  kind: 'trigger';
  path: string;
}

interface ConfigSource<TSettings> {
  kind: 'config';
  resolve: ConfigResolver<TSettings>;
}

interface ConstantSource {
  kind: 'constant';
  value: JsonValue;
}

export type ValueSource<TEvent, TTrigger, TSettings> =
  | EventSource
  | TriggerSource
  | ConfigSource<TSettings>
  | ConstantSource;

export type ValueResolvable<TEvent, TTrigger, TSettings> =
  | ValueBuilder<TEvent, TTrigger, TSettings>
  | ValueSource<TEvent, TTrigger, TSettings>
  | JsonValue;

export class ValueBuilder<TEvent, TTrigger, TSettings> {
  private readonly chain: ValueSource<TEvent, TTrigger, TSettings>[];

  constructor(sources: ValueSource<TEvent, TTrigger, TSettings>[]) {
    if (!sources.length) {
      throw new Error('ValueBuilder requires at least one source');
    }
    this.chain = sources;
  }

  public fallback(
    resolvable: ValueResolvable<TEvent, TTrigger, TSettings>
  ): ValueBuilder<TEvent, TTrigger, TSettings> {
    const sources = normalizeValueSources(resolvable);
    return new ValueBuilder([...this.chain, ...sources]);
  }

  public default(value: JsonValue): ValueBuilder<TEvent, TTrigger, TSettings> {
    return this.fallback(value);
  }

  public build(context: BuildContext<TSettings>): BuildResult {
    const segments = this.chain.map((source) => compileSource(source, context));

    const hasDynamic = segments.some((segment) => segment.type === 'dynamic');
    const hasFallback = segments.length > 1;

    if (!hasDynamic && !hasFallback) {
      const first = segments[0];
      if (first.type === 'literal') {
        return { type: 'literal', value: first.value };
      }
    }

    const expression = segments.reduce((acc, segment, index) => {
      const rendered = renderSegment(segment);
      if (index === 0) {
        return rendered;
      }
      return `${acc} | default: ${rendered}`;
    }, '');

    return {
      type: 'template',
      template: `{{ ${expression} }}`
    } satisfies BuildResult;
  }

  public toSources(): ValueSource<TEvent, TTrigger, TSettings>[] {
    return [...this.chain];
  }
}

type CompiledSegment =
  | { type: 'dynamic'; expr: string }
  | { type: 'literal'; value: JsonValue }
  | { type: 'literal-template'; expr: string };

function compileSource<TEvent, TTrigger, TSettings>(
  source: ValueSource<TEvent, TTrigger, TSettings>,
  context: BuildContext<TSettings>
): CompiledSegment {
  switch (source.kind) {
    case 'event':
      return { type: 'dynamic', expr: `event.${normalizePath(source.path)}` };
    case 'trigger':
      return { type: 'dynamic', expr: `trigger.${normalizePath(source.path)}` };
    case 'config': {
      const value = source.resolve(context.settings);
      return { type: 'literal', value: value ?? null };
    }
    case 'constant':
      return { type: 'literal', value: source.value };
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

function renderSegment(segment: CompiledSegment): string {
  if (segment.type === 'dynamic') {
    return segment.expr;
  }

  const value = segment.type === 'literal' ? segment.value : segment.expr;
  return renderLiteral(value);
}

function renderLiteral(value: JsonValue): string {
  if (value === null) {
    return 'nil';
  }
  if (typeof value === 'string') {
    return `'${escapeSingleQuotes(value)}'`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return `'${escapeSingleQuotes(JSON.stringify(value))}'`;
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function normalizePath(path: string): string {
  return ensurePath(path).replace(/^\.+/, '');
}

function normalizeValueSources<TEvent, TTrigger, TSettings>(
  resolvable: ValueResolvable<TEvent, TTrigger, TSettings>
): ValueSource<TEvent, TTrigger, TSettings>[] {
  if (resolvable instanceof ValueBuilder) {
    return resolvable.toSources();
  }
  if (typeof resolvable === 'object' && resolvable !== null && 'kind' in resolvable) {
    return [resolvable as ValueSource<TEvent, TTrigger, TSettings>];
  }
  return [{ kind: 'constant', value: resolvable as JsonValue }];
}

export function eventValue<TEvent, Path extends string>(path: Path): EventSource {
  return { kind: 'event', path: ensurePath(path) };
}

export function triggerValue<Path extends string>(path: Path): TriggerSource {
  return { kind: 'trigger', path: ensurePath(path) };
}

export function configValue<TSettings>(resolver: ConfigResolver<TSettings>): ConfigSource<TSettings> {
  return { kind: 'config', resolve: resolver };
}

export function constantValue(value: JsonValue): ConstantSource {
  return { kind: 'constant', value };
}

export function fromSource<TEvent, TTrigger, TSettings>(
  source: ValueSource<TEvent, TTrigger, TSettings>
): ValueBuilder<TEvent, TTrigger, TSettings> {
  return new ValueBuilder([source]);
}

export function fromConstant<TEvent, TTrigger, TSettings>(
  value: JsonValue
): ValueBuilder<TEvent, TTrigger, TSettings> {
  return new ValueBuilder([{ kind: 'constant', value }]);
}
