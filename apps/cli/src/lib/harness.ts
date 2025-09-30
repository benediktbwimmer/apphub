import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile as writeTempFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { pathExists, readFile } from './fs';
import { readJsonFile } from './json';
import { PYTHON_HARNESS_SOURCE, PYTHON_RESULT_SENTINEL } from './pythonHarness';
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

function resolveRuntime(context: BundleContext): string {
  const runtime = typeof context.manifest.runtime === 'string' ? context.manifest.runtime.trim() : '';
  return runtime || 'node18';
}

function isPythonRuntime(runtime: string): boolean {
  return /^python/i.test(runtime);
}

function resolvePythonEntry(context: BundleContext): string {
  const manifestEntry =
    typeof context.manifest.pythonEntry === 'string' ? context.manifest.pythonEntry.trim() : '';
  if (manifestEntry) {
    return manifestEntry;
  }
  const configEntry = typeof context.config.pythonEntry === 'string' ? context.config.pythonEntry.trim() : '';
  if (configEntry) {
    return configEntry;
  }
  throw new Error('Python runtime requires `pythonEntry` to be set in the manifest.');
}

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

async function importNodeHandler(context: BundleContext): Promise<JobHandler> {
  const manifestEntry =
    typeof context.manifest.entry === 'string' ? context.manifest.entry.trim() : '';
  if (!manifestEntry) {
    throw new Error('Manifest entry is required to execute the job locally.');
  }

  const entryPath = path.resolve(context.bundleDir, manifestEntry);
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
      `Bundle entry ${manifestEntry} does not export a handler function. Export a default function or a named \`handler\`.`
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
    entryPoint:
      typeof context.manifest.entry === 'string' && context.manifest.entry
        ? context.manifest.entry
        : context.config.entry,
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

async function executeNodeBundle(context: BundleContext, parameters: JsonValue): Promise<ExecuteResult> {
  const handler = await importNodeHandler(context);
  const logs: string[] = [];
  const localContext = createLocalContext(context, parameters, logs);
  const started = performance.now();
  let jobResult: JobResult | void;
  try {
    jobResult = await handler(localContext);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const stack = error.stack ?? error.message;
    logBuffer.push(`[job:${context.config.slug}] handler error ${stack}`);
    (error as Error & { runContext?: ExecuteResult['runContext'] }).runContext = {
      logs: [...logBuffer]
    };
    throw error;
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

async function executePythonBundle(context: BundleContext, parameters: JsonValue): Promise<ExecuteResult> {
  const pythonEntry = resolvePythonEntry(context);
  const entryPath = path.resolve(context.bundleDir, pythonEntry);
  if (!(await pathExists(entryPath))) {
    throw new Error(
      `Python entry file not found at ${pythonEntry}. Run \`apphub jobs package\` or create the file before testing.`
    );
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), 'apphub-python-harness-'));
  const harnessPath = path.join(tempDir, 'harness.py');
  try {
    await writeTempFile(harnessPath, PYTHON_HARNESS_SOURCE, 'utf8');

    const payload = {
      entry: entryPath,
      parameters,
      slug: context.config.slug,
      manifest: {
        name: context.manifest.name,
        version: context.manifest.version,
        pythonEntry,
        metadata: context.manifest.metadata ?? null
      }
    };

    const child = spawn('python3', [harnessPath], {
      cwd: context.bundleDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout.on('data', (chunk) => {
      stdoutChunks.push(chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrChunks.push(text);
      process.stderr.write(text);
    });

    const input = JSON.stringify(payload);
    child.stdin.write(input);
    child.stdin.end();

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 0));
    });

    const stdoutCombined = stdoutChunks.join('');
    if (exitCode !== 0) {
      const stderrCombined = stderrChunks.join('');
      const message = (stderrCombined || stdoutCombined || `exit code ${exitCode}`).trim();
      throw new Error(`Python harness failed: ${message}`);
    }

    const lines = stdoutCombined.split(/\r?\n/);
    let resultLine: string | undefined;
    for (const line of lines) {
      if (!line) {
        continue;
      }
      if (line.startsWith(PYTHON_RESULT_SENTINEL)) {
        resultLine = line.slice(PYTHON_RESULT_SENTINEL.length);
      } else {
        console.log(line);
      }
    }

    if (!resultLine) {
      throw new Error('Python harness did not produce a result payload.');
    }

    let parsed: { result?: unknown; durationMs?: unknown; logs?: unknown };
    try {
      parsed = JSON.parse(resultLine) as { result?: unknown; durationMs?: unknown; logs?: unknown };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to parse Python harness output: ${message}`);
    }

    const logs = Array.isArray(parsed.logs)
      ? parsed.logs.map((entry) => String(entry))
      : [];
    const durationMs =
      typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs)
        ? Math.round(parsed.durationMs)
        : 0;
    let result: JobResult;
    if (parsed.result && typeof parsed.result === 'object' && parsed.result !== null) {
      result = parsed.result as JobResult;
    } else if (parsed.result !== undefined) {
      result = { status: 'succeeded', result: parsed.result as JsonValue };
    } else {
      result = {};
    }
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function executeBundle(
  context: BundleContext,
  parameters: JsonValue
): Promise<ExecuteResult> {
  const runtime = resolveRuntime(context);
  if (isPythonRuntime(runtime)) {
    return executePythonBundle(context, parameters);
  }
  return executeNodeBundle(context, parameters);
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
