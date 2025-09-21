import { randomUUID } from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import process from 'node:process';
import type { SandboxParentMessage, SandboxChildMessage, SandboxStartPayload } from './messages';
import type { SecretReference, JsonValue } from '../../db/types';

const builtinModules = new Set(Module.builtinModules);
for (const name of Module.builtinModules) {
  builtinModules.add(`node:${name}`);
}

type ModuleWithPrivateResolve = typeof Module & {
  _resolveFilename(
    request: string,
    parent?: NodeJS.Module,
    isMain?: boolean,
    options?: unknown
  ): string;
};

const moduleWithPrivateResolve = Module as ModuleWithPrivateResolve;

const BASE_ALLOWED_MODULES = new Set<string>([
  'path',
  'node:path',
  'url',
  'node:url',
  'util',
  'node:util',
  'events',
  'node:events',
  'assert',
  'node:assert',
  'buffer',
  'node:buffer',
  'stream',
  'node:stream',
  'string_decoder',
  'node:string_decoder',
  'timers',
  'node:timers',
  'perf_hooks',
  'node:perf_hooks',
  'async_hooks',
  'node:async_hooks',
  'diagnostics_channel',
  'node:diagnostics_channel',
  'console',
  'node:console',
  'os',
  'node:os',
  'crypto',
  'node:crypto'
]);

const FS_MODULES = new Set<string>([
  'fs',
  'node:fs',
  'fs/promises',
  'node:fs/promises',
  'fs/constants',
  'node:fs/constants'
]);

const NETWORK_MODULES = new Set<string>([
  'http',
  'node:http',
  'https',
  'node:https',
  'net',
  'node:net',
  'tls',
  'node:tls',
  'dns',
  'node:dns',
  'dgram',
  'node:dgram'
]);

const DISALLOWED_MODULES = new Set<string>([
  'child_process',
  'node:child_process',
  'cluster',
  'node:cluster',
  'vm',
  'node:vm',
  'worker_threads',
  'node:worker_threads',
  'repl',
  'node:repl',
  'module',
  'node:module',
  'readline',
  'node:readline',
  'inspector',
  'node:inspector'
]);

function send(message: SandboxChildMessage): void {
  if (typeof process.send === 'function') {
    process.send(message);
  }
}

function ensureWithinBundle(root: string, candidate: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  const relative = path.relative(normalizedRoot, normalizedCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Attempted to access path outside of bundle directory');
  }
}

type PendingRequest = {
  kind: 'update' | 'resolve-secret';
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

type SandboxUpdatePayload = Extract<SandboxChildMessage, { type: 'update-request' }>['updates'];

const pendingRequests = new Map<string, PendingRequest>();
let started = false;

function normalizeMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(meta));
  } catch (err) {
    send({
      type: 'log',
      level: 'warn',
      message: 'Failed to serialize log metadata',
      meta: {
        error: err instanceof Error ? err.message : String(err)
      }
    });
    return undefined;
  }
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const item of value) {
      const converted = toJsonValue(item);
      if (converted !== undefined) {
        result.push(converted);
      }
    }
    return result;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const result: Record<string, JsonValue> = {};
    for (const [key, entryValue] of entries) {
      const converted = toJsonValue(entryValue);
      if (converted !== undefined) {
        result[key] = converted;
      }
    }
    return result;
  }
  return undefined;
}

function normalizeUpdates(updates: {
  parameters?: unknown;
  logsUrl?: string | null;
  metrics?: unknown;
  context?: unknown;
  timeoutMs?: number | null;
}): SandboxUpdatePayload {
  const result: SandboxUpdatePayload = {};
  if (updates.parameters !== undefined) {
    const value = toJsonValue(updates.parameters);
    if (value !== undefined) {
      result.parameters = value;
    }
  }
  if (updates.logsUrl !== undefined) {
    result.logsUrl = updates.logsUrl ?? null;
  }
  if (updates.metrics !== undefined) {
    const value = toJsonValue(updates.metrics);
    if (value !== undefined) {
      result.metrics = value;
    }
  }
  if (updates.context !== undefined) {
    const value = toJsonValue(updates.context);
    if (value !== undefined) {
      result.context = value;
    }
  }
  if (updates.timeoutMs !== undefined) {
    result.timeoutMs = updates.timeoutMs ?? null;
  }
  return result;
}

function sanitizeForIpc<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch (err) {
    throw new Error(
      `Failed to serialize sandbox payload: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function makeLogger(taskId: string) {
  return (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => {
    const normalized = normalizeMeta(meta) ?? {};
    normalized.sandboxTaskId = taskId;
    send({ type: 'log', level, message, meta: normalized });
  };
}

function setupModuleGuards(bundleDir: string, capabilities: string[]): void {
  const allowedBuiltins = new Set<string>(BASE_ALLOWED_MODULES);
  let allowFs = false;
  let allowNetwork = false;
  for (const capability of capabilities) {
    if (capability === 'fs') {
      allowFs = true;
    }
    if (capability === 'network') {
      allowNetwork = true;
    }
  }
  if (allowFs) {
    for (const name of FS_MODULES) {
      allowedBuiltins.add(name);
    }
  }
  if (allowNetwork) {
    for (const name of NETWORK_MODULES) {
      allowedBuiltins.add(name);
    }
  }

  const originalResolveFilename = moduleWithPrivateResolve._resolveFilename;
  moduleWithPrivateResolve._resolveFilename = function patchedResolve(
    this: NodeJS.Module | typeof Module,
    request: string,
    parent: NodeJS.Module | undefined,
    isMain: boolean,
    options?: unknown
  ): string {
    if (DISALLOWED_MODULES.has(request) || DISALLOWED_MODULES.has(stripNodePrefix(request))) {
      throw new Error(`Access to module \"${request}\" is not permitted inside sandbox`);
    }

    if (isBuiltinRequest(request)) {
      const normalized = normalizeRequest(request);
      if (!allowedBuiltins.has(normalized) && !allowedBuiltins.has(request)) {
        throw new Error(`Bundle is not authorized to require built-in module \"${request}\"`);
      }
      return originalResolveFilename.call(this, request, parent, isMain, options);
    }

    const resolved = originalResolveFilename.call(this, request, parent, isMain, options);
    ensureWithinBundle(bundleDir, resolved);
    return resolved;
  };

  if (!allowNetwork && typeof globalThis.fetch === 'function') {
    globalThis.fetch = async () => {
      throw new Error('Network access requires declaring the "network" capability');
    };
  }

  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code ?? 0}) is disabled inside sandbox`);
  }) as typeof process.exit;

  process.chdir(bundleDir);

  function isBuiltinRequest(request: string): boolean {
    return builtinModules.has(request) || builtinModules.has(stripNodePrefix(request));
  }

  function stripNodePrefix(request: string): string {
    return request.startsWith('node:') ? request.slice(5) : request;
  }

  function normalizeRequest(request: string): string {
    const stripped = stripNodePrefix(request);
    return request.startsWith('node:') ? `node:${stripped}` : stripped;
  }
}

async function executeStart(payload: SandboxStartPayload): Promise<void> {
  const taskId = payload.taskId;
  const logger = makeLogger(payload.taskId);
  setupModuleGuards(payload.bundle.directory, payload.bundle.manifest.capabilities ?? []);

  const entryFile = path.resolve(payload.bundle.entryFile);
  ensureWithinBundle(payload.bundle.directory, entryFile);

  let handler: unknown;
  try {
    delete require.cache[entryFile];
    const exports = require(entryFile);
    if (payload.bundle.exportName) {
      handler = (exports as Record<string, unknown>)[payload.bundle.exportName];
    } else if (exports && typeof (exports as Record<string, unknown>).handler === 'function') {
      handler = (exports as Record<string, unknown>).handler;
    } else if (typeof exports === 'function') {
      handler = exports;
    } else if (exports && typeof (exports as Record<string, unknown>).default === 'function') {
      handler = (exports as Record<string, unknown>).default;
    }
  } catch (err) {
    throw new Error(`Failed to load bundle entry: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (typeof handler !== 'function') {
    throw new Error('Bundle entry did not export a callable handler');
  }

  const startTime = Date.now();

  const context = {
    definition: payload.job.definition,
    run: payload.job.run,
    parameters: payload.job.parameters,
    logger(message: string, meta?: Record<string, unknown>) {
      logger('info', message, meta);
    },
    async update(updates: {
      parameters?: unknown;
      logsUrl?: string | null;
      metrics?: unknown;
      context?: unknown;
      timeoutMs?: number | null;
    }) {
      const requestId = randomUUID();
      const normalizedUpdates = normalizeUpdates(updates ?? {});
      const serializedUpdates = sanitizeForIpc(normalizedUpdates);
      const promise = new Promise<typeof payload.job.run>((resolve, reject) => {
        pendingRequests.set(requestId, {
          kind: 'update',
          resolve: (value) => {
            resolve(value as typeof payload.job.run);
          },
          reject: (err) => {
            reject(err);
          }
        });
      });
      send({ type: 'update-request', requestId, updates: serializedUpdates });
      const updatedRun = await promise;
      context.run = updatedRun;
      context.parameters = updatedRun.parameters;
      return updatedRun;
    },
    resolveSecret(reference: SecretReference): Promise<string | null> {
      const requestId = randomUUID();
      const promise = new Promise<string | null>((resolve, reject) => {
        pendingRequests.set(requestId, {
          kind: 'resolve-secret',
          resolve: (value) => {
            resolve((value as string | null) ?? null);
          },
          reject: (err) => {
            reject(err);
          }
        });
      });
      send({ type: 'resolve-secret-request', requestId, reference });
      return promise;
    }
  };

  try {
    const result = await Promise.resolve((handler as (ctx: typeof context) => unknown)(context));
    const durationMs = Date.now() - startTime;
    const serializedResult = sanitizeForIpc(result ?? {});
    send({
      type: 'result',
      result: serializedResult as any,
      durationMs,
      resourceUsage: process.resourceUsage()
    });
  } catch (err) {
    logger('error', 'Handler threw error', {
      error: err instanceof Error ? err.message : String(err)
    });
    throw err instanceof Error ? err : new Error(String(err));
  }
}

process.on('message', async (message: SandboxParentMessage) => {
  try {
    if (message.type === 'start') {
      if (started) {
        throw new Error('Sandbox received duplicate start message');
      }
      started = true;
      await executeStart(message.payload);
    } else if (message.type === 'update-response') {
      const pending = pendingRequests.get(message.requestId);
      if (!pending || pending.kind !== 'update') {
        return;
      }
      pendingRequests.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.run);
      } else {
        pending.reject(new Error(message.error));
      }
    } else if (message.type === 'resolve-secret-response') {
      const pending = pendingRequests.get(message.requestId);
      if (!pending || pending.kind !== 'resolve-secret') {
        return;
      }
      pendingRequests.delete(message.requestId);
      if (message.ok) {
        pending.resolve(message.value);
      } else {
        pending.reject(new Error(message.error));
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const pending of pendingRequests.values()) {
      pending.reject(error);
    }
    pendingRequests.clear();
    send({
      type: 'error',
      error: {
        message: error.message,
        stack: error.stack
      }
    });
  }
});

process.on('uncaughtException', (err) => {
  const error = err instanceof Error ? err : new Error(String(err));
  for (const pending of pendingRequests.values()) {
    pending.reject(error);
  }
  pendingRequests.clear();
  send({
    type: 'error',
    error: {
      message: error.message,
      stack: error.stack
    }
  });
});

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  for (const pending of pendingRequests.values()) {
    pending.reject(err);
  }
  pendingRequests.clear();
  send({
    type: 'error',
    error: {
      message: err.message,
      stack: err.stack
    }
  });
});
