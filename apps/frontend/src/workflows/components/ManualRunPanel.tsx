import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { getStatusToneClasses } from '../../theme/statusTokens';
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
  unreachableServices: string[];
};

type FormMode = 'form' | 'json';

const PANEL_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md transition-colors';

const PANEL_HEADER_TITLE = 'text-scale-lg font-weight-semibold text-primary';

const PANEL_HEADER_SUBTEXT = 'text-scale-xs text-secondary';

const INFO_WARNING_CARD = (tone: 'warning' | 'danger' | 'info' | 'success') =>
  `rounded-2xl border px-4 py-3 text-scale-xs font-weight-semibold ${getStatusToneClasses(tone)}`;

const GUIDANCE_CARD = 'rounded-2xl border border-subtle bg-surface-glass px-4 py-3 text-scale-xs text-secondary';

const SECTION_TITLE = 'text-scale-sm font-weight-semibold text-primary';

const SECTION_DESCRIPTION = 'text-scale-xs text-secondary';

const INPUT_FIELD =
  'rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-elevation-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const SELECT_FIELD = INPUT_FIELD;

const ARRAY_NOTICE =
  `flex flex-col gap-1 rounded-2xl border px-3 py-3 text-scale-xs font-weight-semibold ${getStatusToneClasses('warning')}`;

const SMALL_BUTTON =
  'rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const REMOVE_BUTTON =
  'rounded-full border border-subtle bg-surface-glass px-2 py-1 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-status-danger hover:text-status-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FIELDSET_CONTAINER =
  'flex flex-col gap-4 rounded-2xl border border-subtle bg-surface-glass p-4';

const FIELDSET_LEGEND = 'px-2 text-scale-sm font-weight-semibold text-primary';

const CODE_BLOCK =
  'mt-1 max-h-48 overflow-auto rounded-xl bg-surface-sunken px-3 py-2 font-mono text-scale-xs text-primary';

const MODE_TOGGLE_BASE =
  'rounded-full px-4 py-2 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const MODE_TOGGLE_ACTIVE = 'bg-accent text-inverse shadow-elevation-sm';

const MODE_TOGGLE_INACTIVE =
  'border border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

const PRIMARY_SUBMIT_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-accent bg-accent px-5 py-2 text-scale-sm font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const SECONDARY_LINK =
  'mt-2 inline-flex items-center text-scale-xs font-weight-semibold text-accent underline-offset-2 transition-colors hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const CHECKBOX_INPUT =
  'mt-1 h-4 w-4 rounded border-subtle accent-accent text-accent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent focus-visible:ring-0';

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

function extractExample(schema: JsonSchema | null): Record<string, unknown> | null {
  if (!schema) {
    return null;
  }
  const example = schema.example as unknown;
  if (isRecord(example)) {
    return example;
  }
  const examples = schema.examples as unknown;
  if (Array.isArray(examples)) {
    const firstExample = examples.find((entry) => isRecord(entry));
    if (isRecord(firstExample)) {
      return firstExample;
    }
  }
  return null;
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
          className={CHECKBOX_INPUT}
        />
        <div className="flex flex-col">
          <span className={SECTION_TITLE}>
            {title}
            {required ? <span className={REQUIRED_MARK}>*</span> : null}
          </span>
          {description && <span className={SECTION_DESCRIPTION}>{description}</span>}
        </div>
      </label>
    );
  }

  if (type === 'string' || type === 'number' || type === 'integer') {
    if (enumValues && enumValues.length > 0) {
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={fieldId} className={SECTION_TITLE}>
            {title}
            {required ? <span className={REQUIRED_MARK}>*</span> : null}
          </label>
          <select
            id={fieldId}
            value={value as string | number | undefined}
            onChange={(event) => handlePrimitiveChange(event.target.value)}
            className={SELECT_FIELD}
          >
            <option value="">Select…</option>
            {enumValues.map((entry) => (
              <option key={String(entry)} value={String(entry)}>
                {String(entry)}
              </option>
            ))}
          </select>
          {description && <span className={SECTION_DESCRIPTION}>{description}</span>}
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
        <label htmlFor={fieldId} className={SECTION_TITLE}>
          {title}
          {required ? <span className={REQUIRED_MARK}>*</span> : null}
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
          className={INPUT_FIELD}
        />
        {description && <span className={SECTION_DESCRIPTION}>{description}</span>}
      </div>
    );
  }

  if (type === 'array') {
    const itemsSchema = toSchema(schema.items);
    const itemType = itemsSchema ? getSchemaType(itemsSchema) : null;
    const currentItems = Array.isArray(value) ? value : [];

    if (!itemsSchema || (itemType !== 'string' && itemType !== 'number')) {
      return (
        <div className={ARRAY_NOTICE}>
          <span>{title}</span>
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
            <span className={SECTION_TITLE}>
              {title}
              {required ? <span className={REQUIRED_MARK}>*</span> : null}
            </span>
            {description && <p className={SECTION_DESCRIPTION}>{description}</p>}
          </div>
          <button
            type="button"
            className={SMALL_BUTTON}
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
                className={`${INPUT_FIELD} flex-1`}
              />
              <button
                type="button"
                className={REMOVE_BUTTON}
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
      <fieldset className={FIELDSET_CONTAINER}>
        <legend className={FIELDSET_LEGEND}>{title}</legend>
        {description && <p className={SECTION_DESCRIPTION}>{description}</p>}
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
    <div className={`${SECTION_CARD} gap-1 text-scale-xs`}>
      <span className="font-weight-semibold text-primary">{title}</span>
      <span>
        This field uses a schema type that is not supported by the visual editor. Switch to the JSON tab to modify it directly.
      </span>
    </div>
  );
}

export function ManualRunPanel({
  workflow,
  onSubmit,
  pending,
  error,
  authorized,
  lastRun,
  unreachableServices
}: ManualRunPanelProps) {
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
  const requiredKeys = useMemo(() => extractRequired(schema), [schema]);
  const examplePayload = useMemo(() => {
    if (isRecord(defaultParameters) && Object.keys(defaultParameters).length > 0) {
      return cloneValue(defaultParameters);
    }
    const schemaExample = extractExample(schema);
    if (schemaExample) {
      return cloneValue(schemaExample);
    }
    if (requiredKeys.length > 0) {
      return requiredKeys.reduce<Record<string, string>>((acc, key) => {
        acc[key] = '<value>';
        return acc;
      }, {});
    }
    return null;
  }, [defaultParameters, requiredKeys, schema]);
  const examplePayloadText = useMemo(() => {
    if (!examplePayload) {
      return '{\n  "parameter": "value"\n}';
    }
    try {
      return JSON.stringify(examplePayload, null, 2);
    } catch (err) {
      console.error('Failed to stringify example payload', err);
      return '{\n  "parameter": "value"\n}';
    }
  }, [examplePayload]);

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
  const editorClassName = `overflow-hidden rounded-2xl border ${
    parseError ? 'border-status-danger' : 'border-subtle'
  } bg-surface-glass shadow-elevation-sm`;

  return (
    <section className={PANEL_CONTAINER}>
      <div className="flex flex-col gap-1">
        <h2 className={PANEL_HEADER_TITLE}>Manual Run</h2>
        <p className={PANEL_HEADER_SUBTEXT}>
          Launch a workflow run with parameters validated against the registered JSON schema.
        </p>
      </div>
      {!workflow && (
        <p className="mt-4 text-scale-sm text-secondary">Select a workflow to launch.</p>
      )}
      {workflow && (
        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          {!authorized && (
            <div className={INFO_WARNING_CARD('warning')}>
              Add an operator token under Settings → API Access before launching workflows.
            </div>
          )}
          {unreachableServices.length > 0 && (
            <div className={INFO_WARNING_CARD('danger')}>
              Cannot launch while the following services are unreachable: {unreachableServices.join(', ')}.
            </div>
          )}
          <div className={GUIDANCE_CARD}>
            <p className={SECTION_TITLE}>Parameter format</p>
            <p className="mt-1 leading-relaxed">
              Provide a JSON payload that matches the workflow&apos;s parameter schema before launching a run.
              {requiredKeys.length > 0 ? ` Required keys: ${requiredKeys.join(', ')}.` : ' No required keys are defined.'}
            </p>
            <p className={`mt-2 ${SECTION_TITLE}`}>Example payload</p>
            <pre className={CODE_BLOCK}>
              <code>{examplePayloadText}</code>
            </pre>
            <a
              className={SECONDARY_LINK}
              href="https://docs.apphub.run/workflows/manual-runs"
              target="_blank"
              rel="noreferrer noopener"
            >
              Review manual run documentation
            </a>
          </div>
          <div className="flex flex-wrap gap-2">
            {canUseForm && (
              <button
                type="button"
                className={`${MODE_TOGGLE_BASE} ${
                  mode === 'form' ? MODE_TOGGLE_ACTIVE : MODE_TOGGLE_INACTIVE
                }`}
                onClick={() => setMode('form')}
              >
                Form
              </button>
            )}
            <button
              type="button"
              className={`${MODE_TOGGLE_BASE} ${
                mode === 'json' || !canUseForm ? MODE_TOGGLE_ACTIVE : MODE_TOGGLE_INACTIVE
              }`}
              onClick={() => setMode('json')}
            >
              JSON
            </button>
          </div>

          <div className={SECTION_CARD}>
            <label className="flex flex-col gap-1">
              <span className={SECTION_LABEL}>Triggered by</span>
              <input
                type="text"
                value={triggeredBy}
                onChange={(event) => setTriggeredBy(event.target.value)}
                placeholder="you@example.com"
                className={INPUT_FIELD}
              />
              <span className="text-[11px] text-secondary">
                Optional operator identity recorded with the run.
              </span>
            </label>
          </div>

          {mode === 'form' && canUseForm && schema && (
            <div className={`${SECTION_CARD} flex flex-col gap-4`}>
              <FieldRenderer
                schema={schema}
                path={[]}
                value={formData}
                onChange={handleFieldChange}
              />
              <button
                type="button"
                className={`${SMALL_BUTTON} self-start`}
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
                className={editorClassName}
              />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  onClick={() => {
                    const text = JSON.stringify(defaultParameters ?? {}, null, 2);
                    setJsonValue(text);
                    handleJsonChange(text);
                  }}
                >
                  Reset to defaults
                </button>
                {parseError && (
                  <span role="alert" aria-live="assertive" className="text-scale-xs font-weight-semibold text-status-danger">
                    Unable to parse JSON: {parseError}
                  </span>
                )}
              </div>
            </div>
          )}

          {validationErrors.length > 0 && (
            <div className={INFO_WARNING_CARD('danger')}>
              <p>Validation issues:</p>
              <ul className="list-disc pl-4">
                {validationErrors.map((issue, index) => (
                  <li key={issue.path ?? index}>
                    {issue.message}
                    {issue.path && <span className="ml-1 text-[10px] uppercase tracking-[0.3em] text-status-danger">{issue.path}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className={INFO_WARNING_CARD('danger')}>
              {error}
            </div>
          )}

          {lastRun && (
            <div className={INFO_WARNING_CARD('success')}>
              <p className="font-weight-semibold">Triggered run {lastRun.id}</p>
              <p>Status: {lastRun.status}</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className={PRIMARY_SUBMIT_BUTTON}
              disabled={
                !authorized ||
                pending ||
                parseError !== null ||
                (validationErrors.length > 0 && mode === 'form') ||
                unreachableServices.length > 0
              }
            >
              {pending ? 'Launching…' : 'Launch workflow'}
            </button>
            <span className="text-scale-xs text-secondary">
              Runs are enqueued immediately and appear in the history panel.
            </span>
          </div>
        </form>
      )}
    </section>
  );
}

export default ManualRunPanel;
