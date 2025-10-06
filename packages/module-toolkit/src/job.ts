import type { BuildContext, JsonValue } from './types';
import { ValueBuilder, fromConstant } from './valueBuilder';

export interface JobDefinitionBuilder<TSettings> {
  slug: string;
  build(context: BuildContext<TSettings>): Record<string, JsonValue | string>;
}

export interface JobDefinitionOptions<TSettings> {
  slug: string;
  parameters: Record<string, ValueBuilder<unknown, unknown, TSettings> | JsonValue>;
}

type ParametersOnly<TSettings> = Record<string, ValueBuilder<unknown, unknown, TSettings> | JsonValue>;

export function defineJobParameters<TSettings>(
  options: JobDefinitionOptions<TSettings>
): JobDefinitionBuilder<TSettings>;

export function defineJobParameters<TSettings>(
  parameters: ParametersOnly<TSettings>
): JobDefinitionBuilder<TSettings>;

export function defineJobParameters<TSettings>(
  input: JobDefinitionOptions<TSettings> | ParametersOnly<TSettings>
): JobDefinitionBuilder<TSettings> {
  const slug = typeof (input as JobDefinitionOptions<TSettings>).slug === 'string'
    ? (input as JobDefinitionOptions<TSettings>).slug
    : 'job';

  const parameters = typeof (input as JobDefinitionOptions<TSettings>).slug === 'string'
    ? (input as JobDefinitionOptions<TSettings>).parameters
    : (input as ParametersOnly<TSettings>);

  const entries = Object.entries(parameters);
  return {
    slug,
    build(context: BuildContext<TSettings>): Record<string, JsonValue | string> {
      const result: Record<string, JsonValue | string> = {};
      for (const [key, value] of entries) {
        const builder = value instanceof ValueBuilder ? value : fromConstant(value);
        const compiled = builder.build(context);
        if (compiled.type === 'literal') {
          result[key] = compiled.value;
        } else {
          result[key] = compiled.template;
        }
      }
      return result;
    }
  };
}
