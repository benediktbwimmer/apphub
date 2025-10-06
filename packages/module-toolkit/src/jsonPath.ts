export type JsonPathBuilder<
  T,
  Prefix extends string = ''
> = {
  readonly $path: Prefix;
} & (
  T extends (infer U)[]
    ? JsonPathBuilder<U, Prefix extends '' ? `${number}` : `${Prefix}.${number}`>
    : T extends object
      ? {
          [K in keyof T & string]: JsonPathBuilder<
            T[K],
            Prefix extends '' ? `${K}` : `${Prefix}.${K}`
          >;
        }
      : unknown
);

const PATH_SYMBOL = Symbol('jsonPath');

export type JsonPathProxy<T> = JsonPathBuilder<T> & {
  readonly [PATH_SYMBOL]: string;
};

function createProxy(prefix: string): any {
  const target = () => undefined;
  return new Proxy(target, {
    get(_target, prop) {
      if (prop === '$path' || prop === PATH_SYMBOL) {
        return prefix;
      }
      const key = String(prop);
      const next = prefix ? `${prefix}.${key}` : key;
      return createProxy(next);
    },
    apply(_target, _thisArg, args) {
      if (args.length > 0) {
        const key = String(args[0]);
        const next = prefix ? `${prefix}.${key}` : key;
        return createProxy(next);
      }
      return prefix;
    }
  });
}

export function jsonPath<T>(): JsonPathBuilder<T> {
  return createProxy('');
}

export function collectPaths<T, TResult extends Record<string, string>>(
  selector: (builder: JsonPathBuilder<T>) => TResult
): TResult {
  const builder = jsonPath<T>();
  return selector(builder);
}
