import { useCallback, useEffect, useMemo, useState } from 'react';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { Editor } from '../../components/Editor';
import { formatTimestamp } from '../../workflows/formatters';
import type { WorkflowAssetPartitionSummary } from '../../workflows/types';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false, strictTuples: false });

const EMPTY_JSON_TEXT = '{\n}\n';

type JsonSchema = Record<string, unknown>;

type FormMode = 'form' | 'json';

type FormError = {
  message: string;
  path?: string;
};

type AssetRecomputeDialogProps = {
  open: boolean;
  workflowSlug: string | null;
  assetId: string | null;
  partition: WorkflowAssetPartitionSummary | null;
  workflowDefaultParameters: unknown;
  workflowParametersSchema: unknown;
  workflowParametersLoading?: boolean;
  workflowParametersError?: string | null;
  onClose: () => void;
  onSubmit: (input: {
    partitionKey: string | null;
    parameters: unknown;
    persistParameters: boolean;
  }) => Promise<void>;
  onClearStored?: (partitionKey: string | null) => Promise<void>;
};

type FieldRendererProps = {
  schema: JsonSchema;
  path: string[];
  value: unknown;
  onChange: (path: string[], value: unknown) => void;
  required?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toSchema(value: unknown): JsonSchema | null {
  return isRecord(value) ? (value as JsonSchema) : null;
}

function getSchemaType(schema: JsonSchema | null): string | null {
  if (!schema) {
    return null;
  }
  const schemaType = schema.type;
  if (typeof schemaType === 'string') {
    return schemaType;
  }
  if (Array.isArray(schemaType)) {
    const first = schemaType.find((entry) => typeof entry === 'string');
    return typeof first === 'string' ? first : null;
  }
  return null;
}

function extractRequired(schema: JsonSchema | null): string[] {
  if (!schema) {
    return [];
  }
  const required = schema.required;
  if (!Array.isArray(required)) {
    return [];
  }
  return required.filter((entry): entry is string => typeof entry === 'string');
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): FormError[] {
  if (!errors || errors.length === 0) {
    return [];
  }
  return errors.map((error) => ({
    message: error.message ? `• ${error.message}` : 'Invalid input',
    path: error.instancePath || error.schemaPath
  }));
}

function setValueAtPath(target: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) {
    return value;
  }
  const [key, ...rest] = path;
  const current = isRecord(target) ? { ...target } : {};
  if (rest.length === 0) {
    current[key] = value as never;
    return current;
  }
  current[key] = setValueAtPath(current[key], rest, value) as never;
  return current;
}

function cloneValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function FieldRenderer({ schema, path, value, onChange, required }: FieldRendererProps) {
  const type = getSchemaType(schema);
  const title = typeof schema.title === 'string' ? schema.title : path[path.length - 1] ?? 'Field';
  const description = typeof schema.description === 'string' ? schema.description : undefined;
  const enumValues = Array.isArray(schema.enum)
    ? schema.enum.filter((entry) => typeof entry === 'string' || typeof entry === 'number')
    : null;

  const fieldId = path.join('.');

  const handlePrimitiveChange = (next: unknown) => {
    onChange(path, next);
  };

  if (type === 'boolean') {
    const checked = typeof value === 'boolean' ? value : Boolean(value);
    return (
      <label className="flex items-start gap-3">
        <input
          id={fieldId}
          type="checkbox"
          checked={checked}
          onChange={(event) => handlePrimitiveChange(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
        />
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {title}
            {required ? <span className="ml-1 text-rose-500">*</span> : null}
          </span>
          {description && <span className="text-xs text-slate-500 dark:text-slate-400">{description}</span>}
        </div>
      </label>
    );
  }

  if (type === 'string' || type === 'number' || type === 'integer') {
    if (enumValues && enumValues.length > 0) {
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {title}
            {required ? <span className="ml-1 text-rose-500">*</span> : null}
          </label>
          <select
            id={fieldId}
            value={value as string | number | undefined}
            onChange={(event) => handlePrimitiveChange(event.target.value)}
            className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
          >
            <option value="">Select…</option>
            {enumValues.map((entry) => (
              <option key={String(entry)} value={String(entry)}>
                {String(entry)}
              </option>
            ))}
          </select>
          {description && <span className="text-xs text-slate-500 dark:text-slate-400">{description}</span>}
        </div>
      );
    }

    const inputType = type === 'string' ? 'text' : 'number';
    const parsedValue =
      type === 'string'
        ? typeof value === 'string'
          ? value
          : ''
        : typeof value === 'number'
          ? value
          : undefined;
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId} className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {title}
          {required ? <span className="ml-1 text-rose-500">*</span> : null}
        </label>
        <input
          id={fieldId}
          type={inputType}
          value={inputType === 'text' ? (parsedValue as string) : parsedValue ?? ''}
          onChange={(event) => {
            if (type === 'string') {
              handlePrimitiveChange(event.target.value);
            } else {
              const numeric = event.target.value;
              handlePrimitiveChange(numeric === '' ? undefined : Number(numeric));
            }
          }}
          className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
        />
        {description && <span className="text-xs text-slate-500 dark:text-slate-400">{description}</span>}
      </div>
    );
  }

  if (type === 'array') {
    const itemsSchema = toSchema(schema.items);
    const itemType = itemsSchema ? getSchemaType(itemsSchema) : null;
    const currentItems = Array.isArray(value) ? value : [];

    if (!itemsSchema || (itemType !== 'string' && itemType !== 'number')) {
      return (
        <div className="flex flex-col gap-1 rounded-2xl border border-amber-300/50 bg-amber-50/40 px-3 py-3 text-xs text-amber-600 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
          <span className="font-semibold">{title}</span>
          <span>
            Complex array schemas are best edited via the JSON editor. Switch to the JSON tab to modify this value.
          </span>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {title}
              {required ? <span className="ml-1 text-rose-500">*</span> : null}
            </span>
            {description && <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={() => onChange(path, [...currentItems, itemType === 'number' ? 0 : ''])}
          >
            Add value
          </button>
        </div>
        <div className="flex flex-col gap-2">
          {currentItems.map((item, index) => (
            <div key={`${fieldId}-${index}`} className="flex items-center gap-2">
              <input
                type={itemType === 'number' ? 'number' : 'text'}
                value={itemType === 'number' ? Number(item) : String(item ?? '')}
                onChange={(event) => {
                  const nextValue = itemType === 'number' ? Number(event.target.value) : event.target.value;
                  const nextItems = [...currentItems];
                  nextItems[index] = nextValue;
                  onChange(path, nextItems);
                }}
                className="flex-1 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
              />
              <button
                type="button"
                className="rounded-full border border-slate-200/70 bg-white/70 px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:border-rose-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-rose-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                onClick={() => {
                  const nextItems = [...currentItems];
                  nextItems.splice(index, 1);
                  onChange(path, nextItems);
                }}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'object') {
    const properties = toSchema(schema.properties);
    if (!properties) {
      return null;
    }
    const requiredKeys = extractRequired(schema);
    const propertyEntries = Object.entries(properties).filter((entry): entry is [string, JsonSchema] => isRecord(entry[1]));
    const currentObject = isRecord(value) ? value : {};

    return (
      <fieldset className="flex flex-col gap-4 rounded-2xl border border-slate-200/60 bg-slate-50/40 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
        <legend className="px-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</legend>
        {description && <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        {propertyEntries.map(([key, childSchema]) => (
          <FieldRenderer
            key={key}
            schema={childSchema}
            path={[...path, key]}
            value={currentObject[key]}
            onChange={onChange}
            required={requiredKeys.includes(key)}
          />
        ))}
      </fieldset>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-slate-200/60 bg-slate-50/40 px-3 py-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300">
      <span className="font-semibold text-slate-600 dark:text-slate-200">{title}</span>
      <span>
        This field uses a schema type that is not supported by the visual editor. Switch to the JSON tab to modify it directly.
      </span>
    </div>
  );
}

function formatParameters(value: unknown): string {
  if (value === null || value === undefined) {
    return EMPTY_JSON_TEXT;
  }
  try {
    return `${JSON.stringify(value, null, 2)}\n`;
  } catch {
    return EMPTY_JSON_TEXT;
  }
}

function describeSource(source: string | null): string | null {
  if (!source) {
    return null;
  }
  switch (source) {
    case 'workflow-run':
      return 'Captured from workflow run';
    case 'manual':
      return 'Manually set';
    case 'system':
      return 'System default';
    default:
      return source;
  }
}

export function AssetRecomputeDialog({
  open,
  workflowSlug,
  assetId,
  partition,
  workflowDefaultParameters,
  workflowParametersSchema,
  workflowParametersLoading = false,
  workflowParametersError = null,
  onClose,
  onSubmit,
  onClearStored
}: AssetRecomputeDialogProps) {
  const [mode, setMode] = useState<FormMode>('form');
  const [draftParameters, setDraftParameters] = useState<unknown>({});
  const [jsonValue, setJsonValue] = useState<string>(EMPTY_JSON_TEXT);
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<FormError[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [persistParameters, setPersistParameters] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [clearing, setClearing] = useState(false);

  const schema = useMemo(() => toSchema(workflowParametersSchema), [workflowParametersSchema]);
  const requiredKeys = useMemo(() => extractRequired(schema), [schema]);
  const validator: ValidateFunction | null = useMemo(() => {
    if (!schema) {
      return null;
    }
    try {
      return ajv.compile(schema);
    } catch (err) {
      console.error('Failed to compile parameters schema', err);
      return null;
    }
  }, [schema]);

  const validate = useCallback(
    (value: unknown) => {
      if (!validator) {
        setValidationErrors([]);
        return true;
      }
      const isValid = validator(value);
      if (isValid) {
        setValidationErrors([]);
        return true;
      }
      setValidationErrors(formatAjvErrors(validator.errors));
      return false;
    },
    [validator]
  );

  const partitionKey = partition?.partitionKey ?? null;
  const storedParameters = partition?.parameters ?? null;
  const hasStoredParameters = storedParameters !== null && storedParameters !== undefined;

  const sourceDescription = useMemo(() => describeSource(partition?.parametersSource ?? null), [partition]);
  const updatedLabel = useMemo(
    () => (partition?.parametersUpdatedAt ? formatTimestamp(partition.parametersUpdatedAt) : null),
    [partition]
  );

  const canUseForm = Boolean(schema && getSchemaType(schema) === 'object');

  const resetToDefaults = useCallback(() => {
    const defaults =
      workflowDefaultParameters !== undefined && workflowDefaultParameters !== null
        ? cloneValue(workflowDefaultParameters)
        : {};
    setDraftParameters(defaults);
    const text = formatParameters(defaults);
    setJsonValue(text);
    setParseError(null);
    validate(defaults);
    setSubmitError(null);
  }, [validate, workflowDefaultParameters]);

  const loadStoredParameters = useCallback(() => {
    if (!hasStoredParameters) {
      return;
    }
    const stored = cloneValue(storedParameters);
    setDraftParameters(stored);
    const text = formatParameters(stored);
    setJsonValue(text);
    setParseError(null);
    validate(stored);
    setSubmitError(null);
    setPersistParameters(true);
  }, [hasStoredParameters, storedParameters, validate]);

  useEffect(() => {
    if (!open || !partition || workflowParametersLoading) {
      return;
    }
    setPersistParameters(Boolean(partition.parameters));
    if (workflowParametersError && hasStoredParameters) {
      loadStoredParameters();
      setMode(canUseForm ? 'form' : 'json');
      return;
    }
    if (hasStoredParameters && workflowDefaultParameters === undefined) {
      loadStoredParameters();
      setMode(canUseForm ? 'form' : 'json');
      return;
    }
    resetToDefaults();
    setMode(canUseForm ? 'form' : 'json');
  }, [
    canUseForm,
    hasStoredParameters,
    loadStoredParameters,
    open,
    partition,
    resetToDefaults,
    workflowParametersError,
    workflowDefaultParameters,
    workflowParametersLoading
  ]);

  if (!open || !partition) {
    return null;
  }

  const handleClose = () => {
    if (submitting || clearing) {
      return;
    }
    onClose();
  };

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    try {
      const parsed = JSON.parse(value);
      setParseError(null);
      setDraftParameters(parsed);
      setSubmitError(null);
      validate(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setParseError(message);
      setValidationErrors([]);
    }
  };

  const handleFieldChange = (path: string[], value: unknown) => {
    setDraftParameters((current) => {
      const next = setValueAtPath(current, path, value);
      const text = formatParameters(next);
      setJsonValue(text);
      setParseError(null);
      setSubmitError(null);
      validate(next);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (submitting) {
      return;
    }
    if (mode === 'json' && parseError) {
      setSubmitError('Resolve JSON syntax issues before triggering the run.');
      return;
    }
    const parameters = draftParameters;
    const valid = validate(parameters);
    if (!valid) {
      setSubmitError('Resolve validation issues before triggering the run.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        partitionKey,
        parameters,
        persistParameters
      });
      setSubmitting(false);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to trigger run';
      setSubmitError(message);
      setSubmitting(false);
    }
  };

  const handleClearStored = async () => {
    if (!onClearStored || clearing) {
      return;
    }
    setSubmitError(null);
    setClearing(true);
    try {
      await onClearStored(partitionKey);
      resetToDefaults();
      setPersistParameters(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to clear stored parameters';
      setSubmitError(message);
    } finally {
      setClearing(false);
    }
  };

  const editorClassName = `rounded-2xl border ${
    parseError
      ? 'border-rose-400 ring-2 ring-rose-400 ring-offset-2 ring-offset-rose-50 dark:border-rose-500/70 dark:ring-rose-500/50 dark:ring-offset-slate-900'
      : 'border-slate-200/70 dark:border-slate-700/60'
  } bg-white/80 dark:bg-slate-900/70`;

  const resetButtonsDisabled = submitting || clearing || workflowParametersLoading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/60 p-4 pt-10 backdrop-blur-sm overscroll-contain sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-2xl dark:border-slate-700/70 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200/60 bg-slate-50/60 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900/60">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Trigger workflow run
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {workflowSlug ? `${workflowSlug} · ` : ''}
              {assetId ?? 'Unknown asset'} · Partition {partitionKey ?? 'default'}
            </p>
            {sourceDescription && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {sourceDescription}
                {updatedLabel ? ` · ${updatedLabel}` : ''}
              </p>
            )}
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={handleClose}
          >
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                Workflow parameters
                {requiredKeys.length > 0 ? (
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    Required keys: {requiredKeys.join(', ')}
                  </span>
                ) : null}
              </label>
              <div className="flex flex-wrap gap-2">
                {canUseForm && (
                  <button
                    type="button"
                    className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                      mode === 'form'
                        ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                        : 'border border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                    }`}
                    onClick={() => setMode('form')}
                    disabled={workflowParametersLoading || submitting || clearing}
                  >
                    Form
                  </button>
                )}
                <button
                  type="button"
                  className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                    mode === 'json' || !canUseForm
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                      : 'border border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                  }`}
                  onClick={() => setMode('json')}
                  disabled={workflowParametersLoading || submitting || clearing}
                >
                  JSON
                </button>
              </div>
            </div>

            {workflowParametersError && (
              <p className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-2 text-xs font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                {workflowParametersError}
              </p>
            )}

            {workflowParametersLoading && (
              <div className="rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-xs text-slate-500 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-400">
                Loading workflow defaults…
              </div>
            )}

            {!workflowParametersLoading && mode === 'form' && canUseForm && schema && (
              <div className="flex flex-col gap-3">
                <FieldRenderer schema={schema} path={[]} value={draftParameters} onChange={handleFieldChange} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                    onClick={resetToDefaults}
                    disabled={resetButtonsDisabled}
                  >
                    Reset to defaults
                  </button>
                  {hasStoredParameters && (
                    <button
                      type="button"
                      className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                      onClick={loadStoredParameters}
                      disabled={resetButtonsDisabled}
                    >
                      Load stored parameters
                    </button>
                  )}
                </div>
              </div>
            )}

            {(!canUseForm || mode === 'json' || !schema) && !workflowParametersLoading && (
              <div className="flex flex-col gap-2">
                <Editor
                  value={jsonValue}
                  onChange={handleJsonChange}
                  language="json"
                  height={260}
                  ariaLabel="Workflow run parameters JSON"
                  className={editorClassName}
                  readOnly={submitting || clearing}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                      onClick={resetToDefaults}
                      disabled={resetButtonsDisabled}
                    >
                      Reset to defaults
                    </button>
                    {hasStoredParameters && (
                      <button
                        type="button"
                        className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                        onClick={loadStoredParameters}
                        disabled={resetButtonsDisabled}
                      >
                        Load stored parameters
                      </button>
                    )}
                  </div>
                  {parseError && (
                    <span role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-300">
                      Unable to parse JSON: {parseError}
                    </span>
                  )}
                </div>
              </div>
            )}

            {validationErrors.length > 0 && (
              <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                <p>Validation issues:</p>
                <ul className="list-disc pl-4">
                  {validationErrors.map((issue, index) => (
                    <li key={issue.path ?? index}>
                      {issue.message}
                      {issue.path && <span className="ml-1 text-[10px] uppercase tracking-widest text-rose-400">{issue.path}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {submitError && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{submitError}</p>
            )}
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              checked={persistParameters}
              onChange={(event) => setPersistParameters(event.target.checked)}
              disabled={submitting || clearing}
            />
            <span>Save these parameters for future auto-materialized runs</span>
          </label>
        </div>

        <footer className="flex flex-col gap-3 border-t border-slate-200/60 bg-slate-50/60 px-6 py-4 dark:border-slate-700/60 dark:bg-slate-900/60 sm:flex-row sm:items-center sm:justify-between">
          {onClearStored && partition.parameters ? (
            <button
              type="button"
              className="text-xs font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-60 dark:text-slate-400 dark:hover:text-rose-400"
              onClick={handleClearStored}
              disabled={submitting || clearing}
            >
              {clearing ? 'Clearing…' : 'Clear stored parameters'}
            </button>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={handleClose}
              disabled={submitting || clearing}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-full bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:opacity-60"
              onClick={handleSubmit}
              disabled={
                submitting ||
                clearing ||
                workflowParametersLoading ||
                (mode === 'json' && Boolean(parseError)) ||
                (mode === 'form' && validationErrors.length > 0)
              }
            >
              {submitting ? 'Enqueuing…' : 'Trigger run'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default AssetRecomputeDialog;
