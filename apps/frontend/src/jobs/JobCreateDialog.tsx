import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AuthorizedFetch, JobDefinitionSummary } from '../workflows/api';
import { createJobDefinition } from '../workflows/api';
import type { JobRuntimeStatus, SchemaPreview } from './api';
import { previewJobSchemas } from './api';

const JOB_TYPES: Array<{ value: 'batch' | 'service-triggered' | 'manual'; label: string }> = [
  { value: 'batch', label: 'Batch' },
  { value: 'service-triggered', label: 'Service-triggered' },
  { value: 'manual', label: 'Manual' }
];

const EMPTY_JSON_TEXT = '{\n}\n';

function formatRuntimeStatus(status?: JobRuntimeStatus): string {
  if (!status?.ready) {
    return status?.reason ?? 'Runtime status unavailable.';
  }
  const details = status.details;
  let version: string | null = null;
  if (details && typeof details.version === 'string') {
    const trimmed = details.version.trim();
    if (trimmed.length > 0) {
      version = trimmed;
    }
  }
  return version ?? 'Sandbox ready.';
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function parseJsonObject(
  value: string,
  onError: (message: string) => void
): Record<string, unknown> | null {
  if (!value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      onError('Value must be a JSON object');
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid JSON';
    onError(`Invalid JSON: ${message}`);
    return null;
  }
}

function formatSchema(schema: Record<string, unknown> | null): string {
  if (!schema) {
    return EMPTY_JSON_TEXT;
  }
  try {
    return `${JSON.stringify(schema, null, 2)}\n`;
  } catch {
    return EMPTY_JSON_TEXT;
  }
}

type JobCreateDialogProps = {
  open: boolean;
  onClose: () => void;
  authorizedFetch: AuthorizedFetch;
  defaultRuntime: 'node' | 'python';
  runtimeStatuses: JobRuntimeStatus[];
  onCreated: (job: JobDefinitionSummary) => void;
};

export default function JobCreateDialog({
  open,
  onClose,
  authorizedFetch,
  defaultRuntime,
  runtimeStatuses,
  onCreated
}: JobCreateDialogProps) {
  const runtimeStatusMap = useMemo(() => {
    const map = new Map<'node' | 'python', JobRuntimeStatus>();
    for (const status of runtimeStatuses) {
      map.set(status.runtime, status);
    }
    return map;
  }, [runtimeStatuses]);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [jobType, setJobType] = useState<'batch' | 'service-triggered' | 'manual'>('batch');
  const [runtime, setRuntime] = useState<'node' | 'python'>(defaultRuntime);
  const [entryPoint, setEntryPoint] = useState('');
  const [version, setVersion] = useState('');
  const [timeoutMs, setTimeoutMs] = useState('');
  const [parametersSchemaText, setParametersSchemaText] = useState(EMPTY_JSON_TEXT);
  const [defaultParametersText, setDefaultParametersText] = useState(EMPTY_JSON_TEXT);
  const [outputSchemaText, setOutputSchemaText] = useState(EMPTY_JSON_TEXT);
  const [parametersSchemaError, setParametersSchemaError] = useState<string | null>(null);
  const [defaultParametersError, setDefaultParametersError] = useState<string | null>(null);
  const [outputSchemaError, setOutputSchemaError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [autoDetectPending, setAutoDetectPending] = useState(false);
  const [autoDetectError, setAutoDetectError] = useState<string | null>(null);
  const [schemaSources, setSchemaSources] = useState<{ parameters?: string | null; output?: string | null }>({});

  useEffect(() => {
    if (!open) {
      return;
    }
    setName('');
    setSlug('');
    setSlugTouched(false);
    setJobType('batch');
    setRuntime(defaultRuntime);
    setEntryPoint('');
    setVersion('');
    setTimeoutMs('');
    setParametersSchemaText(EMPTY_JSON_TEXT);
    setDefaultParametersText(EMPTY_JSON_TEXT);
    setOutputSchemaText(EMPTY_JSON_TEXT);
    setParametersSchemaError(null);
    setDefaultParametersError(null);
    setOutputSchemaError(null);
    setFormError(null);
    setAutoDetectError(null);
    setAutoDetectPending(false);
    setSchemaSources({});
  }, [open, defaultRuntime]);

  useEffect(() => {
    if (!slugTouched) {
      setSlug(slugify(name));
    }
  }, [name, slugTouched]);

  const handleSlugChange = useCallback((value: string) => {
    setSlugTouched(true);
    setSlug(value);
  }, []);

  const handleRuntimeChange = useCallback((value: 'node' | 'python') => {
    setRuntime(value);
  }, []);

  const handleAutoDetect = useCallback(async () => {
    setAutoDetectError(null);
    if (!entryPoint.trim()) {
      setAutoDetectError('Provide an entry point to inspect schemas.');
      return;
    }
    setAutoDetectPending(true);
    try {
      const preview: SchemaPreview = await previewJobSchemas(authorizedFetch, {
        entryPoint: entryPoint.trim(),
        runtime
      });
      setParametersSchemaText(formatSchema(preview.parametersSchema));
      setDefaultParametersText((current) => current || EMPTY_JSON_TEXT);
      setOutputSchemaText(formatSchema(preview.outputSchema));
      setParametersSchemaError(null);
      setOutputSchemaError(null);
      setSchemaSources({
        parameters: preview.parametersSource ?? null,
        output: preview.outputSource ?? null
      });
      if (!preview.parametersSchema && !preview.outputSchema) {
        setAutoDetectError('No schemas were discovered in the referenced bundle.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to inspect entry point';
      setAutoDetectError(message);
    } finally {
      setAutoDetectPending(false);
    }
  }, [authorizedFetch, entryPoint, runtime]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitting) {
        return;
      }
      setFormError(null);
      setParametersSchemaError(null);
      setDefaultParametersError(null);
      setOutputSchemaError(null);

      const trimmedName = name.trim();
      const trimmedSlug = slug.trim();
      const trimmedEntryPoint = entryPoint.trim();
      const trimmedVersion = version.trim();
      const trimmedTimeout = timeoutMs.trim();

      if (!trimmedName) {
        setFormError('Name is required.');
        return;
      }
      if (!trimmedSlug) {
        setFormError('Slug is required.');
        return;
      }
      if (!/^[a-z0-9][a-z0-9-_]*$/i.test(trimmedSlug)) {
        setFormError('Slug must contain only alphanumeric characters, dashes, or underscores.');
        return;
      }
      if (!trimmedEntryPoint) {
        setFormError('Entry point is required.');
        return;
      }

      const parametersSchema = parseJsonObject(parametersSchemaText, setParametersSchemaError);
      if (!parametersSchema) {
        return;
      }
      const defaultParameters = parseJsonObject(defaultParametersText, setDefaultParametersError);
      if (!defaultParameters) {
        return;
      }
      const outputSchema = parseJsonObject(outputSchemaText, setOutputSchemaError);
      if (!outputSchema) {
        return;
      }

      let versionValue: number | undefined;
      if (trimmedVersion) {
        const parsed = Number(trimmedVersion);
        if (!Number.isInteger(parsed) || parsed < 1) {
          setFormError('Version must be a positive integer if provided.');
          return;
        }
        versionValue = parsed;
      }

      let timeoutValue: number | null | undefined;
      if (trimmedTimeout) {
        const parsed = Number(trimmedTimeout);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setFormError('Timeout must be a positive number of milliseconds.');
          return;
        }
        timeoutValue = Math.floor(parsed);
      }

      setSubmitting(true);
      try {
        const job = await createJobDefinition(authorizedFetch, {
          slug: trimmedSlug,
          name: trimmedName,
          type: jobType,
          runtime,
          entryPoint: trimmedEntryPoint,
          version: versionValue,
          timeoutMs: timeoutValue,
          parametersSchema,
          defaultParameters,
          outputSchema
        });
        onCreated(job);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create job';
        setFormError(message);
      } finally {
        setSubmitting(false);
      }
    },
    [
      submitting,
      name,
      slug,
      entryPoint,
      version,
      timeoutMs,
      jobType,
      runtime,
      parametersSchemaText,
      defaultParametersText,
      outputSchemaText,
      authorizedFetch,
      onCreated
    ]
  );

  if (!open) {
    return null;
  }

  const nodeStatus = runtimeStatusMap.get('node');
  const pythonStatus = runtimeStatusMap.get('python');
  const nodeRuntimeMessage = formatRuntimeStatus(nodeStatus);
  const pythonRuntimeMessage = formatRuntimeStatus(pythonStatus);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-create-title"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900/60">
          <div>
            <h2 id="job-create-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Create job definition
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Provide the entry point and default metadata for a new job.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <form className="flex flex-col gap-5 px-6 py-5" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Name
              <input
                type="text"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Slug
              <input
                type="text"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={slug}
                onChange={(event) => handleSlugChange(event.target.value)}
                required
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Type
              <div className="flex flex-wrap gap-2">
                {JOB_TYPES.map((option) => {
                  const isActive = jobType === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                        isActive
                          ? 'border-violet-500 bg-violet-600 text-white shadow'
                          : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                      onClick={() => setJobType(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Runtime
              <div className="flex flex-wrap gap-2">
                {(['node', 'python'] as const).map((option) => {
                  const status = runtimeStatusMap.get(option);
                  const ready = status ? status.ready : true;
                  const disabled = option === 'python' && status ? !status.ready : false;
                  const isActive = runtime === option;
                  const badgeClass = ready
                    ? 'text-emerald-600 dark:text-emerald-300'
                    : 'text-rose-600 dark:text-rose-300';
                  return (
                    <div key={option} className="flex flex-col gap-1">
                      <button
                        type="button"
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                          isActive
                            ? 'border-violet-500 bg-violet-600 text-white shadow'
                            : 'border-slate-300 text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800'
                        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                        onClick={() => !disabled && handleRuntimeChange(option)}
                        disabled={disabled}
                      >
                        {option === 'python' ? 'Python' : 'Node'}
                      </button>
                      {status && (
                        <span className={`text-[11px] font-medium ${badgeClass}`}>
                          {status.ready ? 'Ready' : status.reason ? status.reason : 'Unavailable'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
            Entry point
            <input
              type="text"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              value={entryPoint}
              onChange={(event) => setEntryPoint(event.target.value)}
              required
              placeholder="bundle:slug@version"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Version (optional)
              <input
                type="number"
                min={1}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Timeout (ms, optional)
              <input
                type="number"
                min={1000}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Schemas</h3>
              <button
                type="button"
                className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                onClick={handleAutoDetect}
                disabled={autoDetectPending}
              >
                {autoDetectPending ? 'Detecting…' : 'Auto-detect from entry point'}
              </button>
            </div>
            {autoDetectError && (
              <p className="text-xs text-rose-600 dark:text-rose-300">{autoDetectError}</p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Parameters schema
                <textarea
                  className="min-h-[140px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={parametersSchemaText}
                  onChange={(event) => setParametersSchemaText(event.target.value)}
                  spellCheck={false}
                />
                {schemaSources.parameters && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Detected from {schemaSources.parameters}
                  </span>
                )}
                {parametersSchemaError && (
                  <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                    {parametersSchemaError}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Default parameters
                <textarea
                  className="min-h-[140px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={defaultParametersText}
                  onChange={(event) => setDefaultParametersText(event.target.value)}
                  spellCheck={false}
                />
                {defaultParametersError && (
                  <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                    {defaultParametersError}
                  </span>
                )}
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 md:col-span-2">
                Output schema
                <textarea
                  className="min-h-[140px] rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  value={outputSchemaText}
                  onChange={(event) => setOutputSchemaText(event.target.value)}
                  spellCheck={false}
                />
                {schemaSources.output && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Detected from {schemaSources.output}
                  </span>
                )}
                {outputSchemaError && (
                  <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                    {outputSchemaError}
                  </span>
                )}
              </label>
            </div>
          </div>

          {formError && (
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-300">{formError}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
            >
              {submitting ? 'Creating…' : 'Create job'}
            </button>
          </div>

          <div className="grid gap-2 border-t border-slate-200/70 pt-4 text-[11px] text-slate-500 dark:border-slate-700/60 dark:text-slate-400 sm:grid-cols-2">
            <div>
              <strong className="font-semibold text-slate-600 dark:text-slate-300">Node runtime</strong>
              <p>{nodeRuntimeMessage}</p>
            </div>
            <div>
              <strong className="font-semibold text-slate-600 dark:text-slate-300">Python runtime</strong>
              <p>{pythonRuntimeMessage}</p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
