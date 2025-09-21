import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pathExists, readFile } from './fs';
import { readJsonFile } from './json';
import type { BundleContext } from './bundle';
import type { JobResult, JsonValue } from '../types';

export type ExecuteOptions = {
  parameters?: JsonValue;
};

export type ExecuteResult = {
  result: JobResult;
  durationMs: number;
  runContext: {
    logs: string[];
  };
};

const DEFAULT_SAMPLE_INPUT_PATH_FALLBACK = 'tests/sample-input.json';

type LocalJobDefinition = {
  id: string;
  slug: string;
  name: string;
  version: number;
  entryPoint: string;
};

type LocalJobRun = {
  id: string;
  jobDefinitionId: string;
  status: 'running';
  parameters: JsonValue;
  result: JsonValue | null;
  errorMessage: string | null;
  logsUrl: string | null;
  metrics: JsonValue | null;
  context: JsonValue | null;
  timeoutMs: number | null;
  attempt: number;
  maxAttempts: number | null;
  durationMs: number | null;
  scheduledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobHandler = (context: {
  definition: LocalJobDefinition & Record<string, unknown>;
  run: LocalJobRun & Record<string, unknown>;
  parameters: JsonValue;
  update: (updates: Record<string, JsonValue | null | number | undefined>) => Promise<void>;
  logger: (message: string, meta?: Record<string, unknown>) => void;
  resolveSecret: () => string | null;
}) => Promise<JobResult | void> | JobResult | void;

async function importHandler(context: BundleContext): Promise<JobHandler> {
  const entryPath = path.resolve(context.bundleDir, context.manifest.entry);
  if (!(await pathExists(entryPath))) {
    throw new Error(
      `Built entry not found at ${path.relative(context.bundleDir, entryPath)}. Run \`apphub jobs package\` to build the bundle.`
    );
  }

  const moduleUrl = pathToFileURL(entryPath).href;
  const imported = await import(moduleUrl);
  const candidate =
    typeof imported.default === 'function'
      ? imported.default
      : typeof imported.handler === 'function'
        ? imported.handler
        : null;
  if (!candidate) {
    throw new Error(
      `Bundle entry ${context.manifest.entry} does not export a handler function. Export a default function or a named \`handler\`.`
    );
  }
  return candidate as JobHandler;
}

function createLocalContext(
  context: BundleContext,
  parameters: JsonValue,
  logBuffer: string[]
) {
  const now = new Date().toISOString();
  const definition: LocalJobDefinition & Record<string, unknown> = {
    id: 'local-definition',
    slug: context.config.slug,
    name: context.manifest.name,
    version: 1,
    entryPoint: context.manifest.entry,
    metadata: context.manifest.metadata ?? null
  };
  const runRecord: LocalJobRun & Record<string, unknown> = {
    id: 'local-run',
    jobDefinitionId: definition.id,
    status: 'running',
    parameters,
    result: null,
    errorMessage: null,
    logsUrl: null,
    metrics: null,
    context: null,
    timeoutMs: null,
    attempt: 1,
    maxAttempts: 1,
    durationMs: null,
    scheduledAt: now,
    startedAt: now,
    completedAt: null,
    createdAt: now,
    updatedAt: now
  };

  const localContext = {
    definition,
    run: runRecord,
    get parameters() {
      return runRecord.parameters;
    },
    set parameters(value: JsonValue) {
      runRecord.parameters = value;
    },
    async update(updates: Record<string, unknown>) {
      if (Object.prototype.hasOwnProperty.call(updates, 'parameters')) {
        runRecord.parameters = updates.parameters as JsonValue;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'logsUrl')) {
        runRecord.logsUrl = (updates.logsUrl as string | null) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'metrics')) {
        runRecord.metrics = (updates.metrics as JsonValue | null) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'context')) {
        runRecord.context = (updates.context as JsonValue | null) ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'timeoutMs')) {
        const timeout = updates.timeoutMs;
        runRecord.timeoutMs =
          typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : null;
      }
      runRecord.updatedAt = new Date().toISOString();
    },
    logger(message: string, meta?: Record<string, unknown>) {
      const serialized = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
      const line = `[job:${context.config.slug}] ${message}${serialized}`;
      logBuffer.push(line);
      console.log(line);
    },
    resolveSecret() {
      return null;
    }
  };

  return localContext;
}

export async function loadSampleParameters(
  context: BundleContext,
  samplePath?: string
): Promise<JsonValue> {
  const resolved = samplePath
    ? path.resolve(context.bundleDir, samplePath)
    : path.resolve(
        context.bundleDir,
        context.config.tests.sampleInputPath ?? DEFAULT_SAMPLE_INPUT_PATH_FALLBACK
      );
  if (!(await pathExists(resolved))) {
    throw new Error(
      `Sample input not found at ${path.relative(context.bundleDir, resolved)}. Provide --input or create the file.`
    );
  }
  const params = await readJsonFile<JsonValue>(resolved);
  return params;
}

export async function executeBundle(
  context: BundleContext,
  parameters: JsonValue
): Promise<ExecuteResult> {
  const handler = await importHandler(context);
  const logs: string[] = [];
  const localContext = createLocalContext(context, parameters, logs);
  const started = performance.now();
  let jobResult: JobResult | void;
  try {
    jobResult = await handler(localContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Job handler threw an error: ${message}`);
  }
  const finished = performance.now();
  const durationMs = Math.round(finished - started);
  const result: JobResult = jobResult ?? {};
  if (!result.status) {
    result.status = 'succeeded';
  }
  return {
    result,
    durationMs,
    runContext: {
      logs
    }
  } satisfies ExecuteResult;
}

export async function loadInlineParameters(raw?: string): Promise<JsonValue | undefined> {
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as JsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse inline JSON: ${message}`);
  }
}

export async function readParametersFromFile(filePath: string): Promise<JsonValue> {
  const contents = await readFile(filePath);
  try {
    return JSON.parse(contents.toString('utf8')) as JsonValue;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse parameters file ${filePath}: ${message}`);
  }
}
