import classNames from 'classnames';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv';
import { Editor, Modal, Spinner } from '../../components';
import { formatTimestamp } from '../../workflows/formatters';
import type { WorkflowAssetPartitionSummary } from '../../workflows/types';
import {
  DATA_ASSET_ALERT_ERROR,
  DATA_ASSET_BUTTON_GHOST,
  DATA_ASSET_BUTTON_PRIMARY,
  DATA_ASSET_BUTTON_SECONDARY,
  DATA_ASSET_BUTTON_TERTIARY,
  DATA_ASSET_CARD,
  DATA_ASSET_CHECKBOX,
  DATA_ASSET_DIALOG_CLOSE_BUTTON,
  DATA_ASSET_DIALOG_HEADER,
  DATA_ASSET_DIALOG_META,
  DATA_ASSET_DIALOG_SURFACE,
  DATA_ASSET_DIALOG_TITLE,
  DATA_ASSET_EDITOR,
  DATA_ASSET_EDITOR_ERROR,
  DATA_ASSET_FORM_ARRAY_NOTICE,
  DATA_ASSET_FORM_FIELD,
  DATA_ASSET_FORM_HELPER,
  DATA_ASSET_FORM_INPUT,
  DATA_ASSET_FORM_LABEL,
  DATA_ASSET_FORM_UNSUPPORTED,
  DATA_ASSET_NOTE,
  DATA_ASSET_SEGMENTED_BUTTON,
  DATA_ASSET_SEGMENTED_BUTTON_ACTIVE,
  DATA_ASSET_SEGMENTED_BUTTON_INACTIVE,
  DATA_ASSET_SEGMENTED_GROUP
} from '../dataAssetsTokens';

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
          className={classNames('mt-1', DATA_ASSET_CHECKBOX)}
        />
        <div className="flex flex-col gap-1">
          <span className={DATA_ASSET_FORM_LABEL}>
            {title}
            {required ? <span className="ml-1 text-status-danger">*</span> : null}
          </span>
          {description ? <span className={DATA_ASSET_FORM_HELPER}>{description}</span> : null}
        </div>
      </label>
    );
  }

  if (type === 'string' || type === 'number' || type === 'integer') {
    if (enumValues && enumValues.length > 0) {
      return (
        <div className={DATA_ASSET_FORM_FIELD}>
          <label htmlFor={fieldId} className={DATA_ASSET_FORM_LABEL}>
            {title}
            {required ? <span className="ml-1 text-status-danger">*</span> : null}
          </label>
          <select
            id={fieldId}
            value={value as string | number | undefined}
            onChange={(event) => handlePrimitiveChange(event.target.value)}
            className={DATA_ASSET_FORM_INPUT}
          >
            <option value="">Select…</option>
            {enumValues.map((entry) => (
              <option key={String(entry)} value={String(entry)}>
                {String(entry)}
              </option>
            ))}
          </select>
          {description ? <span className={DATA_ASSET_FORM_HELPER}>{description}</span> : null}
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
      <div className={DATA_ASSET_FORM_FIELD}>
        <label htmlFor={fieldId} className={DATA_ASSET_FORM_LABEL}>
          {title}
          {required ? <span className="ml-1 text-status-danger">*</span> : null}
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
          className={DATA_ASSET_FORM_INPUT}
        />
        {description ? <span className={DATA_ASSET_FORM_HELPER}>{description}</span> : null}
      </div>
    );
  }

  if (type === 'array') {
    const itemsSchema = toSchema(schema.items);
    const itemType = itemsSchema ? getSchemaType(itemsSchema) : null;
    const currentItems = Array.isArray(value) ? value : [];

    if (!itemsSchema || (itemType !== 'string' && itemType !== 'number')) {
      return (
        <div className={DATA_ASSET_FORM_ARRAY_NOTICE}>
          <span className="font-weight-semibold">{title}</span>
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
            <span className={DATA_ASSET_FORM_LABEL}>
              {title}
              {required ? <span className="ml-1 text-status-danger">*</span> : null}
            </span>
            {description ? <p className={DATA_ASSET_FORM_HELPER}>{description}</p> : null}
          </div>
          <button
            type="button"
            className={DATA_ASSET_BUTTON_SECONDARY}
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
                className={classNames('flex-1', DATA_ASSET_FORM_INPUT)}
              />
              <button
                type="button"
                className={classNames(
                  DATA_ASSET_BUTTON_TERTIARY,
                  'text-status-danger hover:text-status-danger'
                )}
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
      <fieldset className={classNames(DATA_ASSET_CARD, 'flex flex-col gap-4')}>
        <legend className={classNames(DATA_ASSET_FORM_LABEL, 'px-2')}>
          {title}
          {required ? <span className="ml-1 text-status-danger">*</span> : null}
        </legend>
        {description ? <p className={DATA_ASSET_FORM_HELPER}>{description}</p> : null}
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
    <div className={DATA_ASSET_FORM_UNSUPPORTED}>
      <span className="font-weight-semibold text-primary">{title}</span>
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
    setDraftParameters((current: unknown) => {
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

  const editorClassName = classNames(
    DATA_ASSET_EDITOR,
    'min-h-[260px] font-mono',
    parseError ? DATA_ASSET_EDITOR_ERROR : null
  );

  const resetButtonsDisabled = submitting || clearing || workflowParametersLoading;

  const dialogTitleId = 'asset-recompute-title';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy={dialogTitleId}
      className="items-start justify-center p-4 pt-10 sm:items-center sm:p-6"
      contentClassName={DATA_ASSET_DIALOG_SURFACE}
    >
        <header className={DATA_ASSET_DIALOG_HEADER}>
          <div className="space-y-1">
            <h2 id={dialogTitleId} className={DATA_ASSET_DIALOG_TITLE}>
              Trigger workflow run
            </h2>
            <p className={DATA_ASSET_DIALOG_META}>
              {workflowSlug ? `${workflowSlug} · ` : ''}
              {assetId ?? 'Unknown asset'} · Partition {partitionKey ?? 'default'}
            </p>
            {sourceDescription ? (
              <p className={DATA_ASSET_DIALOG_META}>
                {sourceDescription}
                {updatedLabel ? ` · ${updatedLabel}` : ''}
              </p>
            ) : null}
          </div>
          <button type="button" className={DATA_ASSET_DIALOG_CLOSE_BUTTON} onClick={handleClose}>
            Close
          </button>
        </header>

        <div className="flex flex-col gap-4 px-6 py-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className={DATA_ASSET_FORM_LABEL}>
              Workflow parameters
              {requiredKeys.length > 0 ? (
                <span className={classNames('ml-2 font-weight-regular', DATA_ASSET_FORM_HELPER)}>
                  Required keys: {requiredKeys.join(', ')}
                </span>
              ) : null}
            </label>
              <div className={DATA_ASSET_SEGMENTED_GROUP}>
                {canUseForm && (
                  <button
                    type="button"
                    className={classNames(
                      DATA_ASSET_SEGMENTED_BUTTON,
                      mode === 'form'
                        ? DATA_ASSET_SEGMENTED_BUTTON_ACTIVE
                        : DATA_ASSET_SEGMENTED_BUTTON_INACTIVE
                    )}
                    onClick={() => setMode('form')}
                    disabled={workflowParametersLoading || submitting || clearing}
                  >
                    Form
                  </button>
                )}
                <button
                  type="button"
                  className={classNames(
                    DATA_ASSET_SEGMENTED_BUTTON,
                    mode === 'json' || !canUseForm
                      ? DATA_ASSET_SEGMENTED_BUTTON_ACTIVE
                      : DATA_ASSET_SEGMENTED_BUTTON_INACTIVE
                  )}
                  onClick={() => setMode('json')}
                  disabled={workflowParametersLoading || submitting || clearing}
                >
                  JSON
                </button>
              </div>
            </div>

            {workflowParametersError ? (
              <div className={DATA_ASSET_ALERT_ERROR}>{workflowParametersError}</div>
            ) : null}

            {workflowParametersLoading ? (
              <div className={classNames(DATA_ASSET_CARD, 'text-scale-xs text-secondary')}>
                <Spinner label="Loading workflow defaults…" size="xs" />
              </div>
            ) : null}

            {!workflowParametersLoading && mode === 'form' && canUseForm && schema && (
              <div className="flex flex-col gap-3">
                <FieldRenderer schema={schema} path={[]} value={draftParameters} onChange={handleFieldChange} />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={DATA_ASSET_BUTTON_SECONDARY}
                    onClick={resetToDefaults}
                    disabled={resetButtonsDisabled}
                  >
                    Reset to defaults
                  </button>
                  {hasStoredParameters && (
                    <button
                      type="button"
                      className={DATA_ASSET_BUTTON_SECONDARY}
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
                      className={DATA_ASSET_BUTTON_SECONDARY}
                      onClick={resetToDefaults}
                      disabled={resetButtonsDisabled}
                    >
                      Reset to defaults
                    </button>
                    {hasStoredParameters && (
                      <button
                        type="button"
                        className={DATA_ASSET_BUTTON_SECONDARY}
                        onClick={loadStoredParameters}
                        disabled={resetButtonsDisabled}
                      >
                        Load stored parameters
                      </button>
                    )}
                  </div>
                  {parseError ? (
                    <span
                      role="alert"
                      className={classNames(DATA_ASSET_NOTE, 'font-weight-semibold text-status-danger')}
                    >
                      Unable to parse JSON: {parseError}
                    </span>
                  ) : null}
                </div>
              </div>
            )}

            {validationErrors.length > 0 ? (
              <div className={DATA_ASSET_ALERT_ERROR}>
                <p className="font-weight-semibold">Validation issues:</p>
                <ul className="list-disc pl-4">
                  {validationErrors.map((issue, index) => (
                    <li key={issue.path ?? index}>
                      {issue.message}
                      {issue.path ? (
                        <span className="ml-1 text-[10px] uppercase tracking-[0.3em] text-status-danger">
                          {issue.path}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {submitError ? <div className={DATA_ASSET_ALERT_ERROR}>{submitError}</div> : null}
          </div>

          <label className="flex items-center gap-3 text-scale-sm text-secondary">
            <input
              type="checkbox"
              className={DATA_ASSET_CHECKBOX}
              checked={persistParameters}
              onChange={(event) => setPersistParameters(event.target.checked)}
              disabled={submitting || clearing}
            />
            <span>Save these parameters for future auto-materialized runs</span>
          </label>
        </div>

        <footer className="flex flex-col gap-3 border-t border-subtle bg-surface-glass-soft px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {onClearStored && partition.parameters ? (
            <button
              type="button"
              className={classNames(
                DATA_ASSET_BUTTON_GHOST,
                'text-status-danger hover:text-status-danger'
              )}
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
              className={DATA_ASSET_BUTTON_SECONDARY}
              onClick={handleClose}
              disabled={submitting || clearing}
            >
              Cancel
            </button>
            <button
              type="button"
              className={DATA_ASSET_BUTTON_PRIMARY}
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
    </Modal>
  );
}

export default AssetRecomputeDialog;
