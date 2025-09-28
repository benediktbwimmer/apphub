import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import FormField from '../../components/form/FormField';
import { Spinner } from '../../components';
import { formatInstant, parseMetadataInput, stringifyMetadata } from '../utils';
import type { SchemaDefinitionHookState } from '../useSchemaDefinition';
import type { MetastoreSchemaDefinition, MetastoreSchemaFieldDefinition } from '../types';

type MetadataValue = Record<string, unknown>;

type MetadataEditorMode = 'schema' | 'json';

type SchemaAwareMetadataEditorProps = {
  schemaHash: string | null | undefined;
  schemaState: SchemaDefinitionHookState;
  metadataMode: MetadataEditorMode;
  onMetadataModeChange: (mode: MetadataEditorMode) => void;
  metadataDraft: MetadataValue;
  onMetadataDraftChange: (next: MetadataValue) => void;
  metadataText: string;
  onMetadataTextChange: (next: string) => void;
  parseError: string | null;
  onParseErrorChange: (error: string | null) => void;
  onValidationChange: (errors: Record<string, string>) => void;
  hasWriteScope: boolean;
};

type FieldErrorMap = Record<string, string>;

type EnumOption = string | number | boolean;

function splitPath(path: string): string[] {
  return path.split('.').filter((segment) => segment.length > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getValueAtPath(source: MetadataValue, path: string[]): unknown {
  let current: unknown = source;
  for (const segment of path) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function cloneContainer(container: unknown): Record<string, unknown> {
  if (isPlainObject(container)) {
    return { ...container };
  }
  return {};
}

function removeEmptyBranches(value: unknown): unknown {
  if (Array.isArray(value)) {
    const filtered = value.filter((entry) => entry !== undefined);
    return filtered.length > 0 ? filtered : undefined;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
      .map(([key, entry]) => [key, removeEmptyBranches(entry)] as const)
      .filter(([, entry]) => entry !== undefined);
    if (entries.length === 0) {
      return undefined;
    }
    const result: Record<string, unknown> = {};
    for (const [key, entry] of entries) {
      result[key] = entry;
    }
    return result;
  }
  return value;
}

function setValueAtPath(source: MetadataValue, path: string[], value: unknown): MetadataValue {
  if (path.length === 0) {
    return source;
  }
  const [head, ...rest] = path;
  const clone = cloneContainer(source);
  if (rest.length === 0) {
    if (value === undefined) {
      delete clone[head];
    } else {
      clone[head] = value;
    }
    return (removeEmptyBranches(clone) as MetadataValue) ?? {};
  }

  const current = clone[head];
  const childContainer = isPlainObject(current) ? current : {};
  const updatedChild = setValueAtPath(childContainer, rest, value);
  if (updatedChild === undefined) {
    delete clone[head];
  } else {
    clone[head] = updatedChild;
  }
  return (removeEmptyBranches(clone) as MetadataValue) ?? {};
}

function inferEnumOptions(field: MetastoreSchemaFieldDefinition): EnumOption[] | null {
  const rawEnum = field.constraints?.['enum'] ?? field.metadata?.['enum'];
  if (!Array.isArray(rawEnum)) {
    return null;
  }
  const validOptions = rawEnum.filter((entry) => ['string', 'number', 'boolean'].includes(typeof entry));
  return validOptions.length > 0 ? (validOptions as EnumOption[]) : null;
}

function normalizeFieldType(field: MetastoreSchemaFieldDefinition): string {
  return field.type?.toLowerCase() ?? '';
}

function isFieldDeprecated(field: MetastoreSchemaFieldDefinition): boolean {
  const metadataDeprecated = field.metadata?.['deprecated'] === true;
  const hintsDeprecated = field.hints?.['deprecated'] === true;
  return metadataDeprecated || hintsDeprecated;
}

function validateFieldValue(field: MetastoreSchemaFieldDefinition, value: unknown): string | null {
  const fieldType = normalizeFieldType(field);
  const isRepeated = field.repeated === true;

  if (value === undefined || value === null) {
    if (field.required) {
      return 'This field is required';
    }
    return null;
  }

  if (isRepeated) {
    if (!Array.isArray(value)) {
      return 'Expected an array';
    }
    if (field.required && value.length === 0) {
      return 'Please provide at least one value';
    }
    for (const entry of value) {
      const message = validateFieldValue({ ...field, repeated: false }, entry);
      if (message) {
        return message;
      }
    }
    return null;
  }

  switch (fieldType) {
    case 'string':
      if (typeof value !== 'string') {
        return 'Expected a string';
      }
      if (field.required && value.trim().length === 0) {
        return 'This field is required';
      }
      return null;
    case 'number':
    case 'float':
    case 'double':
    case 'decimal':
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return 'Expected a number';
      }
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        return 'Expected an integer';
      }
      return null;
    case 'boolean':
      if (typeof value !== 'boolean') {
        return 'Expected true or false';
      }
      return null;
    case 'object':
      if (!isPlainObject(value)) {
        return 'Expected an object';
      }
      return null;
    default:
      return null;
  }
}

function coerceScalarValue(
  field: MetastoreSchemaFieldDefinition,
  rawValue: string | number | boolean
): { value: unknown; error: string | null } {
  const fieldType = normalizeFieldType(field);

  if (typeof rawValue === 'boolean') {
    return { value: rawValue, error: null };
  }

  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : rawValue;
  if (trimmed === '' && !field.required) {
    return { value: undefined, error: null };
  }

  switch (fieldType) {
    case 'string':
      if (typeof rawValue === 'string') {
        return { value: rawValue, error: null };
      }
      return { value: String(rawValue), error: null };
    case 'number':
    case 'float':
    case 'double':
    case 'decimal':
    case 'integer': {
      if (typeof rawValue === 'string' && rawValue.trim() === '' && field.required) {
        return { value: undefined, error: 'This field is required' };
      }
      if (typeof rawValue === 'number') {
        const error = validateFieldValue({ ...field, repeated: false }, rawValue);
        return { value: error ? undefined : rawValue, error };
      }
      if (typeof trimmed !== 'string') {
        return { value: undefined, error: 'Expected a number' };
      }
      const parsed = Number(trimmed);
      if (Number.isNaN(parsed)) {
        return { value: undefined, error: 'Expected a number' };
      }
      const error = validateFieldValue({ ...field, repeated: false }, parsed);
      return { value: error ? undefined : parsed, error };
    }
    case 'boolean':
      if (typeof rawValue === 'string') {
        if (rawValue.toLowerCase() === 'true') {
          return { value: true, error: null };
        }
        if (rawValue.toLowerCase() === 'false') {
          return { value: false, error: null };
        }
      }
      if (typeof rawValue === 'number') {
        if (rawValue === 1) {
          return { value: true, error: null };
        }
        if (rawValue === 0) {
          return { value: false, error: null };
        }
      }
      return { value: undefined, error: 'Expected true or false' };
    default:
      return { value: rawValue, error: null };
  }
}

function toDisplayValue(field: MetastoreSchemaFieldDefinition, value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  const type = normalizeFieldType(field);
  if (type === 'string') {
    return String(value);
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? String(value) : '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '';
  }
  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

function collectMetadataPaths(value: unknown, prefix = ''): string[] {
  if (value === undefined || value === null) {
    return prefix ? [prefix] : [];
  }
  if (Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return prefix ? [prefix] : [];
    }
    return entries.flatMap(([key, child]) => {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      return collectMetadataPaths(child, nextPrefix);
    });
  }
  return prefix ? [prefix] : [];
}

function fieldGroupKey(path: string): string {
  const segments = splitPath(path);
  if (segments.length <= 1) {
    return 'root';
  }
  return segments.slice(0, -1).join('.');
}

function groupFields(schema: MetastoreSchemaDefinition | null): Map<string, MetastoreSchemaFieldDefinition[]> {
  const groups = new Map<string, MetastoreSchemaFieldDefinition[]>();
  if (!schema) {
    return groups;
  }
  for (const field of schema.fields) {
    const key = fieldGroupKey(field.path);
    const existing = groups.get(key);
    if (existing) {
      existing.push(field);
    } else {
      groups.set(key, [field]);
    }
  }
  return groups;
}

function renderGroupLabel(groupKey: string): string {
  return groupKey === 'root' ? 'General' : groupKey;
}

export default function SchemaAwareMetadataEditor({
  schemaHash,
  schemaState,
  metadataMode,
  onMetadataModeChange,
  metadataDraft,
  onMetadataDraftChange,
  metadataText,
  onMetadataTextChange,
  parseError,
  onParseErrorChange,
  onValidationChange,
  hasWriteScope
}: SchemaAwareMetadataEditorProps) {
  const schema = schemaState.schema;
  const schemaReady = schemaState.status === 'ready' && !!schema;
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});

  useEffect(() => {
    if (!schemaReady) {
      setFieldErrors({});
      onValidationChange({});
      return;
    }
    const errors: FieldErrorMap = {};
    for (const field of schema.fields) {
      const value = getValueAtPath(metadataDraft, splitPath(field.path));
      const message = validateFieldValue(field, value);
      if (message) {
        errors[field.path] = message;
      }
    }
    setFieldErrors(errors);
    onValidationChange(errors);
  }, [metadataDraft, onValidationChange, schema, schemaReady]);

  const enumFields = useMemo(() => {
    if (!schemaReady) {
      return new Map<string, EnumOption[]>();
    }
    const entries = schema.fields
      .map((field) => [field.path, inferEnumOptions(field)] as const)
      .filter(([, options]) => options && options.length > 0) as Array<readonly [string, EnumOption[]]>;
    return new Map(entries);
  }, [schema, schemaReady]);

  const deprecatedFields = useMemo(() => {
    if (!schemaReady) {
      return new Set<string>();
    }
    return new Set(schema.fields.filter((field) => isFieldDeprecated(field)).map((field) => field.path));
  }, [schema, schemaReady]);

  const schemaFieldPaths = useMemo(() => {
    if (!schemaReady) {
      return new Set<string>();
    }
    return new Set(schema.fields.map((field) => field.path));
  }, [schema, schemaReady]);

  const unknownFields = useMemo(() => {
    if (!schemaReady) {
      return [] as string[];
    }
    const metadataPaths = new Set(collectMetadataPaths(metadataDraft));
    const unknown = [] as string[];
    for (const path of metadataPaths) {
      if (!schemaFieldPaths.has(path)) {
        unknown.push(path);
      }
    }
    return unknown.sort();
  }, [metadataDraft, schemaFieldPaths, schemaReady]);

  const handleValidationUpdate = useCallback(
    (path: string, message: string | null) => {
      setFieldErrors((current) => {
        if (!message) {
          if (!(path in current)) {
            return current;
          }
          const next = { ...current };
          delete next[path];
          onValidationChange(next);
          return next;
        }
        const next = { ...current, [path]: message };
        onValidationChange(next);
        return next;
      });
    },
    [onValidationChange]
  );

  const applyFieldUpdate = useCallback(
    (field: MetastoreSchemaFieldDefinition, nextValue: unknown) => {
      const updated = setValueAtPath(metadataDraft, splitPath(field.path), nextValue);
      onMetadataDraftChange(updated);
      if (metadataMode === 'schema') {
        onMetadataTextChange(stringifyMetadata(updated));
      }

      const message = validateFieldValue(field, nextValue);
      handleValidationUpdate(field.path, message);
    },
    [handleValidationUpdate, metadataDraft, metadataMode, onMetadataDraftChange, onMetadataTextChange]
  );

  const handleModeSwitch = useCallback(
    (mode: MetadataEditorMode) => {
      if (mode === metadataMode) {
        return;
      }
      if (mode === 'schema') {
        if (!schemaReady) {
          return;
        }
        try {
          const parsed = parseMetadataInput(metadataText);
          onMetadataDraftChange(parsed);
          onMetadataModeChange('schema');
          onParseErrorChange(null);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Invalid metadata JSON';
          onParseErrorChange(message);
        }
        return;
      }

      onMetadataTextChange(stringifyMetadata(metadataDraft));
      onMetadataModeChange('json');
      onParseErrorChange(null);
    },
    [metadataDraft, metadataMode, metadataText, onMetadataDraftChange, onMetadataModeChange, onMetadataTextChange, onParseErrorChange, schemaReady]
  );

  const handleScalarInputChange = useCallback(
    (field: MetastoreSchemaFieldDefinition, rawValue: string) => {
      const { value, error } = coerceScalarValue(field, rawValue);
      if (error) {
        handleValidationUpdate(field.path, error);
        return;
      }
      applyFieldUpdate(field, value);
    },
    [applyFieldUpdate, handleValidationUpdate]
  );

  const handleNumberBlur = useCallback(
    (field: MetastoreSchemaFieldDefinition, rawValue: string) => {
      const { value, error } = coerceScalarValue(field, rawValue);
      handleValidationUpdate(field.path, error);
      if (!error) {
        applyFieldUpdate(field, value);
      }
    },
    [applyFieldUpdate, handleValidationUpdate]
  );

  const handleBooleanChange = useCallback(
    (field: MetastoreSchemaFieldDefinition, checked: boolean) => {
      applyFieldUpdate(field, checked);
    },
    [applyFieldUpdate]
  );

  const handleEnumChange = useCallback(
    (field: MetastoreSchemaFieldDefinition, rawValue: string) => {
      const { value, error } = coerceScalarValue(field, rawValue);
      if (error) {
        handleValidationUpdate(field.path, error);
        return;
      }
      applyFieldUpdate(field, value);
    },
    [applyFieldUpdate, handleValidationUpdate]
  );

  const handleRepeatedChange = useCallback(
    (field: MetastoreSchemaFieldDefinition, index: number, rawValue: string) => {
      const baseValue = getValueAtPath(metadataDraft, splitPath(field.path));
      const currentValues = Array.isArray(baseValue) ? [...baseValue] : [];
      const { value, error } = coerceScalarValue({ ...field, repeated: false }, rawValue);
      if (error) {
        handleValidationUpdate(field.path, error);
        return;
      }
      if (value === undefined) {
        currentValues.splice(index, 1);
      } else {
        currentValues[index] = value;
      }
      const sanitized = currentValues.filter((entry) => entry !== undefined && entry !== null && entry !== '');
      applyFieldUpdate(field, sanitized.length > 0 ? sanitized : undefined);
    },
    [applyFieldUpdate, handleValidationUpdate, metadataDraft]
  );

  const addRepeatedEntry = useCallback(
    (field: MetastoreSchemaFieldDefinition) => {
      const baseValue = getValueAtPath(metadataDraft, splitPath(field.path));
      const currentValues = Array.isArray(baseValue) ? [...baseValue] : [];
      const baseType = normalizeFieldType(field);
      if (baseType === 'boolean') {
        currentValues.push(false);
      } else if (baseType === 'number' || baseType === 'integer' || baseType === 'float' || baseType === 'double' || baseType === 'decimal') {
        currentValues.push(0);
      } else {
        currentValues.push('');
      }
      applyFieldUpdate(field, currentValues);
    },
    [applyFieldUpdate, metadataDraft]
  );

  const clearFieldValue = useCallback(
    (field: MetastoreSchemaFieldDefinition) => {
      applyFieldUpdate(field, undefined);
    },
    [applyFieldUpdate]
  );

  const groupedFields = useMemo(() => groupFields(schemaReady ? schema : null), [schema, schemaReady]);

  const renderField = useCallback(
    (field: MetastoreSchemaFieldDefinition) => {
      const pathSegments = splitPath(field.path);
      const value = getValueAtPath(metadataDraft, pathSegments);
      const error = fieldErrors[field.path] ?? null;
      const enumOptions = enumFields.get(field.path) ?? null;
      const deprecated = deprecatedFields.has(field.path);

      const labelPieces = [field.path.split('.').pop() ?? field.path];
      if (field.required) {
        labelPieces.push('• required');
      }
      if (deprecated) {
        labelPieces.push('• deprecated');
      }

      const rawDescription = field.description ?? field.metadata?.['description'];
      const description = typeof rawDescription === 'string' ? rawDescription : undefined;

      if (field.repeated) {
        const entries = Array.isArray(value) ? (value as unknown[]) : [];
        return (
          <FormField
            key={field.path}
            label={labelPieces.join(' ')}
            hint={description}
            className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60"
          >
            <div className="flex flex-col gap-3">
              {entries.length === 0 && <p className="text-xs text-slate-500 dark:text-slate-400">No values defined.</p>}
              {entries.map((entry, index) => (
                <div key={`${field.path}-${index}`} className="flex items-center gap-2">
                  <input
                    type="text"
                    disabled={!hasWriteScope}
                    value={toDisplayValue(field, entry)}
                    onChange={(event) => handleRepeatedChange(field, index, event.target.value)}
                    className="flex-1 rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => handleRepeatedChange(field, index, '')}
                    disabled={!hasWriteScope}
                    className="rounded-full border border-rose-400 px-3 py-1 text-xs font-semibold text-rose-500 transition-colors hover:bg-rose-400/10 disabled:opacity-40 dark:border-rose-500/70 dark:text-rose-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => addRepeatedEntry(field)}
                  disabled={!hasWriteScope}
                  className="rounded-full border border-violet-500 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 disabled:opacity-40 dark:border-violet-400 dark:text-violet-300"
                >
                  Add value
                </button>
                {error && <span className="text-xs text-rose-500 dark:text-rose-300">{error}</span>}
              </div>
            </div>
          </FormField>
        );
      }

      const label = labelPieces.join(' ');
      const inputId = `schema-field-${field.path.replace(/[^a-z0-9]/gi, '-')}`;

      if (enumOptions && enumOptions.length > 0) {
        return (
          <FormField
            key={field.path}
            label={label}
            hint={description}
            htmlFor={inputId}
            className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60"
          >
            <select
              id={inputId}
              disabled={!hasWriteScope}
              value={toDisplayValue(field, value)}
              onChange={(event) => handleEnumChange(field, event.target.value)}
              className="rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            >
              {!field.required && <option value="">—</option>}
              {enumOptions.map((option) => (
                <option key={String(option)} value={String(option)}>
                  {String(option)}
                </option>
              ))}
            </select>
            {error && <span className="text-xs text-rose-500 dark:text-rose-300">{error}</span>}
          </FormField>
        );
      }

      const fieldType = normalizeFieldType(field);
      const baseInputProps = {
        id: inputId,
        disabled: !hasWriteScope,
        className:
          'rounded-full border border-slate-300/70 bg-white/80 px-3 py-2 text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100'
      } as const;

      if (fieldType === 'boolean') {
        const boolValue = typeof value === 'boolean' ? value : false;
        return (
          <FormField
            key={field.path}
            label={label}
            hint={description}
            className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60"
          >
            <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200" htmlFor={inputId}>
              <input
                id={inputId}
                type="checkbox"
                checked={boolValue}
                onChange={(event) => handleBooleanChange(field, event.target.checked)}
                disabled={!hasWriteScope}
                className="h-4 w-4 rounded border border-slate-300/70 text-violet-600 focus:ring-violet-500 dark:border-slate-700/70"
              />
              <span>{boolValue ? 'Enabled' : 'Disabled'}</span>
            </label>
            {error && <span className="text-xs text-rose-500 dark:text-rose-300">{error}</span>}
          </FormField>
        );
      }

      if (fieldType === 'number' || fieldType === 'integer' || fieldType === 'double' || fieldType === 'float' || fieldType === 'decimal') {
        return (
          <FormField key={field.path} label={label} hint={description} htmlFor={inputId} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
            <input
              {...baseInputProps}
              type="number"
              value={typeof value === 'number' ? value : ''}
              onChange={(event) => handleNumberBlur(field, event.target.value)}
              onBlur={(event) => handleNumberBlur(field, event.target.value)}
            />
            <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={() => clearFieldValue(field)}
                disabled={!hasWriteScope}
                className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:opacity-40 dark:border-slate-600/70 dark:text-slate-300"
              >
                Clear
              </button>
              {error && <span className="text-rose-500 dark:text-rose-300">{error}</span>}
            </div>
          </FormField>
        );
      }

      return (
        <FormField key={field.path} label={label} hint={description} htmlFor={inputId} className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
          <input
            {...baseInputProps}
            type="text"
            value={toDisplayValue(field, value)}
            onChange={(event) => handleScalarInputChange(field, event.target.value)}
          />
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={() => clearFieldValue(field)}
              disabled={!hasWriteScope}
              className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:opacity-40 dark:border-slate-600/70 dark:text-slate-300"
            >
              Clear
            </button>
            {error && <span className="text-rose-500 dark:text-rose-300">{error}</span>}
          </div>
        </FormField>
      );
    },
    [addRepeatedEntry, clearFieldValue, enumFields, handleBooleanChange, handleEnumChange, handleNumberBlur, handleRepeatedChange, handleScalarInputChange, hasWriteScope, metadataDraft, deprecatedFields, fieldErrors]
  );

  const schemaMetadata = schema?.metadata ?? {};
  const docsUrl = typeof schemaMetadata['docsUrl'] === 'string' ? (schemaMetadata['docsUrl'] as string) : null;

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
          <button
            type="button"
            onClick={() => handleModeSwitch('schema')}
            disabled={!schemaReady}
            className={`rounded-full px-3 py-1 transition-colors ${
              metadataMode === 'schema'
                ? 'bg-violet-600 text-white shadow'
                : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/60 disabled:opacity-40 dark:border-slate-600/70 dark:text-slate-300'
            }`}
          >
            Structured form
          </button>
          <button
            type="button"
            onClick={() => handleModeSwitch('json')}
            className={`rounded-full px-3 py-1 transition-colors ${
              metadataMode === 'json'
                ? 'bg-violet-600 text-white shadow'
                : 'border border-slate-300/70 text-slate-600 hover:bg-slate-200/60 dark:border-slate-600/70 dark:text-slate-300'
            }`}
          >
            Raw JSON
          </button>
        </div>
        {schemaHash && (
          <span className="rounded-full border border-slate-300/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-500 dark:border-slate-700/60 dark:text-slate-300">
            Schema {schemaHash}
          </span>
        )}
      </header>

      {schemaState.status === 'loading' && (
        <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 dark:border-slate-700/70 dark:bg-slate-900/70">
          <div className="flex items-center justify-center py-10">
            <Spinner label="Loading schema" />
          </div>
        </div>
      )}

      {schemaState.status === 'error' && (
        <div className="rounded-3xl border border-rose-300/70 bg-rose-50/80 p-4 text-sm text-rose-600 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
          {schemaState.error}
        </div>
      )}

      {metadataMode === 'schema' && schemaReady && (
        <div className="flex flex-col gap-4">
          <div className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 dark:border-slate-700/70 dark:bg-slate-900/70">
            <div className="flex flex-col gap-1 text-sm text-slate-600 dark:text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-500 dark:text-violet-300">Schema overview</span>
              <h4 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {schema.name ?? 'Unnamed schema'}
              </h4>
              {schema.description && <p>{schema.description}</p>}
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                {schema.version && <span>v{schema.version}</span>}
                <span>Updated {formatInstant(schema.updatedAt)}</span>
                {docsUrl && (
                  <a
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-violet-500 px-3 py-1 font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-violet-400 dark:text-violet-300"
                  >
                    Docs
                  </a>
                )}
              </div>
            </div>
          </div>

          {unknownFields.length > 0 && (
            <div className="rounded-3xl border border-amber-400/70 bg-amber-50/80 p-4 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold uppercase tracking-[0.3em]">Unknown fields preserved</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unknownFields.map((path) => (
                  <span key={path} className="rounded-full border border-amber-400 px-2 py-1 font-medium">
                    {path}
                  </span>
                ))}
              </div>
            </div>
          )}

          {Array.from(groupedFields.entries()).map(([groupKey, fields]) => (
            <section key={groupKey} className="flex flex-col gap-3">
              <h5 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
                {renderGroupLabel(groupKey)}
              </h5>
              <div className="grid gap-3 lg:grid-cols-2">
                {fields.map((field) => (
                  <Fragment key={field.path}>{renderField(field)}</Fragment>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {(metadataMode === 'json' || !schemaReady) && (
        <div className="flex flex-col gap-3">
          {schemaState.status === 'missing' && schemaState.missingMessage && (
            <div className="rounded-3xl border border-amber-400/70 bg-amber-50/80 p-4 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
              {schemaState.missingMessage}
            </div>
          )}
          <label className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
            <span className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Metadata JSON</span>
            <textarea
              value={metadataText}
              onChange={(event) => {
                const value = event.target.value;
                onMetadataTextChange(value);
                try {
                  const parsed = parseMetadataInput(value);
                  onParseErrorChange(null);
                  onMetadataDraftChange(parsed);
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Invalid metadata JSON';
                  onParseErrorChange(message);
                }
              }}
              rows={metadataMode === 'json' ? 14 : 8}
              className="w-full rounded-2xl border border-slate-300/70 bg-white/80 px-3 py-2 font-mono text-sm text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/70 dark:bg-slate-900/80 dark:text-slate-100"
            />
          </label>
          {parseError && <span className="text-xs text-rose-500 dark:text-rose-300">{parseError}</span>}
          {schemaReady && unknownFields.length > 0 && (
            <div className="rounded-3xl border border-amber-400/70 bg-amber-50/80 p-4 text-xs text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="font-semibold uppercase tracking-[0.3em]">Unknown fields</p>
              <p className="mt-1">These properties are not described in the schema but will be saved as-is:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unknownFields.map((path) => (
                  <span key={path} className="rounded-full border border-amber-400 px-2 py-1 font-medium">
                    {path}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
