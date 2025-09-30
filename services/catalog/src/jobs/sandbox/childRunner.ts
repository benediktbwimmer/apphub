import { randomUUID } from 'node:crypto';
import Module from 'node:module';
import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import type { SandboxParentMessage, SandboxChildMessage, SandboxStartPayload } from './messages';
import type { SecretReference, JsonValue } from '../../db/types';
import type { JobResult } from '../runtime';
import {
  parseWorkflowEventContext,
  runWithWorkflowEventContext,
  serializeWorkflowEventContext,
  WORKFLOW_EVENT_CONTEXT_ENV,
  type WorkflowEventContext
} from '../../workflowEventContext';

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

if (typeof Error.stackTraceLimit === 'number') {
  Error.stackTraceLimit = Math.max(Error.stackTraceLimit, 50);
}

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
  'node:fs/constants',
  'zlib',
  'node:zlib',
  'zlib/constants',
  'node:zlib/constants'
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

function canonicalizePath(target: string): string {
  const resolved = path.resolve(target);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function ensureWithinBundle(root: string, candidate: string): void {
  const normalizedRoot = canonicalizePath(root);
  const normalizedCandidate = canonicalizePath(candidate);
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

const HOST_ROOT_PREFIX_ENV = 'APPHUB_SANDBOX_HOST_ROOT_PREFIX';
const HOST_ROOT_PATCH_MARK = '__apphubHostRootPrefixPatched';

function installHostRootAutoPrefix(hostRootRaw: string | undefined): void {
  if (!hostRootRaw) {
    return;
  }
  const normalizedRoot = path.resolve(hostRootRaw);
  if (!path.isAbsolute(normalizedRoot)) {
    return;
  }
  const globalKey = HOST_ROOT_PATCH_MARK as keyof typeof globalThis;
  if ((globalThis as Record<string, unknown>)[globalKey]) {
    return;
  }
  (globalThis as Record<string, unknown>)[globalKey] = normalizedRoot;

  const originalExistsSync = fs.existsSync.bind(fs);

  const translatePath = (candidate: unknown): unknown => {
    if (typeof candidate !== 'string') {
      return candidate;
    }

    if (!path.isAbsolute(candidate)) {
      return candidate;
    }

    const normalizedCandidate = path.resolve(candidate);
    if (
      normalizedCandidate === normalizedRoot ||
      normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      return normalizedCandidate;
    }

    if (originalExistsSync(normalizedCandidate)) {
      return normalizedCandidate;
    }

    const relativeFromRoot = path.relative('/', normalizedCandidate);
    return path.join(normalizedRoot, relativeFromRoot);
  };

  type PatchedFunction = ((...args: unknown[]) => unknown) & {
    [HOST_ROOT_PATCH_MARK]?: boolean;
  };

  const markPatched = (fn: PatchedFunction): void => {
    Object.defineProperty(fn, HOST_ROOT_PATCH_MARK, {
      value: true,
      enumerable: false,
      configurable: true
    });
  };

  const wrapMethod = (target: Record<string, unknown>, method: string, indexes: number[]) => {
    const original = target[method] as PatchedFunction | undefined;
    if (typeof original !== 'function') {
      return;
    }
    if (original[HOST_ROOT_PATCH_MARK]) {
      return;
    }
    const patched: PatchedFunction = function patchedFsMethod(this: unknown, ...args: unknown[]) {
      for (const index of indexes) {
        if (index < args.length) {
          const value = args[index];
          if (typeof value === 'string') {
            args[index] = translatePath(value);
          }
        }
      }
      return original.apply(this, args);
    };
    markPatched(patched);
    markPatched(original);
    target[method] = patched as unknown;
  };

  const wrapFsMethod = (method: string, indexes: number[]) => {
    wrapMethod(fs as unknown as Record<string, unknown>, method, indexes);
    const syncName = `${method}Sync`;
    wrapMethod(fs as unknown as Record<string, unknown>, syncName, indexes);
  };

  const wrapFsOnlyMethod = (method: string, indexes: number[]) => {
    wrapMethod(fs as unknown as Record<string, unknown>, method, indexes);
  };

const wrapFsPromisesMethod = (method: string, indexes: number[]) => {
    const promises = fs.promises as unknown as Record<string, unknown>;
    wrapMethod(promises, method, indexes);
  };

  const fsMethodsWithSinglePath: Record<string, number[]> = {
    access: [0],
    appendFile: [0],
    chmod: [0],
    chown: [0],
    lstat: [0],
    mkdir: [0],
    open: [0],
    opendir: [0],
    readdir: [0],
    readFile: [0],
    readlink: [0],
    realpath: [0],
    rm: [0],
    rmdir: [0],
    stat: [0],
    truncate: [0],
    unlink: [0],
    utimes: [0],
    writeFile: [0],
    exists: [0],
    existsSync: [0],
    createReadStream: [0],
    createWriteStream: [0]
  };

  const fsMethodsWithDualPaths: Record<string, number[]> = {
    copyFile: [0, 1],
    link: [0, 1],
    rename: [0, 1]
  };

  const fsMethodsWithSecondPath: Record<string, number[]> = {
    symlink: [1]
  };

  for (const [method, indexes] of Object.entries(fsMethodsWithSinglePath)) {
    wrapFsMethod(method, indexes);
    wrapFsPromisesMethod(method, indexes);
  }

  for (const [method, indexes] of Object.entries(fsMethodsWithDualPaths)) {
    wrapFsMethod(method, indexes);
    wrapFsPromisesMethod(method, indexes);
  }

  for (const [method, indexes] of Object.entries(fsMethodsWithSecondPath)) {
    wrapFsMethod(method, indexes);
    wrapFsPromisesMethod(method, indexes);
  }
}

installHostRootAutoPrefix(process.env[HOST_ROOT_PREFIX_ENV]);

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

function extractErrorProperties(error: Error): Record<string, JsonValue> | undefined {
  const properties: Record<string, JsonValue> = {};
  for (const key of Object.getOwnPropertyNames(error)) {
    if (key === 'name' || key === 'message' || key === 'stack') {
      continue;
    }
    try {
      const value = (error as Record<string, unknown>)[key];
      const converted = toJsonValue(value);
      if (converted !== undefined) {
        properties[key] = converted;
      }
    } catch {
      // ignore property access errors
    }
  }
  return Object.keys(properties).length > 0 ? properties : undefined;
}

function serializeError(error: unknown): {
  message: string;
  stack?: string | null;
  name?: string | null;
  properties?: Record<string, JsonValue>;
} {
  if (error instanceof Error) {
    const properties = extractErrorProperties(error);
    const derivedName =
      typeof error.name === 'string' && error.name.length > 0
        ? error.name
        : error.constructor && typeof error.constructor === 'function'
          ? error.constructor.name
          : null;
    return {
      message: error.message,
      stack: error.stack ?? null,
      ...(derivedName ? { name: derivedName } : {}),
      ...(properties ? { properties } : {})
    };
  }
  return {
    message: typeof error === 'string' ? error : String(error),
    name: null
  };
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

  const rawParams = context.parameters ?? {};
  const paramsObject =
    rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams)
      ? (rawParams as Record<string, unknown>)
      : {};
  const invocationParams = Object.create(context) as Record<string, unknown>;
  for (const [key, value] of Object.entries(paramsObject)) {
    invocationParams[key] = value;
  }
  invocationParams.parameters = context.parameters;

  const resolveWorkflowEventContext = (): WorkflowEventContext | null => {
    let parsedContext: WorkflowEventContext | null = null;
    if (payload.workflowEventContext) {
      try {
        const serialized = JSON.stringify(payload.workflowEventContext);
        parsedContext = parseWorkflowEventContext(serialized);
      } catch {
        parsedContext = null;
      }
    }
    if (!parsedContext) {
      parsedContext = parseWorkflowEventContext(process.env[WORKFLOW_EVENT_CONTEXT_ENV] ?? null);
    }
    return parsedContext;
  };

  const workflowEventContext = resolveWorkflowEventContext();
  if (workflowEventContext && !process.env[WORKFLOW_EVENT_CONTEXT_ENV]) {
    process.env[WORKFLOW_EVENT_CONTEXT_ENV] = serializeWorkflowEventContext(workflowEventContext);
  }
  (context as Record<string, unknown>).workflowEventContext = workflowEventContext;
  (context as Record<string, unknown>).getWorkflowEventContext = () => workflowEventContext;

  const normalizeJobResult = (value: unknown): JobResult => {
    if (value === null || value === undefined) {
      return {} satisfies JobResult;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const knownKeys = ['status', 'result', 'errorMessage', 'logsUrl', 'metrics', 'context', 'timeoutMs'];
      const hasJobResultShape = knownKeys.some((key) => Object.prototype.hasOwnProperty.call(record, key));
      if (hasJobResultShape) {
        return record as JobResult;
      }
      return {
        result: record as JsonValue
      } satisfies JobResult;
    }
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return { result: value } satisfies JobResult;
    }
    if (Array.isArray(value)) {
      return { result: value as JsonValue } satisfies JobResult;
    }
    return { result: String(value) } satisfies JobResult;
  };

  try {
    const invokeHandler = () =>
      Promise.resolve(
        (handler as (params: Record<string, unknown>, ctx: typeof context) => unknown)(
          invocationParams,
          context
        )
      );
    const handlerOutput = workflowEventContext
      ? await runWithWorkflowEventContext(workflowEventContext, invokeHandler)
      : await invokeHandler();
    const jobResult = sanitizeForIpc(normalizeJobResult(handlerOutput));
    const durationMs = Date.now() - startTime;
    send({
      type: 'result',
      result: jobResult as any,
      durationMs,
      resourceUsage: process.resourceUsage()
    });
  } catch (err) {
    logger('error', 'Handler threw error', {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack ?? null : null,
      errorName: err instanceof Error ? err.name ?? null : null
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
      error: serializeError(error)
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
    error: serializeError(error)
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
    error: serializeError(err)
  });
});
