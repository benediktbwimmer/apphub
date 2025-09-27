import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../../../components/Modal';
import { Spinner } from '../../../components/Spinner';
import { useToasts } from '../../../components/toast';
import type {
  WorkflowEventSchema,
  WorkflowEventTrigger,
  WorkflowEventTriggerStatus
} from '../../types';
import {
  ApiError,
  type WorkflowEventSampleQuery,
  type WorkflowEventTriggerCreateInput,
  type WorkflowEventTriggerPredicateInput,
  type WorkflowEventTriggerUpdateInput
} from '../../api';

import EventSchemaExplorer from './EventSchemaExplorer';

export type EventTriggerPreviewSnapshot = {
  triggerId?: string | null;
  name?: string | null;
  description?: string | null;
  eventType: string;
  eventSource?: string | null;
  status: WorkflowEventTriggerStatus;
  predicates: WorkflowEventTriggerPredicateInput[];
  parameterTemplate?: unknown;
  metadata?: unknown;
};

type PredicateFormValue = {
  id: string;
  path: string;
  operator: WorkflowEventTriggerPredicateInput['operator'];
  value: string;
  values: string;
  caseSensitive: boolean;
  flags: string;
};

const VALUE_OPERATORS = new Set<WorkflowEventTriggerPredicateInput['operator']>([
  'equals',
  'notEquals',
  'contains',
  'regex',
  'gt',
  'gte',
  'lt',
  'lte'
]);

const LIST_OPERATORS = new Set<WorkflowEventTriggerPredicateInput['operator']>(['in', 'notIn']);

const NUMERIC_OPERATORS = new Set<WorkflowEventTriggerPredicateInput['operator']>(['gt', 'gte', 'lt', 'lte']);

const REGEX_OPERATORS = new Set<WorkflowEventTriggerPredicateInput['operator']>(['regex']);

const CASE_SENSITIVE_OPERATORS = new Set<WorkflowEventTriggerPredicateInput['operator']>([
  'equals',
  'notEquals',
  'in',
  'notIn',
  'contains',
  'regex'
]);

type FormValues = {
  name: string;
  description: string;
  eventType: string;
  eventSource: string;
  status: WorkflowEventTriggerStatus;
  predicates: PredicateFormValue[];
  parameterTemplate: string;
  metadata: string;
  throttleWindowMs: string;
  throttleCount: string;
  maxConcurrency: string;
  idempotencyKeyExpression: string;
};

type PredicateError = {
  path?: string;
  value?: string;
  values?: string;
  flags?: string;
};

type FormErrors = {
  general?: string;
  name?: string;
  eventType?: string;
  predicates?: PredicateError[];
  parameterTemplate?: string;
  metadata?: string;
  throttleWindowMs?: string;
  throttleCount?: string;
  maxConcurrency?: string;
  idempotencyKeyExpression?: string;
};

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseErrorDetails(
  details: unknown
): { formErrors: string[]; fieldErrors: Record<string, string[]> } | null {
  const record = toRecord(details);
  if (!record) {
    return null;
  }
  const formErrors = Array.isArray(record.formErrors)
    ? record.formErrors.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const rawFieldErrors = toRecord(record.fieldErrors) ?? {};
  const fieldErrors: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(rawFieldErrors)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const messages = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    if (messages.length > 0) {
      fieldErrors[key] = messages;
    }
  }
  return { formErrors, fieldErrors };
}

type EventTriggerFormModalProps = {
  open: boolean;
  mode: 'create' | 'edit';
  workflowSlug: string;
  workflowName: string;
  initialTrigger?: WorkflowEventTrigger | null;
  canEdit: boolean;
  eventSchema: WorkflowEventSchema | null;
  eventSchemaLoading: boolean;
  eventSchemaQuery: WorkflowEventSampleQuery | null;
  onLoadEventSchema: (query: WorkflowEventSampleQuery) => Promise<void>;
  onClose: () => void;
  onCreate: (slug: string, input: WorkflowEventTriggerCreateInput) => Promise<WorkflowEventTrigger>;
  onUpdate: (slug: string, triggerId: string, input: WorkflowEventTriggerUpdateInput) => Promise<WorkflowEventTrigger>;
  onPreview?: (snapshot: EventTriggerPreviewSnapshot) => void;
};

function createPredicateFormValue(): PredicateFormValue {
  return {
    id: `predicate-${Math.random().toString(36).slice(2, 10)}`,
    path: '',
    operator: 'exists',
    value: '',
    values: '',
    caseSensitive: false,
    flags: ''
  };
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function mapTriggerToForm(trigger: WorkflowEventTrigger | null | undefined): FormValues {
  if (!trigger) {
    return {
      name: '',
      description: '',
      eventType: '',
      eventSource: '',
      status: 'active',
      predicates: [],
      parameterTemplate: '',
      metadata: '',
      throttleWindowMs: '',
      throttleCount: '',
      maxConcurrency: '',
      idempotencyKeyExpression: ''
    } satisfies FormValues;
  }

  return {
    name: trigger.name ?? '',
    description: trigger.description ?? '',
    eventType: trigger.eventType,
    eventSource: trigger.eventSource ?? '',
    status: trigger.status,
    predicates: trigger.predicates.map((predicate) => ({
      id: `predicate-${predicate.path}-${Math.random().toString(36).slice(2, 8)}`,
      path: predicate.path,
      operator: predicate.operator,
      value:
        predicate.operator === 'equals' || predicate.operator === 'notEquals'
          ? formatJson(predicate.value)
          : predicate.operator === 'contains'
          ? formatJson(predicate.value)
          : predicate.operator === 'regex'
          ? predicate.value
          : predicate.operator === 'gt' ||
            predicate.operator === 'gte' ||
            predicate.operator === 'lt' ||
            predicate.operator === 'lte'
          ? String(predicate.value)
          : '',
      values:
        predicate.operator === 'in' || predicate.operator === 'notIn'
          ? formatJson(predicate.values)
          : '',
      caseSensitive:
        'caseSensitive' in predicate && predicate.caseSensitive !== undefined
          ? predicate.caseSensitive
          : false,
      flags: predicate.operator === 'regex' ? predicate.flags ?? '' : ''
    })),
    parameterTemplate: formatJson(trigger.parameterTemplate ?? null),
    metadata: formatJson(trigger.metadata ?? null),
    throttleWindowMs: trigger.throttleWindowMs ? String(trigger.throttleWindowMs) : '',
    throttleCount: trigger.throttleCount ? String(trigger.throttleCount) : '',
    maxConcurrency: trigger.maxConcurrency ? String(trigger.maxConcurrency) : '',
    idempotencyKeyExpression: trigger.idempotencyKeyExpression ?? ''
  } satisfies FormValues;
}

function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parseValues(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return trimmed
      .split(/\r?\n|,/)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }
}

const ALLOWED_REGEX_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y']);
const MAX_REGEX_PATTERN_LENGTH = 512;

function normalizeRegexFlagsInput(raw: string, caseSensitive: boolean): {
  normalized: string;
  error?: string;
} {
  const trimmed = raw.trim();
  const seen: string[] = [];
  for (const char of trimmed) {
    if (!ALLOWED_REGEX_FLAGS.has(char)) {
      return { normalized: '', error: 'Flags may only include g, i, m, s, u, or y.' };
    }
    if (!seen.includes(char)) {
      seen.push(char);
    }
  }

  if (caseSensitive && seen.includes('i')) {
    return { normalized: '', error: 'Remove the i flag when case sensitivity is enabled.' };
  }

  if (!caseSensitive && !seen.includes('i')) {
    seen.push('i');
  }

  if (caseSensitive) {
    const index = seen.indexOf('i');
    if (index >= 0) {
      seen.splice(index, 1);
    }
  }

  seen.sort();
  return { normalized: seen.join('') };
}

export default function EventTriggerFormModal({
  open,
  mode,
  workflowSlug,
  workflowName,
  initialTrigger,
  canEdit,
  eventSchema,
  eventSchemaLoading,
  eventSchemaQuery,
  onLoadEventSchema,
  onClose,
  onCreate,
  onUpdate,
  onPreview
}: EventTriggerFormModalProps) {
  const [values, setValues] = useState<FormValues>(() => mapTriggerToForm(initialTrigger));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const { pushToast } = useToasts();
  const parameterTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const [schemaExplorerOpen, setSchemaExplorerOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues(mapTriggerToForm(initialTrigger));
    setErrors({});
    setSubmitting(false);
  }, [open, initialTrigger]);

  useEffect(() => {
    if (!open) {
      setSchemaExplorerOpen(false);
    }
  }, [open]);

  const isEdit = mode === 'edit';

  const buildSchemaQuery = (): WorkflowEventSampleQuery | null => {
    const type = values.eventType.trim();
    if (!type) {
      return null;
    }
    const query: WorkflowEventSampleQuery = {
      type,
      limit: eventSchemaQuery?.limit ?? 50
    };
    const sourceValue = values.eventSource.trim();
    if (sourceValue) {
      query.source = sourceValue;
    }
    return query;
  };

  const schemaQueryMatches = (current: WorkflowEventSampleQuery | null, desired: WorkflowEventSampleQuery): boolean => {
    if (!current) {
      return false;
    }
    const currentType = (current.type ?? '').trim();
    const desiredType = (desired.type ?? '').trim();
    if (currentType !== desiredType) {
      return false;
    }
    const currentSource = (current.source ?? '').trim();
    const desiredSource = (desired.source ?? '').trim();
    if (currentSource !== desiredSource) {
      return false;
    }
    return true;
  };

  const handleToggleSchemaExplorer = async () => {
    if (schemaExplorerOpen) {
      setSchemaExplorerOpen(false);
      return;
    }
    const query = buildSchemaQuery();
    if (!query) {
      setErrors((current) => ({ ...current, eventType: 'Set an event type to explore schema.' }));
      pushToast({
        tone: 'error',
        title: 'Event type required',
        description: 'Enter an event type before opening the schema explorer.'
      });
      return;
    }
    setErrors((current) => ({ ...current, eventType: undefined }));
    setSchemaExplorerOpen(true);
    if (!schemaQueryMatches(eventSchemaQuery, query)) {
      try {
        await onLoadEventSchema(query);
      } catch {
        // Errors are surfaced by the loader hook.
      }
    }
  };

  const handleAddPredicateFromSchema = ({
    path,
    operator,
    value
  }: {
    path: string;
    operator: 'exists' | 'equals';
    value?: unknown;
  }) => {
    if (disableActions) {
      pushToast({
        tone: 'error',
        title: 'Editing disabled',
        description: 'You do not have permission to modify this trigger.'
      });
      return;
    }
    setValues((current) => {
      const next = createPredicateFormValue();
      next.path = path;
      next.operator = operator;
      next.caseSensitive = false;
      next.values = '';
      next.flags = '';
      if (operator === 'equals') {
        let rendered = '';
        try {
          rendered = JSON.stringify(value, null, 2);
        } catch {
          rendered = value === undefined ? '' : String(value);
        }
        next.value = rendered;
      } else {
        next.value = '';
      }
      return {
        ...current,
        predicates: [...current.predicates, next]
      };
    });
    setErrors((current) => ({ ...current, predicates: undefined }));
    pushToast({ tone: 'success', title: 'Predicate added', description: path });
  };

  const handleInsertLiquidSnippet = (snippet: string) => {
    if (disableActions) {
      pushToast({
        tone: 'error',
        title: 'Editing disabled',
        description: 'You do not have permission to modify this trigger.'
      });
      return;
    }
    const textarea = parameterTemplateRef.current;
    if (textarea) {
      const { selectionStart, selectionEnd } = textarea;
      setValues((current) => {
        const existing = current.parameterTemplate;
        const before = existing.slice(0, selectionStart);
        const after = existing.slice(selectionEnd);
        const updated = `${before}${snippet}${after}`;
        setTimeout(() => {
          const position = selectionStart + snippet.length;
          textarea.focus();
          textarea.setSelectionRange(position, position);
        }, 0);
        return {
          ...current,
          parameterTemplate: updated
        };
      });
    } else {
      setValues((current) => ({
        ...current,
        parameterTemplate: `${current.parameterTemplate}${snippet}`
      }));
    }
    setErrors((current) => ({ ...current, parameterTemplate: undefined }));
    pushToast({ tone: 'success', title: 'Snippet inserted', description: snippet });
  };

  const handleFieldChange = (field: keyof FormValues, value: string) => {
    setValues((current) => ({
      ...current,
      [field]: value
    }));
  };

  const handlePredicateChange = (
    index: number,
    field: keyof PredicateFormValue,
    value: string | boolean
  ) => {
    setValues((current) => {
      const predicates = [...current.predicates];
      const existing = predicates[index];
      if (!existing) {
        return current;
      }
      if (field === 'operator') {
        const nextOperator = value as PredicateFormValue['operator'];
        predicates[index] = {
          ...existing,
          operator: nextOperator,
          value: '',
          values: '',
          flags: '',
          caseSensitive: CASE_SENSITIVE_OPERATORS.has(nextOperator) ? existing.caseSensitive : false
        } satisfies PredicateFormValue;
      } else if (field === 'caseSensitive') {
        predicates[index] = {
          ...existing,
          caseSensitive: Boolean(value)
        } satisfies PredicateFormValue;
      } else if (field === 'flags') {
        predicates[index] = {
          ...existing,
          flags: String(value)
        } satisfies PredicateFormValue;
      } else {
        predicates[index] = {
          ...existing,
          [field]: typeof value === 'string' ? value : existing[field]
        } as PredicateFormValue;
      }
      return {
        ...current,
        predicates
      };
    });
  };

  const handleAddPredicate = () => {
    setValues((current) => ({
      ...current,
      predicates: [...current.predicates, createPredicateFormValue()]
    }));
  };

  const handleRemovePredicate = (index: number) => {
    setValues((current) => ({
      ...current,
      predicates: current.predicates.filter((_, predicateIndex) => predicateIndex !== index)
    }));
  };

  const buildPayload = () => {
    const nextErrors: FormErrors = {};

    if (!values.eventType.trim()) {
      nextErrors.eventType = 'Event type is required.';
    }

    const predicates: WorkflowEventTriggerPredicateInput[] = [];
    const predicateErrors: PredicateError[] = [];
    values.predicates.forEach((predicate, index) => {
      const predicateError: PredicateError = {};
      const path = predicate.path.trim();
      if (!path) {
        predicateError.path = 'Path is required.';
      }

      let built: WorkflowEventTriggerPredicateInput | null = null;

      switch (predicate.operator) {
        case 'exists': {
          built = { path, operator: 'exists' };
          break;
        }
        case 'equals':
        case 'notEquals': {
          if (!predicate.value.trim()) {
            predicateError.value = 'Value is required.';
            break;
          }
          const parsedValue = parseLiteral(predicate.value);
          built = {
            path,
            operator: predicate.operator,
            value: parsedValue,
            caseSensitive: predicate.caseSensitive
          };
          break;
        }
        case 'in':
        case 'notIn': {
          if (!predicate.values.trim()) {
            predicateError.values = 'Provide a list of values.';
            break;
          }
          const parsedValues = parseValues(predicate.values);
          if (parsedValues.length === 0) {
            predicateError.values = 'Provide at least one value.';
            break;
          }
          built = {
            path,
            operator: predicate.operator,
            values: parsedValues,
            caseSensitive: predicate.caseSensitive
          };
          break;
        }
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte': {
          const rawValue = predicate.value.trim();
          if (!rawValue) {
            predicateError.value = 'Provide a numeric value.';
            break;
          }
          const parsed = Number(rawValue);
          if (!Number.isFinite(parsed)) {
            predicateError.value = 'Value must be a valid number.';
            break;
          }
          built = { path, operator: predicate.operator, value: parsed };
          break;
        }
        case 'contains': {
          if (!predicate.value.trim()) {
            predicateError.value = 'Value is required.';
            break;
          }
          const parsedValue = parseLiteral(predicate.value);
          built = {
            path,
            operator: 'contains',
            value: parsedValue,
            caseSensitive: predicate.caseSensitive
          };
          break;
        }
        case 'regex': {
          const pattern = predicate.value.trim();
          if (!pattern) {
            predicateError.value = 'Pattern is required.';
            break;
          }
          if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
            predicateError.value = `Pattern must be at most ${MAX_REGEX_PATTERN_LENGTH} characters.`;
            break;
          }
          const { normalized, error } = normalizeRegexFlagsInput(predicate.flags, predicate.caseSensitive);
          if (error) {
            predicateError.flags = error;
            break;
          }
          try {
            void new RegExp(pattern, normalized || undefined);
          } catch (error_) {
            predicateError.value = `Invalid regex: ${(error_ as Error).message}`;
            break;
          }
          built = {
            path,
            operator: 'regex',
            value: pattern,
            caseSensitive: predicate.caseSensitive,
            ...(normalized ? { flags: normalized } : {})
          };
          break;
        }
        default:
          break;
      }

      predicateErrors[index] = predicateError;

      if (predicateError.path || predicateError.value || predicateError.values || predicateError.flags) {
        return;
      }

      if (!built) {
        return;
      }

      if ('caseSensitive' in built && !CASE_SENSITIVE_OPERATORS.has(built.operator)) {
        delete (built as { caseSensitive?: boolean }).caseSensitive;
      }

      predicates.push(built);
    });

    if (predicateErrors.some((entry) => entry && (entry.path || entry.value || entry.values || entry.flags))) {
      nextErrors.predicates = predicateErrors;
    }

    let parameterTemplate: unknown = null;
    if (values.parameterTemplate.trim()) {
      try {
        parameterTemplate = JSON.parse(values.parameterTemplate);
      } catch {
        nextErrors.parameterTemplate = 'Parameter template must be valid JSON.';
      }
    }

    let metadata: unknown = null;
    if (values.metadata.trim()) {
      try {
        metadata = JSON.parse(values.metadata);
      } catch {
        nextErrors.metadata = 'Metadata must be valid JSON.';
      }
    }

    let throttleWindowMs: number | null = null;
    let throttleCount: number | null = null;
    if (values.throttleWindowMs.trim() || values.throttleCount.trim()) {
      const windowValue = Number(values.throttleWindowMs.trim() || '0');
      const countValue = Number(values.throttleCount.trim() || '0');
      if (!Number.isFinite(windowValue) || windowValue <= 0) {
        nextErrors.throttleWindowMs = 'Throttle window must be a positive number of milliseconds.';
      }
      if (!Number.isFinite(countValue) || countValue <= 0) {
        nextErrors.throttleCount = 'Throttle count must be a positive integer.';
      }
      if (!nextErrors.throttleWindowMs && !nextErrors.throttleCount) {
        throttleWindowMs = Math.floor(windowValue);
        throttleCount = Math.floor(countValue);
      }
    }

    let maxConcurrency: number | null = null;
    if (values.maxConcurrency.trim()) {
      const parsed = Number(values.maxConcurrency.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        nextErrors.maxConcurrency = 'Max concurrency must be a positive integer.';
      } else {
        maxConcurrency = Math.floor(parsed);
      }
    }

    const hasErrors =
      nextErrors.general ||
      nextErrors.eventType ||
      nextErrors.parameterTemplate ||
      nextErrors.metadata ||
      nextErrors.throttleWindowMs ||
      nextErrors.throttleCount ||
      nextErrors.maxConcurrency ||
      (nextErrors.predicates &&
        nextErrors.predicates.some((entry) => entry && (entry.path || entry.value || entry.values || entry.flags)));

    if (hasErrors) {
      setErrors(nextErrors);
      return null;
    }

    const payload: WorkflowEventTriggerCreateInput = {
      name: values.name.trim() || null,
      description: values.description.trim() || null,
      eventType: values.eventType.trim(),
      eventSource: values.eventSource.trim() || null,
      predicates,
      parameterTemplate: parameterTemplate ?? null,
      metadata: metadata ?? null,
      throttleWindowMs,
      throttleCount,
      maxConcurrency,
      idempotencyKeyExpression: values.idempotencyKeyExpression.trim() || null,
      status: values.status
    } satisfies WorkflowEventTriggerCreateInput;

    setErrors({});
    return payload;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canEdit || submitting) {
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && initialTrigger) {
        await onUpdate(workflowSlug, initialTrigger.id, payload as WorkflowEventTriggerUpdateInput);
      } else {
        await onCreate(workflowSlug, payload);
      }
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const parsed = parseErrorDetails(err.details);
        if (parsed) {
          const nextErrors: FormErrors = {};
          if (parsed.formErrors.length > 0) {
            nextErrors.general = parsed.formErrors[0];
          }
          const fieldErrors = parsed.fieldErrors;
          if (fieldErrors.name?.length) {
            nextErrors.name = fieldErrors.name[0];
          }
          if (fieldErrors.eventType?.length) {
            nextErrors.eventType = fieldErrors.eventType[0];
          }
          if (fieldErrors.parameterTemplate?.length) {
            nextErrors.parameterTemplate = fieldErrors.parameterTemplate[0];
          }
          if (fieldErrors.metadata?.length) {
            nextErrors.metadata = fieldErrors.metadata[0];
          }
          if (fieldErrors.throttleWindowMs?.length) {
            nextErrors.throttleWindowMs = fieldErrors.throttleWindowMs[0];
          }
          if (fieldErrors.throttleCount?.length) {
            nextErrors.throttleCount = fieldErrors.throttleCount[0];
          }
          if (fieldErrors.maxConcurrency?.length) {
            nextErrors.maxConcurrency = fieldErrors.maxConcurrency[0];
          }
          if (fieldErrors.idempotencyKeyExpression?.length) {
            nextErrors.idempotencyKeyExpression = fieldErrors.idempotencyKeyExpression[0];
          }
          if (Object.keys(nextErrors).length > 0) {
            setErrors(nextErrors);
            return;
          }
        }
      }
      const message = err instanceof Error ? err.message : 'Failed to save event trigger.';
      setErrors({ general: message });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePreview = () => {
    if (!onPreview) {
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      return;
    }
    onPreview({
      triggerId: initialTrigger?.id ?? null,
      name: payload.name ?? null,
      description: payload.description ?? null,
      eventType: payload.eventType,
      eventSource: payload.eventSource ?? null,
      status: payload.status ?? 'active',
      predicates: payload.predicates ?? [],
      parameterTemplate: payload.parameterTemplate ?? null,
      metadata: payload.metadata ?? null
    });
  };

  const title = isEdit ? 'Edit event trigger' : 'Create event trigger';

  const disableActions = submitting || !canEdit;

  const renderPredicateInput = (predicate: PredicateFormValue, index: number) => {
    const predicateError = errors.predicates?.[index];
    const showValue = VALUE_OPERATORS.has(predicate.operator);
    const showNumericInput = NUMERIC_OPERATORS.has(predicate.operator);
    const showRegexInput = REGEX_OPERATORS.has(predicate.operator);
    const showValueTextarea = showValue && !showNumericInput && !showRegexInput;
    const showValues = LIST_OPERATORS.has(predicate.operator);
    const showCaseSensitive = CASE_SENSITIVE_OPERATORS.has(predicate.operator);
    const showFlags = showRegexInput;
    const valueLabel = predicate.operator === 'regex' ? 'Pattern' : 'Value';
    return (
      <div key={predicate.id} className="rounded-2xl border border-slate-200/70 p-4 dark:border-slate-700/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-col gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              JSONPath
              <input
                type="text"
                value={predicate.path}
                onChange={(event) => handlePredicateChange(index, 'path', event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                placeholder="$.payload.detail.id"
                disabled={disableActions}
              />
            </label>
            {predicateError?.path && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{predicateError.path}</p>
            )}
          </div>
          <div className="flex flex-shrink-0 flex-col">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Operator
              <select
                value={predicate.operator}
                onChange={(event) =>
                  handlePredicateChange(index, 'operator', event.target.value as PredicateFormValue['operator'])
                }
                className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                disabled={disableActions}
              >
                <option value="exists">exists</option>
                <option value="equals">equals</option>
                <option value="notEquals">notEquals</option>
                <option value="contains">contains</option>
                <option value="regex">regex</option>
                <option value="in">in</option>
                <option value="notIn">notIn</option>
                <option value="gt">gt</option>
                <option value="gte">gte</option>
                <option value="lt">lt</option>
                <option value="lte">lte</option>
              </select>
            </label>
          </div>
        </div>
        {showValue && (
          <div className="mt-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              {valueLabel}
              {showValueTextarea && (
                <textarea
                  value={predicate.value}
                  onChange={(event) => handlePredicateChange(index, 'value', event.target.value)}
                  className="mt-1 h-16 w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                  placeholder={
                    predicate.operator === 'contains'
                      ? '"warning" or ["warning"]'
                      : '"pending" or {"status":"pending"}'
                  }
                  disabled={disableActions}
                />
              )}
              {showNumericInput && (
                <input
                  type="number"
                  value={predicate.value}
                  onChange={(event) => handlePredicateChange(index, 'value', event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                  placeholder="Numeric value"
                  disabled={disableActions}
                />
              )}
              {showRegexInput && (
                <input
                  type="text"
                  value={predicate.value}
                  onChange={(event) => handlePredicateChange(index, 'value', event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                  placeholder="^order-(.*)$"
                  disabled={disableActions}
                />
              )}
            </label>
            {predicateError?.value && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{predicateError.value}</p>
            )}
          </div>
        )}
        {showValues && (
          <div className="mt-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Values
              <textarea
                value={predicate.values}
                onChange={(event) => handlePredicateChange(index, 'values', event.target.value)}
                className="mt-1 h-24 w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                placeholder='["critical","warning"] or critical,warning'
                disabled={disableActions}
              />
            </label>
            {predicateError?.values && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{predicateError.values}</p>
            )}
          </div>
        )}
        {showFlags && (
          <div className="mt-3">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Flags
              <input
                type="text"
                value={predicate.flags}
                onChange={(event) => handlePredicateChange(index, 'flags', event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                placeholder="gimsuy"
                disabled={disableActions}
              />
            </label>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Leave blank for defaults. Allowed flags: g, i, m, s, u, y.
            </p>
            {predicateError?.flags && (
              <p className="text-xs font-semibold text-rose-600 dark:text-rose-300">{predicateError.flags}</p>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between">
          {showCaseSensitive ? (
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={predicate.caseSensitive}
                onChange={(event) => handlePredicateChange(index, 'caseSensitive', event.target.checked)}
                disabled={disableActions}
              />
              Case sensitive
            </label>
          ) : (
            <span />
          )}
          <button
            type="button"
            className="text-xs font-semibold text-rose-600 hover:text-rose-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:text-rose-200"
            onClick={() => handleRemovePredicate(index)}
            disabled={disableActions}
          >
            Remove
          </button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={disableActions ? undefined : onClose}
      className="items-start justify-center px-4 py-6 sm:items-center"
      contentClassName="max-w-4xl max-h-[calc(100vh-4rem)] overflow-y-auto sm:max-h-[calc(100vh-6rem)]"
    >
      <form className="flex flex-col gap-4 p-6" onSubmit={handleSubmit}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {workflowName} · {workflowSlug}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Status
              <select
                value={values.status}
                onChange={(event) => handleFieldChange('status', event.target.value)}
                className="ml-2 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-xs text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                disabled={disableActions}
              >
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <button
              type="button"
              className={`rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800`}
              onClick={handlePreview}
              disabled={disableActions || !onPreview}
            >
              Preview with sample
            </button>
            <button
              type="button"
              className={`rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:hover:bg-slate-800 ${schemaExplorerOpen ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-200' : 'text-slate-600 dark:text-slate-200'}`}
              onClick={() => void handleToggleSchemaExplorer()}
              disabled={eventSchemaLoading}
            >
              {eventSchemaLoading ? 'Loading schema…' : schemaExplorerOpen ? 'Hide schema' : 'Schema explorer'}
            </button>
          </div>
        </div>

        {errors.general && (
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-500/50 dark:bg-rose-900/30 dark:text-rose-200">
            {errors.general}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Name
            <input
              type="text"
              value={values.name}
              onChange={(event) => handleFieldChange('name', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="Trigger label (optional)"
              disabled={disableActions}
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Event type
            <input
              type="text"
              value={values.eventType}
              onChange={(event) => handleFieldChange('eventType', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="metastore.record.created"
              disabled={disableActions}
              required
            />
            {errors.eventType && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{errors.eventType}</span>
            )}
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300 lg:col-span-2">
            Description
            <textarea
              value={values.description}
              onChange={(event) => handleFieldChange('description', event.target.value)}
              className="mt-1 h-20 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="Explain what this trigger does"
              disabled={disableActions}
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Event source
            <input
              type="text"
              value={values.eventSource}
              onChange={(event) => handleFieldChange('eventSource', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="services.metastore"
              disabled={disableActions}
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Idempotency key expression
            <input
              type="text"
              value={values.idempotencyKeyExpression}
              onChange={(event) => handleFieldChange('idempotencyKeyExpression', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="{{ event.payload.id }}"
              disabled={disableActions}
            />
            {errors.idempotencyKeyExpression && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                {errors.idempotencyKeyExpression}
              </span>
            )}
          </label>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Predicates</h3>
            <button
              type="button"
              className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={handleAddPredicate}
              disabled={disableActions}
            >
              Add predicate
            </button>
          </div>
          {values.predicates.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-300/70 px-4 py-6 text-xs text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
              No predicates defined. All events of this type will match.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {values.predicates.map((predicate, index) => renderPredicateInput(predicate, index))}
            </div>
          )}
        </div>

        {schemaExplorerOpen && (
          <div className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
            <EventSchemaExplorer
              schema={eventSchema}
              loading={eventSchemaLoading}
              disabled={disableActions}
              onAddPredicate={handleAddPredicateFromSchema}
              onInsertLiquid={handleInsertLiquidSnippet}
            />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Throttle window (ms)
            <input
              type="number"
              min={0}
              value={values.throttleWindowMs}
              onChange={(event) => handleFieldChange('throttleWindowMs', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="60000"
              disabled={disableActions}
            />
            {errors.throttleWindowMs && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                {errors.throttleWindowMs}
              </span>
            )}
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Throttle count
            <input
              type="number"
              min={0}
              value={values.throttleCount}
              onChange={(event) => handleFieldChange('throttleCount', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="5"
              disabled={disableActions}
            />
            {errors.throttleCount && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                {errors.throttleCount}
              </span>
            )}
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Max concurrency
            <input
              type="number"
              min={0}
              value={values.maxConcurrency}
              onChange={(event) => handleFieldChange('maxConcurrency', event.target.value)}
              className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="3"
              disabled={disableActions}
            />
            {errors.maxConcurrency && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                {errors.maxConcurrency}
              </span>
            )}
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Parameter template (JSON)
            <textarea
              ref={parameterTemplateRef}
              value={values.parameterTemplate}
              onChange={(event) => handleFieldChange('parameterTemplate', event.target.value)}
              className="mt-1 h-40 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder='{"dataset":"{{ event.payload.dataset }}"}'
              disabled={disableActions}
            />
            {errors.parameterTemplate && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                {errors.parameterTemplate}
              </span>
            )}
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Metadata (JSON)
            <textarea
              value={values.metadata}
              onChange={(event) => handleFieldChange('metadata', event.target.value)}
              className="mt-1 h-40 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder='{"owner":"workflow-team"}'
              disabled={disableActions}
            />
            {errors.metadata && (
              <span className="mt-1 text-xs font-semibold text-rose-600 dark:text-rose-300">{errors.metadata}</span>
            )}
          </label>
        </div>

        <div className="mt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            className="rounded-full border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={disableActions}
          >
            {submitting ? (
              <>
                <Spinner size="xs" /> Saving
              </>
            ) : isEdit ? (
              'Save changes'
            ) : (
              'Create trigger'
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
