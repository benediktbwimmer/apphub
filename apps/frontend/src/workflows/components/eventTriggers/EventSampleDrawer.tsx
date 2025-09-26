import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../../components/Modal';
import { Spinner } from '../../../components/Spinner';
import type { WorkflowEventSample, WorkflowEventTrigger } from '../../types';
import type { WorkflowEventSampleQuery, WorkflowEventTriggerPredicateInput } from '../../api';
import { JSONPath } from 'jsonpath-plus';
import { Liquid } from 'liquidjs';
import type { EventTriggerPreviewSnapshot } from './EventTriggerFormModal';

type EventSampleDrawerProps = {
  open: boolean;
  loading: boolean;
  error: string | null;
  samples: WorkflowEventSample[];
  query: WorkflowEventSampleQuery | null;
  trigger?: WorkflowEventTrigger | null;
  previewSnapshot?: EventTriggerPreviewSnapshot | null;
  onClose: () => void;
  onLoad: (query: WorkflowEventSampleQuery) => void;
  onRefresh: () => void;
};

type PredicateEvaluation = {
  path: string;
  operator: WorkflowEventTriggerPredicateInput['operator'];
  matched: boolean;
  detail?: string | null;
};

type EvaluationResult = {
  predicateResults: PredicateEvaluation[];
  parameterPreview?: unknown;
  parameterError?: string | null;
};

type EvaluationSource = {
  id: string;
  name?: string | null;
  description?: string | null;
  eventType: string;
  eventSource?: string | null;
  status: 'active' | 'disabled';
  predicates: WorkflowEventTriggerPredicateInput[];
  parameterTemplate?: unknown;
};

function toEvaluationSource(
  trigger?: WorkflowEventTrigger | null,
  preview?: EventTriggerPreviewSnapshot | null
): EvaluationSource | null {
  if (preview) {
    return {
      id: preview.triggerId ?? 'preview',
      name: preview.name ?? null,
      description: preview.description ?? null,
      eventType: preview.eventType,
      eventSource: preview.eventSource ?? null,
      status: preview.status,
      predicates: preview.predicates ?? [],
      parameterTemplate: preview.parameterTemplate ?? null
    } satisfies EvaluationSource;
  }
  if (!trigger) {
    return null;
  }
  return {
    id: trigger.id,
    name: trigger.name,
    description: trigger.description,
    eventType: trigger.eventType,
    eventSource: trigger.eventSource,
    status: trigger.status,
    predicates: trigger.predicates,
    parameterTemplate: trigger.parameterTemplate ?? null
  } satisfies EvaluationSource;
}

function ensurePredicateInputs(
  predicates: Array<WorkflowEventTriggerPredicateInput | WorkflowEventTrigger['predicates'][number]>
): WorkflowEventTriggerPredicateInput[] {
  return predicates.map((predicate) => {
    if ('type' in predicate) {
      const typed = predicate;
      if (typed.operator === 'exists') {
        return {
          path: typed.path,
          operator: 'exists',
          caseSensitive: typed.caseSensitive || undefined
        } satisfies WorkflowEventTriggerPredicateInput;
      }
      if (typed.operator === 'equals' || typed.operator === 'notEquals') {
        return {
          path: typed.path,
          operator: typed.operator,
          value: typed.value,
          caseSensitive: typed.caseSensitive || undefined
        } satisfies WorkflowEventTriggerPredicateInput;
      }
      const values = 'values' in typed && Array.isArray(typed.values) ? typed.values : [];
      return {
        path: typed.path,
        operator: typed.operator,
        values,
        caseSensitive: typed.caseSensitive || undefined
      } satisfies WorkflowEventTriggerPredicateInput;
    }
    return predicate;
  });
}

function evaluatePredicate(
  predicate: WorkflowEventTriggerPredicateInput,
  sample: WorkflowEventSample
): PredicateEvaluation {
  const envelope = {
    id: sample.id,
    type: sample.type,
    source: sample.source,
    payload: sample.payload,
    occurredAt: sample.occurredAt,
    receivedAt: sample.receivedAt,
    correlationId: sample.correlationId,
    metadata: sample.metadata ?? null
  };
  const results = JSONPath({ path: predicate.path, json: envelope, wrap: true }) as unknown[];
  const caseSensitive = predicate.caseSensitive ?? false;
  switch (predicate.operator) {
    case 'exists':
      return { path: predicate.path, operator: 'exists', matched: results.length > 0 };
    case 'equals':
    case 'notEquals': {
      const value = predicate.value;
      const match = results.some((entry) =>
        compareJson(entry, value, caseSensitive)
      );
      const matched = predicate.operator === 'equals' ? match : !match;
      return {
        path: predicate.path,
        operator: predicate.operator,
        matched,
        detail: JSON.stringify(value)
      };
    }
    case 'in':
    case 'notIn': {
      const list = predicate.values ?? [];
      const match = results.some((entry) =>
        list.some((candidate) => compareJson(entry, candidate, caseSensitive))
      );
      const matched = predicate.operator === 'in' ? match : !match;
      return {
        path: predicate.path,
        operator: predicate.operator,
        matched,
        detail: list.length > 0 ? `${list.length} values` : '[]'
      };
    }
    default:
      return {
        path: predicate.path,
        operator: predicate.operator,
        matched: false
      };
  }
}

function compareJson(left: unknown, right: unknown, caseSensitive: boolean): boolean {
  if (!caseSensitive && typeof left === 'string' && typeof right === 'string') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

async function renderJsonTemplate(
  engine: Liquid,
  template: unknown,
  context: Record<string, unknown>
): Promise<unknown> {
  if (template === null || template === undefined) {
    return null;
  }
  if (typeof template === 'string') {
    if (!template.includes('{{') && !template.includes('{%')) {
      return template;
    }
    return engine.parseAndRender(template, context);
  }
  if (Array.isArray(template)) {
    const result: unknown[] = [];
    for (const entry of template) {
      result.push(await renderJsonTemplate(engine, entry, context));
    }
    return result;
  }
  if (typeof template === 'object') {
    const entries = Object.entries(template as Record<string, unknown>);
    const output: Record<string, unknown> = {};
    for (const [key, value] of entries) {
      output[key] = await renderJsonTemplate(engine, value, context);
    }
    return output;
  }
  return template;
}

function buildEventContext(sample: WorkflowEventSample) {
  return {
    id: sample.id,
    type: sample.type,
    source: sample.source,
    payload: sample.payload,
    occurredAt: sample.occurredAt,
    receivedAt: sample.receivedAt,
    correlationId: sample.correlationId,
    metadata: sample.metadata ?? null,
    ttlMs: sample.ttlMs ?? null
  } satisfies Record<string, unknown>;
}

export default function EventSampleDrawer({
  open,
  loading,
  error,
  samples,
  query,
  trigger,
  previewSnapshot,
  onClose,
  onLoad,
  onRefresh
}: EventSampleDrawerProps) {
  const [limit, setLimit] = useState('25');
  const [typeFilter, setTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const liquid = useMemo(() => new Liquid({ cache: false, strictFilters: false, strictVariables: false }), []);

  const source = useMemo(() => toEvaluationSource(trigger, previewSnapshot), [trigger, previewSnapshot]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (query?.type) {
      setTypeFilter(query.type);
    } else if (source?.eventType) {
      setTypeFilter(source.eventType);
    } else {
      setTypeFilter('');
    }
    if (query?.source) {
      setSourceFilter(query.source);
    } else if (source?.eventSource) {
      setSourceFilter(source.eventSource);
    } else {
      setSourceFilter('');
    }
    if (query?.limit) {
      setLimit(String(query.limit));
    } else {
      setLimit('25');
    }
    if (samples.length > 0) {
      setSelectedEventId(samples[0].id);
    } else {
      setSelectedEventId(null);
    }
  }, [open, query, samples, source]);

  useEffect(() => {
    if (!open) {
      setEvaluation(null);
      setEvaluating(false);
      return;
    }
    const selected = samples.find((sample) => sample.id === selectedEventId);
    if (!selected || !source) {
      setEvaluation(null);
      return;
    }
    const predicates = ensurePredicateInputs(source.predicates ?? []);
    setEvaluating(true);
    let cancelled = false;
    (async () => {
      try {
        const predicateResults = predicates.map((predicate) => evaluatePredicate(predicate, selected));
        let parameterPreview: unknown = undefined;
        let parameterError: string | null = null;
        if (source.parameterTemplate !== undefined && source.parameterTemplate !== null) {
          try {
            const context = {
              event: buildEventContext(selected),
              trigger: {
                id: source.id,
                name: source.name,
                description: source.description,
                eventType: source.eventType,
                eventSource: source.eventSource,
                status: source.status
              },
              now: new Date().toISOString()
            } satisfies Record<string, unknown>;
            parameterPreview = await renderJsonTemplate(liquid, source.parameterTemplate, context);
          } catch (err) {
            parameterError = err instanceof Error ? err.message : 'Failed to render parameter template';
          }
        }
        if (!cancelled) {
          setEvaluation({ predicateResults, parameterPreview, parameterError });
        }
      } catch (err) {
        if (!cancelled) {
          setEvaluation({
            predicateResults: [],
            parameterPreview: undefined,
            parameterError: err instanceof Error ? err.message : 'Failed to evaluate predicates'
          });
        }
      } finally {
        if (!cancelled) {
          setEvaluating(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, samples, selectedEventId, source, liquid]);

  const selectedSample = samples.find((sample) => sample.id === selectedEventId) ?? null;

  const handleLoad = () => {
    const nextLimit = Number(limit);
    const queryPayload: WorkflowEventSampleQuery = {};
    if (typeFilter.trim()) {
      queryPayload.type = typeFilter.trim();
    }
    if (sourceFilter.trim()) {
      queryPayload.source = sourceFilter.trim();
    }
    if (Number.isFinite(nextLimit) && nextLimit > 0) {
      queryPayload.limit = Math.floor(nextLimit);
    }
    onLoad(queryPayload);
  };

  return (
    <Modal open={open} onClose={onClose} contentClassName="max-w-6xl">
      <div className="flex h-[80vh] flex-col gap-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Event samples</h2>
            {source ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Filtering for <span className="font-semibold">{source.eventType}</span>
                {source.eventSource ? ` · ${source.eventSource}` : ''}
              </p>
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select a trigger or provide preview details to evaluate events.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRefresh}
              className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Event type
            <input
              type="text"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="mt-1 w-60 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="metastore.record.created"
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Source
            <input
              type="text"
              value={sourceFilter}
              onChange={(event) => setSourceFilter(event.target.value)}
              className="mt-1 w-48 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
              placeholder="services.metastore"
            />
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            Limit
            <input
              type="number"
              min={1}
              max={200}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="mt-1 w-24 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
            />
          </label>
          <button
            type="button"
            onClick={handleLoad}
            className="self-end rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            Load events
          </button>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden">
          <div className="flex w-80 flex-col rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 text-xs font-semibold text-slate-600 dark:border-slate-700/60 dark:text-slate-300">
              <span>Events</span>
              {loading && <Spinner size="xs" />}
            </div>
            <div className="flex-1 overflow-y-auto">
              {error ? (
                <p className="px-4 py-3 text-xs font-semibold text-rose-600 dark:text-rose-300">{error}</p>
              ) : samples.length === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">No events found.</p>
              ) : (
                <ul className="divide-y divide-slate-200/70 dark:divide-slate-800/60">
                  {samples.map((sample) => {
                    const isSelected = sample.id === selectedEventId;
                    return (
                      <li
                        key={sample.id}
                        className={`cursor-pointer px-4 py-3 text-xs transition hover:bg-indigo-50 dark:hover:bg-slate-800 ${isSelected ? 'bg-indigo-50/70 text-indigo-700 dark:bg-slate-800/70 dark:text-indigo-200' : 'text-slate-600 dark:text-slate-300'}`}
                        onClick={() => setSelectedEventId(sample.id)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{sample.type}</span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {new Date(sample.occurredAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">{sample.source}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto rounded-2xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
            {!selectedSample || !source ? (
              <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
                Select a trigger and event to evaluate predicates.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{selectedSample.type}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedSample.source ?? 'unknown'} · {new Date(selectedSample.occurredAt).toLocaleString()}
                    </p>
                  </div>
                  {evaluating && <Spinner size="xs" />}
                </div>

                {evaluation && evaluation.predicateResults.length > 0 && (
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-700/60 dark:bg-slate-900/40">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Predicates</h4>
                    <ul className="mt-2 space-y-2">
                      {evaluation.predicateResults.map((result, index) => (
                        <li key={`${result.path}-${index}`} className="flex items-start justify-between gap-3 text-xs">
                          <div>
                            <p className="font-semibold text-slate-700 dark:text-slate-200">
                              {result.path} {result.operator}
                            </p>
                            {result.detail && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{result.detail}</p>
                            )}
                          </div>
                          <span
                            className={
                              result.matched
                                ? 'rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
                                : 'rounded-full bg-rose-100 px-2 py-1 text-[11px] font-semibold text-rose-600 dark:bg-rose-900/40 dark:text-rose-300'
                            }
                          >
                            {result.matched ? 'matched' : 'no match'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-700/60 dark:bg-slate-900/40">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Payload
                  </h4>
                  <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap break-all text-[11px] text-slate-600 dark:text-slate-300">
                    {JSON.stringify(selectedSample.payload, null, 2)}
                  </pre>
                </div>

                {evaluation?.parameterError ? (
                  <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-500/50 dark:bg-rose-900/40 dark:text-rose-200">
                    {evaluation.parameterError}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-700/60 dark:bg-slate-900/40">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Parameter preview
                    </h4>
                    <pre className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap break-all text-[11px] text-slate-600 dark:text-slate-300">
                      {evaluation?.parameterPreview === undefined
                        ? 'No parameter template defined.'
                        : JSON.stringify(evaluation.parameterPreview, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
