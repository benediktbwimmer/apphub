type DuckDbModule = typeof import('duckdb');

type DuckDbBindingModule = DuckDbModule & {
  Connection?: {
    new (...args: unknown[]): unknown;
    prototype: Record<string, unknown>;
  };
  Statement?: DuckDbStatementCtor;
};

type DuckDbStatementCtor = {
  new (connection: unknown, sql: string): DuckDbStatement;
};

type DuckDbStatement = {
  run: (...args: unknown[]) => unknown;
  all: (...args: unknown[]) => unknown;
};

type PossiblyCloseable = {
  close?: (...args: unknown[]) => unknown;
};

type Closeable = {
  close: (...args: unknown[]) => unknown;
};

let cachedDuckDb: DuckDbModule | null = null;

/**
 * Loads the DuckDB module while remaining compatible with sandboxed runtimes
 * that disallow child process execution. If the standard import path fails
 * (because `@mapbox/node-pre-gyp` tries to spawn), we fall back to the compiled
 * binding and re-apply the small helper shims the wrapper normally installs.
 */
export function loadDuckDb(): DuckDbModule {
  if (cachedDuckDb) {
    return cachedDuckDb;
  }

  try {
    const resolved = require('duckdb') as DuckDbModule;
    cachedDuckDb = resolved;
    return resolved;
  } catch (error) {
    // Fall through to the binding fallback below.
  }

  const bindingPath = require.resolve('duckdb/lib/binding/duckdb.node');
  const bindingModule = require(bindingPath) as DuckDbBindingModule;
  const shimmed = applyDuckDbFallbackShims(bindingModule);
  cachedDuckDb = shimmed;
  return shimmed;
}

function applyDuckDbFallbackShims(binding: DuckDbBindingModule): DuckDbModule {
  const connectionCtor = binding.Connection;
  const statementCtor = binding.Statement;
  if (!connectionCtor || !statementCtor) {
    return binding as unknown as DuckDbModule;
  }

  const prototype = connectionCtor.prototype as Record<string, unknown>;

  if (typeof prototype.run !== 'function') {
    prototype.run = function run(this: unknown, sql: string, ...params: unknown[]) {
      const statement = new statementCtor(this, sql);
      return statement.run.apply(statement, [sql, ...params]);
    };
  }

  if (typeof prototype.all !== 'function') {
    prototype.all = function all(this: unknown, sql: string, ...params: unknown[]) {
      const statement = new statementCtor(this, sql);
      return statement.all.apply(statement, [sql, ...params]);
    };
  }

  return binding as unknown as DuckDbModule;
}

export type DuckDbModuleType = DuckDbModule;

export function isCloseable(value: unknown): value is Closeable {
  return Boolean(value && typeof (value as PossiblyCloseable).close === 'function');
}
