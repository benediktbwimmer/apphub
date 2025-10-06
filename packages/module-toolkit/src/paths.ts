import type { JsonValue } from './types';

type Primitive = string | number | boolean | bigint | symbol | null | undefined | Date; // treat Date as primitive

export type JsonPath<T, Prefix extends string = ''> =
  T extends Primitive
    ? never
    : T extends Array<infer U>
      ? Prefix extends ''
        ? `${Prefix}${string}`
        : `${Prefix}${string}` | JsonPath<U, `${Prefix}${string}.`>
      : {
          [K in Extract<keyof T, string>]:
            T[K] extends Primitive | JsonValue[]
              ? `${Prefix}${K}`
              : `${Prefix}${K}` | JsonPath<T[K], `${Prefix}${K}.`>
        }[Extract<keyof T, string>];

export type AnyJsonPath = string & {};

export function ensurePath(path: string): string {
  if (!path || typeof path !== 'string') {
    throw new Error('path must be a non-empty string');
  }
  return path;
}
