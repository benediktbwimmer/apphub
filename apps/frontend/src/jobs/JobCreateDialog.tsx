import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobDefinitionSummary } from '../workflows/api';
import { createJobDefinition } from '../workflows/api';
import type { AuthorizedFetch } from '../lib/apiClient';
import { useAuth } from '../auth/useAuth';
import { Modal } from '../components';
import { Editor } from '../components/Editor';
import {
  previewJobSchemas,
  previewPythonSnippet,
  createPythonSnippetJob,
  type JobRuntimeStatus,
  type PythonSnippetPreview,
  type SchemaPreview
} from './api';
import {
  JOB_DIALOG_BODY_CLASSES,
  JOB_DIALOG_CLOSE_BUTTON_CLASSES,
  JOB_DIALOG_CONTAINER_BASE,
  JOB_DIALOG_HEADER_CLASSES,
  JOB_DIALOG_SUBTITLE_CLASSES,
  JOB_DIALOG_TITLE_CLASSES,
  JOB_FORM_ACTION_PRIMARY_CLASSES,
  JOB_FORM_ACTION_SECONDARY_CLASSES,
  JOB_FORM_BADGE_BUTTON_ACTIVE,
  JOB_FORM_BADGE_BUTTON_BASE,
  JOB_FORM_BADGE_BUTTON_INACTIVE,
  JOB_FORM_ERROR_TEXT_CLASSES,
  JOB_FORM_HELPER_TEXT_CLASSES,
  JOB_FORM_INPUT_CLASSES,
  JOB_FORM_LABEL_CLASSES,
  JOB_FORM_MONO_TEXTAREA_CLASSES,
  JOB_FORM_SECTION_LABEL_CLASSES,
  JOB_RUNTIME_BADGE_BASE_CLASSES
} from './jobTokens';
import { getStatusToneClasses } from '../theme/statusTokens';

const JOB_TYPES: Array<{ value: 'batch' | 'service-triggered' | 'manual'; label: string }> = [
  { value: 'batch', label: 'Batch' },
  { value: 'service-triggered', label: 'Service-triggered' },
  { value: 'manual', label: 'Manual' }
];

const EMPTY_JSON_TEXT = '{\n}\n';
const PYTHON_SNIPPET_TEMPLATE = [
  'from pydantic import BaseModel',
  '',
  '',
  'class Input(BaseModel):',
  '  message: str',
  '',
  '',
  'class Output(BaseModel):',
  '  echoed: str',
  '',
  '',
  'def handler(payload: Input) -> Output:',
  '  return Output(echoed=payload.message)',
  ''
].join('\n');

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

function parseDependenciesText(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
  const { activeToken } = useAuth();
  const runtimeStatusMap = useMemo(() => {
    const map = new Map<JobRuntimeStatus['runtime'], JobRuntimeStatus>();
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
  const [pythonSnippet, setPythonSnippet] = useState(PYTHON_SNIPPET_TEMPLATE);
  const [pythonDependenciesText, setPythonDependenciesText] = useState('');
  const [pythonPreview, setPythonPreview] = useState<PythonSnippetPreview | null>(null);
  const [pythonPreviewPending, setPythonPreviewPending] = useState(false);
  const [pythonPreviewError, setPythonPreviewError] = useState<string | null>(null);
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
    setPythonSnippet(PYTHON_SNIPPET_TEMPLATE);
    setPythonDependenciesText('');
    setPythonPreview(null);
    setPythonPreviewError(null);
    setPythonPreviewPending(false);
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

  const handlePythonPreview = useCallback(async () => {
    setPythonPreviewError(null);
    if (!pythonSnippet.trim()) {
      setPythonPreviewError('Provide a Python snippet to analyze.');
      return;
    }
    setPythonPreviewPending(true);
    try {
      if (!activeToken) {
        throw new Error('Authentication required to analyze snippet.');
      }
      const preview = await previewPythonSnippet(activeToken, { snippet: pythonSnippet });
      setPythonPreview(preview);
      setParametersSchemaText(formatSchema(preview.inputModel.schema));
      setOutputSchemaText(formatSchema(preview.outputModel.schema));
      setParametersSchemaError(null);
      setOutputSchemaError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze snippet';
      setPythonPreviewError(message);
    } finally {
      setPythonPreviewPending(false);
    }
  }, [activeToken, pythonSnippet]);

  const handleAutoDetect = useCallback(async () => {
    setAutoDetectError(null);
    if (!entryPoint.trim()) {
      setAutoDetectError('Provide an entry point to inspect schemas.');
      return;
    }
    setAutoDetectPending(true);
    try {
      if (!activeToken) {
        throw new Error('Authentication required to inspect schemas.');
      }
      const preview: SchemaPreview = await previewJobSchemas(activeToken, {
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
  }, [activeToken, entryPoint, runtime]);

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

      let versionValue: number | undefined;
      if (trimmedVersion) {
        const parsed = Number(trimmedVersion);
        if (!Number.isInteger(parsed) || parsed < 1) {
          setFormError('Version must be a positive integer if provided.');
          return;
        }
        versionValue = parsed;
      }

      let timeoutValue: number | null | undefined = null;
      if (trimmedTimeout) {
        const parsed = Number(trimmedTimeout);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          setFormError('Timeout must be a positive number of milliseconds.');
          return;
        }
        timeoutValue = Math.floor(parsed);
      }

      if (runtime === 'python') {
        if (!pythonSnippet.trim()) {
          setFormError('Python snippet is required.');
          return;
        }
        const dependencies = parseDependenciesText(pythonDependenciesText);
        setSubmitting(true);
        try {
          if (!activeToken) {
            throw new Error('Authentication required to create Python jobs.');
          }
          const result = await createPythonSnippetJob(activeToken, {
            slug: trimmedSlug,
            name: trimmedName,
            type: jobType,
            snippet: pythonSnippet,
            dependencies,
            timeoutMs: timeoutValue ?? undefined,
            versionStrategy: 'auto'
          });
          onCreated(result.job);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to create Python job';
          setFormError(message);
        } finally {
          setSubmitting(false);
        }
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
      pythonSnippet,
      pythonDependenciesText,
      parametersSchemaText,
      defaultParametersText,
      outputSchemaText,
      activeToken,
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
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="job-create-title"
      className="items-start justify-center p-4 pt-10 sm:items-center sm:p-6"
      contentClassName={classNames(
        'max-w-3xl max-h-[calc(100vh-4rem)] sm:max-h-[calc(100vh-6rem)]',
        JOB_DIALOG_CONTAINER_BASE
      )}
    >
        <header className={JOB_DIALOG_HEADER_CLASSES}>
          <div>
            <h2 id="job-create-title" className={JOB_DIALOG_TITLE_CLASSES}>
              Create job definition
            </h2>
            <p className={JOB_DIALOG_SUBTITLE_CLASSES}>
              Provide the entry point and default metadata for a new job.
            </p>
          </div>
          <button
            type="button"
            className={JOB_DIALOG_CLOSE_BUTTON_CLASSES}
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <form className={JOB_DIALOG_BODY_CLASSES} onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={JOB_FORM_LABEL_CLASSES}>
              Name
              <input
                type="text"
                className={JOB_FORM_INPUT_CLASSES}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </label>
            <label className={JOB_FORM_LABEL_CLASSES}>
              Slug
              <input
                type="text"
                className={JOB_FORM_INPUT_CLASSES}
                value={slug}
                onChange={(event) => handleSlugChange(event.target.value)}
                required
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={classNames(JOB_FORM_LABEL_CLASSES, 'gap-2')}>
              Type
              <div className="flex flex-wrap gap-2">
                {JOB_TYPES.map((option) => {
                  const isActive = jobType === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={classNames(
                        JOB_FORM_BADGE_BUTTON_BASE,
                        isActive ? JOB_FORM_BADGE_BUTTON_ACTIVE : JOB_FORM_BADGE_BUTTON_INACTIVE
                      )}
                      onClick={() => setJobType(option.value)}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </label>
            <label className={classNames(JOB_FORM_LABEL_CLASSES, 'gap-2')}>
              Runtime
              <div className="flex flex-wrap gap-2">
                {(['node', 'python'] as const).map((option) => {
                  const status = runtimeStatusMap.get(option);
                  const disabled = option === 'python' && status ? !status.ready : false;
                  const isActive = runtime === option;
                  return (
                    <div key={option} className="flex flex-col gap-1">
                      <button
                        type="button"
                        className={classNames(
                          JOB_FORM_BADGE_BUTTON_BASE,
                          isActive ? JOB_FORM_BADGE_BUTTON_ACTIVE : JOB_FORM_BADGE_BUTTON_INACTIVE
                        )}
                        onClick={() => !disabled && handleRuntimeChange(option)}
                        disabled={disabled}
                      >
                        {option === 'python' ? 'Python' : 'Node'}
                      </button>
                      {status && (
                        <span
                          className={classNames(
                            JOB_RUNTIME_BADGE_BASE_CLASSES,
                            getStatusToneClasses(status.ready ? 'ready' : 'error')
                          )}
                        >
                          {status.ready ? 'Ready' : status.reason ? status.reason : 'Unavailable'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </label>
          </div>

          {runtime === 'node' && (
            <label className={JOB_FORM_LABEL_CLASSES}>
              Entry point
              <input
                type="text"
                className={JOB_FORM_INPUT_CLASSES}
                value={entryPoint}
                onChange={(event) => setEntryPoint(event.target.value)}
                required={runtime === 'node'}
                placeholder="bundle:slug@version"
              />
            </label>
          )}

          {runtime === 'python' && (
            <div className="flex flex-col gap-3">
              <label className={classNames(JOB_FORM_LABEL_CLASSES, 'gap-2')}>
                Python snippet
                <Editor
                  value={pythonSnippet}
                  onChange={setPythonSnippet}
                  language="python"
                  height={260}
                  ariaLabel="Python job snippet"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className={classNames(JOB_FORM_BADGE_BUTTON_BASE, JOB_FORM_BADGE_BUTTON_INACTIVE)}
                  onClick={handlePythonPreview}
                  disabled={pythonPreviewPending}
                >
                  {pythonPreviewPending ? 'Analyzing…' : 'Analyze snippet'}
                </button>
                {pythonPreview && (
                  <span className={JOB_FORM_HELPER_TEXT_CLASSES}>
                    Handler {pythonPreview.handlerName} · {pythonPreview.inputModel.name} → {pythonPreview.outputModel.name}
                  </span>
                )}
              </div>
              {pythonPreviewError && (
                <p className={JOB_FORM_ERROR_TEXT_CLASSES}>{pythonPreviewError}</p>
              )}
              <label className={JOB_FORM_SECTION_LABEL_CLASSES}>
                Dependencies (one per line, optional)
                <textarea
                  className={classNames('min-h-[100px]', JOB_FORM_MONO_TEXTAREA_CLASSES)}
                  value={pythonDependenciesText}
                  onChange={(event) => setPythonDependenciesText(event.target.value)}
                  placeholder="requests>=2.31.0"
                  spellCheck={false}
                />
              </label>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className={JOB_FORM_LABEL_CLASSES}>
              Version (optional)
              <input
                type="number"
                min={1}
                className={JOB_FORM_INPUT_CLASSES}
                value={version}
                onChange={(event) => setVersion(event.target.value)}
              />
            </label>
            <label className={JOB_FORM_LABEL_CLASSES}>
              Timeout (ms, optional)
              <input
                type="number"
                min={1000}
                className={JOB_FORM_INPUT_CLASSES}
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </label>
          </div>

          {runtime === 'node' ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-scale-sm font-weight-semibold text-primary">Schemas</h3>
                <button
                  type="button"
                  className={classNames(JOB_FORM_BADGE_BUTTON_BASE, JOB_FORM_BADGE_BUTTON_INACTIVE)}
                  onClick={handleAutoDetect}
                  disabled={autoDetectPending}
                >
                  {autoDetectPending ? 'Detecting…' : 'Auto-detect from entry point'}
                </button>
              </div>
              {autoDetectError && <p className={JOB_FORM_ERROR_TEXT_CLASSES}>{autoDetectError}</p>}
              <div className="grid gap-4 md:grid-cols-2">
                <label className={JOB_FORM_SECTION_LABEL_CLASSES}>
                  Parameters schema
                  <textarea
                    className={classNames('min-h-[140px]', JOB_FORM_MONO_TEXTAREA_CLASSES)}
                    value={parametersSchemaText}
                    onChange={(event) => setParametersSchemaText(event.target.value)}
                    spellCheck={false}
                  />
                  {schemaSources.parameters && (
                    <span className={JOB_FORM_HELPER_TEXT_CLASSES}>
                      Detected from {schemaSources.parameters}
                    </span>
                  )}
                  {parametersSchemaError && (
                    <span className={JOB_FORM_ERROR_TEXT_CLASSES}>{parametersSchemaError}</span>
                  )}
                </label>
                <label className={JOB_FORM_SECTION_LABEL_CLASSES}>
                  Default parameters
                  <textarea
                    className={classNames('min-h-[140px]', JOB_FORM_MONO_TEXTAREA_CLASSES)}
                    value={defaultParametersText}
                    onChange={(event) => setDefaultParametersText(event.target.value)}
                    spellCheck={false}
                  />
                  {defaultParametersError && (
                    <span className={JOB_FORM_ERROR_TEXT_CLASSES}>{defaultParametersError}</span>
                  )}
                </label>
                <label className={classNames(JOB_FORM_SECTION_LABEL_CLASSES, 'md:col-span-2')}>
                  Output schema
                  <textarea
                    className={classNames('min-h-[140px]', JOB_FORM_MONO_TEXTAREA_CLASSES)}
                    value={outputSchemaText}
                    onChange={(event) => setOutputSchemaText(event.target.value)}
                    spellCheck={false}
                  />
                  {schemaSources.output && (
                    <span className={JOB_FORM_HELPER_TEXT_CLASSES}>
                      Detected from {schemaSources.output}
                    </span>
                  )}
                  {outputSchemaError && (
                    <span className={JOB_FORM_ERROR_TEXT_CLASSES}>{outputSchemaError}</span>
                  )}
                </label>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <h3 className="text-scale-sm font-weight-semibold text-primary">Generated schemas</h3>
              {pythonPreview ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className={JOB_FORM_SECTION_LABEL_CLASSES}>
                    Parameters schema
                    <textarea
                      className={classNames('min-h-[140px]', JOB_FORM_MONO_TEXTAREA_CLASSES)}
                      value={formatSchema(pythonPreview.inputModel.schema)}
                      readOnly
                      spellCheck={false}
                    />
                  </label>
                  <label className={JOB_FORM_SECTION_LABEL_CLASSES}>
                    Output schema
                    <textarea
                      className={classNames('min-h-[140px]', JOB_FORM_MONO_TEXTAREA_CLASSES)}
                      value={formatSchema(pythonPreview.outputModel.schema)}
                      readOnly
                      spellCheck={false}
                    />
                  </label>
                </div>
              ) : (
                <p className={JOB_FORM_HELPER_TEXT_CLASSES}>
                  Run the snippet analysis to generate input and output schemas.
                </p>
              )}
            </div>
          )}

          {formError && (
            <p className={classNames('text-scale-sm', JOB_FORM_ERROR_TEXT_CLASSES)}>{formError}</p>
          )}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className={JOB_FORM_ACTION_SECONDARY_CLASSES}
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={JOB_FORM_ACTION_PRIMARY_CLASSES}
              disabled={submitting}
            >
              {submitting ? 'Creating…' : 'Create job'}
            </button>
          </div>

          <div className="grid gap-2 border-t border-subtle pt-4 text-scale-xs text-muted sm:grid-cols-2">
            <div>
              <strong className="font-weight-semibold text-primary">Node runtime</strong>
              <p>{nodeRuntimeMessage}</p>
            </div>
            <div>
              <strong className="font-weight-semibold text-primary">Python runtime</strong>
              <p>{pythonRuntimeMessage}</p>
            </div>
          </div>
        </form>
    </Modal>
  );
}
