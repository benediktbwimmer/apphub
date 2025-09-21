import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import type { WorkflowDefinition, WorkflowRun } from '../types';
import { Editor } from '../../components/Editor';

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false, strictTuples: false });

type JsonSchema = Record<string, unknown>;

type ManualRunPanelProps = {
  workflow: WorkflowDefinition | null;
  onSubmit: (input: { parameters: unknown; triggeredBy?: string | null }) => Promise<void>;
  pending: boolean;
  error: string | null;
  authorized: boolean;
  lastRun?: WorkflowRun | null;
};

type FormMode = 'form' | 'json';

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

type FormError = {
  message: string;
  path?: string;
};

function formatAjvErrors(errors: ErrorObject[] | null | undefined): FormError[] {
  if (!errors || errors.length === 0) {
    return [];
  }
  return errors.map((error) => ({
    message: error.message ? `• ${error.message}` : 'Invalid input',
    path: error.instancePath || error.schemaPath
  }));
}

type FieldRendererProps = {
  schema: JsonSchema;
  path: string[];
  value: unknown;
  onChange: (path: string[], value: unknown) => void;
  required?: boolean;
};

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
          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
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
            className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
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
          className="rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
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
            className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
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
                className="flex-1 rounded-2xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
              />
              <button
                type="button"
                className="rounded-full border border-slate-200/70 bg-white/70 px-2 py-1 text-xs font-semibold text-slate-500 transition-colors hover:border-rose-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-rose-500 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
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

export function ManualRunPanel({ workflow, onSubmit, pending, error, authorized, lastRun }: ManualRunPanelProps) {
  const schema = useMemo(() => toSchema(workflow?.parametersSchema), [workflow]);
  const defaultParameters = useMemo(() => {
    if (!workflow?.defaultParameters) {
      return {};
    }
    if (isRecord(workflow.defaultParameters)) {
      return cloneValue(workflow.defaultParameters);
    }
    return workflow.defaultParameters;
  }, [workflow]);

  const [mode, setMode] = useState<FormMode>('form');
  const [formData, setFormData] = useState<unknown>(defaultParameters);
  const [jsonValue, setJsonValue] = useState<string>(JSON.stringify(defaultParameters ?? {}, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<FormError[]>([]);
  const [triggeredBy, setTriggeredBy] = useState<string>('');

  useEffect(() => {
    setFormData(defaultParameters);
    setJsonValue(JSON.stringify(defaultParameters ?? {}, null, 2));
    setParseError(null);
    setValidationErrors([]);
  }, [defaultParameters]);

  const validator: ValidateFunction | null = useMemo(() => {
    if (!schema) {
      return null;
    }
    try {
      return ajv.compile(schema);
    } catch (err) {
      console.error('Failed to compile schema', err);
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

  useEffect(() => {
    if (mode === 'form') {
      validate(formData);
    }
  }, [formData, mode, validate]);

  const handleJsonChange = (nextValue: string) => {
    setJsonValue(nextValue);
    try {
      const parsed = JSON.parse(nextValue);
      setParseError(null);
      validate(parsed);
      setFormData(parsed);
    } catch (err) {
      setParseError((err as Error).message);
      setValidationErrors([]);
    }
  };

  const handleFieldChange = (path: string[], value: unknown) => {
    setFormData((current: unknown) => setValueAtPath(current, path, value));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authorized) {
      return;
    }
    let parameters: unknown = formData;

    if (mode === 'json') {
      try {
        parameters = JSON.parse(jsonValue);
        setParseError(null);
      } catch (err) {
        setParseError((err as Error).message);
        return;
      }
    }

    const valid = validate(parameters);
    if (!valid) {
      return;
    }

    await onSubmit({ parameters, triggeredBy: triggeredBy.trim() === '' ? null : triggeredBy.trim() });
  };

  const canUseForm = schema ? getSchemaType(schema) === 'object' : typeof defaultParameters === 'object';

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Manual Run</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Launch a workflow run with parameters validated against the registered JSON schema.
        </p>
      </div>
      {!workflow && (
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Select a workflow to launch.</p>
      )}
      {workflow && (
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          {!authorized && (
            <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs font-semibold text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
              Add an operator token in the API Access tab before launching workflows.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {canUseForm && (
              <button
                type="button"
                className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                  mode === 'form'
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                    : 'border border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
                }`}
                onClick={() => setMode('form')}
              >
                Form
              </button>
            )}
            <button
              type="button"
              className={`rounded-full px-4 py-2 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                mode === 'json' || !canUseForm
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                  : 'border border-slate-200/70 bg-white/70 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300'
              }`}
              onClick={() => setMode('json')}
            >
              JSON
            </button>
          </div>

          <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-700/70 dark:bg-slate-900/60">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Triggered by
              </span>
              <input
                type="text"
                value={triggeredBy}
                onChange={(event) => setTriggeredBy(event.target.value)}
                placeholder="you@example.com"
                className="rounded-2xl border border-slate-200/70 bg-white/90 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-200/50 dark:border-slate-700/60 dark:bg-slate-900/70 dark:text-slate-200 dark:focus:border-slate-300 dark:focus:ring-slate-500/40"
              />
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Optional operator identity recorded with the run.
              </span>
            </label>
          </div>

          {mode === 'form' && canUseForm && schema && (
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/70 dark:bg-slate-900/70">
              <FieldRenderer
                schema={schema}
                path={[]}
                value={formData}
                onChange={handleFieldChange}
              />
              <button
                type="button"
                className="self-start rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                onClick={() => {
                  setFormData(defaultParameters);
                  setJsonValue(JSON.stringify(defaultParameters ?? {}, null, 2));
                  setValidationErrors([]);
                }}
              >
                Reset to defaults
              </button>
            </div>
          )}

          {(mode === 'json' || !canUseForm || !schema) && (
            <div className="flex flex-col gap-2">
              <Editor
                value={jsonValue}
                onChange={handleJsonChange}
                language="json"
                height={320}
                ariaLabel="Workflow run parameters JSON"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800"
                  onClick={() => {
                    const text = JSON.stringify(defaultParameters ?? {}, null, 2);
                    setJsonValue(text);
                    handleJsonChange(text);
                  }}
                >
                  Reset to defaults
                </button>
                {parseError && (
                  <span className="text-xs font-semibold text-rose-600 dark:text-rose-300">{parseError}</span>
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

          {error && (
            <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          {lastRun && (
            <div className="rounded-2xl border border-emerald-300/60 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/10 dark:text-emerald-300">
              <p className="font-semibold">Triggered run {lastRun.id}</p>
              <p>Status: {lastRun.status}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/30 transition-colors hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!authorized || pending || parseError !== null || (validationErrors.length > 0 && mode === 'form')}
            >
              {pending ? 'Launching…' : 'Launch workflow'}
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Runs are enqueued immediately and appear in the history panel.
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

export default ManualRunPanel;
