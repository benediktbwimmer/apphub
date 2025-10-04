import type { ValueDescriptor } from './types';

export interface DescriptorOptions<T> {
  defaults?: T;
}

export function descriptorFromParser<T>(
  parser: (value: unknown) => T,
  options: DescriptorOptions<T> = {}
): ValueDescriptor<T> {
  return {
    defaults: options.defaults,
    resolve: (raw) => parser(raw ?? options.defaults)
  } satisfies ValueDescriptor<T>;
}

export function zodDescriptor<T>(
  schema: { parse: (value: unknown) => T },
  options: DescriptorOptions<T> = {}
): ValueDescriptor<T> {
  return descriptorFromParser((value) => schema.parse(value ?? options.defaults), options);
}

export function jsonDescriptor<T>(options: DescriptorOptions<T> = {}): ValueDescriptor<T> {
  return {
    defaults: options.defaults,
    resolve: (raw) => (raw === undefined ? (options.defaults as T) : (raw as T))
  } satisfies ValueDescriptor<T>;
}
