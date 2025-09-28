import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollableListContainer, Spinner } from '../../../components';
import type {
  WorkflowDefinition,
  WorkflowEventSample,
  WorkflowEventSchema,
  WorkflowEventSchedulerHealth,
  WorkflowEventTrigger,
  WorkflowTriggerDelivery,
  RetryBacklogSummary
} from '../../types';
import type {
  WorkflowEventSampleQuery,
  WorkflowEventTriggerCreateInput,
  WorkflowEventTriggerUpdateInput,
  WorkflowTriggerDeliveriesQuery
} from '../../api';
import EventTriggerFormModal, { type EventTriggerPreviewSnapshot } from './EventTriggerFormModal';
import EventSampleDrawer from './EventSampleDrawer';

const RETRY_PAGE_SIZE = 25;

function formatDate(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

type EventTriggersPanelProps = {
  workflow: WorkflowDefinition | null;
  triggers: WorkflowEventTrigger[];
  triggersLoading: boolean;
  triggersError: string | null;
  selectedTrigger: WorkflowEventTrigger | null;
  onSelectTrigger: (triggerId: string | null) => void;
  createTrigger: (slug: string, input: WorkflowEventTriggerCreateInput) => Promise<WorkflowEventTrigger>;
  updateTrigger: (slug: string, triggerId: string, input: WorkflowEventTriggerUpdateInput) => Promise<WorkflowEventTrigger>;
  deleteTrigger: (slug: string, triggerId: string) => Promise<void>;
  deliveries: WorkflowTriggerDelivery[];
  deliveriesLoading: boolean;
  deliveriesError: string | null;
  deliveriesLimit: number;
  deliveriesQuery: WorkflowTriggerDeliveriesQuery;
  onReloadDeliveries: (query: WorkflowTriggerDeliveriesQuery) => void;
  eventHealth: WorkflowEventSchedulerHealth | null;
  eventHealthLoading: boolean;
  eventHealthError: string | null;
  onRefreshEventHealth: () => void;
  eventSamples: WorkflowEventSample[];
  eventSchema: WorkflowEventSchema | null;
  eventSamplesLoading: boolean;
  eventSamplesError: string | null;
  eventSamplesQuery: WorkflowEventSampleQuery | null;
  loadEventSamples: (query: WorkflowEventSampleQuery) => Promise<void>;
  refreshEventSamples: () => void;
  canEdit: boolean;
  onCancelEventRetry: (eventId: string) => Promise<void>;
  onForceEventRetry: (eventId: string) => Promise<void>;
  onCancelTriggerRetry: (deliveryId: string) => Promise<void>;
  onForceTriggerRetry: (deliveryId: string) => Promise<void>;
  onCancelWorkflowRetry: (stepId: string) => Promise<void>;
  onForceWorkflowRetry: (stepId: string) => Promise<void>;
  pendingEventRetryId: string | null;
  pendingTriggerRetryId: string | null;
  pendingWorkflowRetryId: string | null;
};

function getTriggerHealth(
  eventHealth: WorkflowEventSchedulerHealth | null,
  triggerId: string
) {
  if (!eventHealth) {
    return null;
  }
  const metrics = eventHealth.triggers[triggerId];
  const paused = eventHealth.pausedTriggers[triggerId];
  return {
    metrics,
    paused,
    lastError: metrics?.lastError ?? null,
    lastStatus: metrics?.lastStatus ?? null
  };
}

function summarizeCounts(metrics: WorkflowEventSchedulerHealth['triggers'][string] | undefined) {
  if (!metrics) {
    return 'No data yet';
  }
  const { counts } = metrics;
  const matched = counts.matched ?? 0;
  const launched = counts.launched ?? 0;
  const throttled = counts.throttled ?? 0;
  const failed = counts.failed ?? 0;
  return `${matched} matched · ${launched} launched · ${throttled} throttled · ${failed} failed`;
}

export default function EventTriggersPanel({
  workflow,
  triggers,
  triggersLoading,
  triggersError,
  selectedTrigger,
  onSelectTrigger,
  createTrigger,
  updateTrigger,
  deleteTrigger,
  deliveries,
  deliveriesLoading,
  deliveriesError,
  deliveriesLimit,
  deliveriesQuery,
  onReloadDeliveries,
  eventHealth,
  eventHealthLoading,
  eventHealthError,
  onRefreshEventHealth,
  eventSamples,
  eventSchema,
  eventSamplesLoading,
  eventSamplesError,
  eventSamplesQuery,
  loadEventSamples,
  refreshEventSamples,
  canEdit,
  onCancelEventRetry,
  onForceEventRetry,
  onCancelTriggerRetry,
  onForceTriggerRetry,
  onCancelWorkflowRetry,
  onForceWorkflowRetry,
  pendingEventRetryId,
  pendingTriggerRetryId,
  pendingWorkflowRetryId
}: EventTriggersPanelProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formTrigger, setFormTrigger] = useState<WorkflowEventTrigger | null>(null);
  const [sampleDrawerOpen, setSampleDrawerOpen] = useState(false);
  const [samplePreview, setSamplePreview] = useState<EventTriggerPreviewSnapshot | null>(null);
  const [eventRetryLimit, setEventRetryLimit] = useState(RETRY_PAGE_SIZE);
  const [triggerRetryLimit, setTriggerRetryLimit] = useState(RETRY_PAGE_SIZE);
  const [workflowRetryLimit, setWorkflowRetryLimit] = useState(RETRY_PAGE_SIZE);

  const workflowSlug = workflow?.slug ?? null;
  const triggerHealth = selectedTrigger ? getTriggerHealth(eventHealth, selectedTrigger.id) : null;

  useEffect(() => {
    setEventRetryLimit(RETRY_PAGE_SIZE);
    setTriggerRetryLimit(RETRY_PAGE_SIZE);
    setWorkflowRetryLimit(RETRY_PAGE_SIZE);
  }, [workflowSlug]);

  const deliveryStatusFilter = deliveriesQuery.status ?? null;

  const handleOpenCreate = () => {
    setFormMode('create');
    setFormTrigger(null);
    setFormOpen(true);
  };

  const handleOpenEdit = (trigger: WorkflowEventTrigger) => {
    setFormMode('edit');
    setFormTrigger(trigger);
    setFormOpen(true);
  };

  const handleFormClose = () => {
    setFormOpen(false);
    setFormTrigger(null);
    setSamplePreview(null);
  };

  const handleCreate = async (_slug: string, input: WorkflowEventTriggerCreateInput) => {
    if (!workflowSlug) {
      throw new Error('Workflow slug unavailable');
    }
    return createTrigger(workflowSlug, input);
  };

  const handleUpdate = async (
    _slug: string,
    triggerId: string,
    input: WorkflowEventTriggerUpdateInput
  ) => {
    if (!workflowSlug) {
      throw new Error('Workflow slug unavailable');
    }
    return updateTrigger(workflowSlug, triggerId, input);
  };

  const handleDelete = async (trigger: WorkflowEventTrigger) => {
    if (!workflowSlug) {
      return;
    }
    const confirmed = window.confirm(`Delete trigger ${trigger.eventType}? This cannot be undone.`);
    if (!confirmed) {
      return;
    }
    await deleteTrigger(workflowSlug, trigger.id);
  };

  const handleToggleStatus = async (trigger: WorkflowEventTrigger) => {
    await handleUpdate(workflowSlug ?? '', trigger.id, {
      status: trigger.status === 'active' ? 'disabled' : 'active'
    });
  };

  const handleReloadDeliveries = (status: WorkflowTriggerDeliveriesQuery['status'] | undefined) => {
    const next: WorkflowTriggerDeliveriesQuery = { limit: deliveriesLimit };
    if (status) {
      next.status = status;
    }
    onReloadDeliveries(next);
  };

  const handleOpenSamplesForTrigger = (trigger: WorkflowEventTrigger) => {
    setSamplePreview(null);
    setSampleDrawerOpen(true);
    const query: WorkflowEventSampleQuery = {
      type: trigger.eventType,
      source: trigger.eventSource ?? undefined,
      limit: eventSamplesQuery?.limit ?? 25
    };
    loadEventSamples(query);
  };

  const handlePreviewRequest = (snapshot: EventTriggerPreviewSnapshot) => {
    setSamplePreview(snapshot);
    setSampleDrawerOpen(true);
    const query: WorkflowEventSampleQuery = {
      type: snapshot.eventType,
      source: snapshot.eventSource ?? undefined,
      limit: eventSamplesQuery?.limit ?? 25
    };
    loadEventSamples(query);
  };

  const sortedTriggers = useMemo(() => {
    return [...triggers].sort((a, b) => a.eventType.localeCompare(b.eventType));
  }, [triggers]);

  const deliveriesSummary = useMemo(() => {
    if (deliveries.length === 0) {
      return 'No deliveries yet';
    }
    const latest = deliveries[0];
    return `Latest: ${latest.status} · ${formatDate(latest.updatedAt)}`;
  }, [deliveries]);

  const eventRetryBacklog = eventHealth?.retries?.events ?? {
    summary: { total: 0, overdue: 0, nextAttemptAt: null },
    entries: []
  };
  const triggerRetryBacklog = eventHealth?.retries?.triggers ?? {
    summary: { total: 0, overdue: 0, nextAttemptAt: null },
    entries: []
  };
  const workflowRetryBacklog = eventHealth?.retries?.workflowSteps ?? {
    summary: { total: 0, overdue: 0, nextAttemptAt: null },
    entries: []
  };

  useEffect(() => {
    setEventRetryLimit((current) => {
      const total = eventRetryBacklog.entries.length;
      if (total === 0) {
        return RETRY_PAGE_SIZE;
      }
      return Math.min(current, total);
    });
  }, [eventRetryBacklog.entries.length]);

  useEffect(() => {
    setTriggerRetryLimit((current) => {
      const total = triggerRetryBacklog.entries.length;
      if (total === 0) {
        return RETRY_PAGE_SIZE;
      }
      return Math.min(current, total);
    });
  }, [triggerRetryBacklog.entries.length]);

  useEffect(() => {
    setWorkflowRetryLimit((current) => {
      const total = workflowRetryBacklog.entries.length;
      if (total === 0) {
        return RETRY_PAGE_SIZE;
      }
      return Math.min(current, total);
    });
  }, [workflowRetryBacklog.entries.length]);

  const visibleEventRetries = useMemo(
    () =>
      eventRetryBacklog.entries.slice(
        0,
        Math.min(eventRetryLimit, Math.max(eventRetryBacklog.entries.length, RETRY_PAGE_SIZE))
      ),
    [eventRetryBacklog.entries, eventRetryLimit]
  );

  const visibleTriggerRetries = useMemo(
    () =>
      triggerRetryBacklog.entries.slice(
        0,
        Math.min(triggerRetryLimit, Math.max(triggerRetryBacklog.entries.length, RETRY_PAGE_SIZE))
      ),
    [triggerRetryBacklog.entries, triggerRetryLimit]
  );

  const visibleWorkflowRetries = useMemo(
    () =>
      workflowRetryBacklog.entries.slice(
        0,
        Math.min(workflowRetryLimit, Math.max(workflowRetryBacklog.entries.length, RETRY_PAGE_SIZE))
      ),
    [workflowRetryBacklog.entries, workflowRetryLimit]
  );

  const handleLoadMoreEventRetries = useCallback(() => {
    setEventRetryLimit((current) => {
      const total = eventRetryBacklog.entries.length;
      if (total === 0) {
        return RETRY_PAGE_SIZE;
      }
      return Math.min(total, current + RETRY_PAGE_SIZE);
    });
  }, [eventRetryBacklog.entries.length]);

  const handleLoadMoreTriggerRetries = useCallback(() => {
    setTriggerRetryLimit((current) => {
      const total = triggerRetryBacklog.entries.length;
      if (total === 0) {
        return RETRY_PAGE_SIZE;
      }
      return Math.min(total, current + RETRY_PAGE_SIZE);
    });
  }, [triggerRetryBacklog.entries.length]);

  const handleLoadMoreWorkflowRetries = useCallback(() => {
    setWorkflowRetryLimit((current) => {
      const total = workflowRetryBacklog.entries.length;
      if (total === 0) {
        return RETRY_PAGE_SIZE;
      }
      return Math.min(total, current + RETRY_PAGE_SIZE);
    });
  }, [workflowRetryBacklog.entries.length]);

  const formatSummary = (label: string, summary: RetryBacklogSummary): string => {
    const overdueText = summary.overdue > 0 ? `${summary.overdue} overdue` : 'no overdue retries';
    const whenText = summary.nextAttemptAt ? `oldest scheduled ${formatDate(summary.nextAttemptAt)}` : 'no upcoming attempts';
    return `${summary.total} ${label} · ${overdueText} · ${whenText}`;
  };

  const renderOverdueBadge = (overdue: boolean) =>
    overdue ? (
      <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-[2px] text-[10px] font-semibold text-rose-600 dark:bg-rose-900/30 dark:text-rose-200">
        Overdue
      </span>
    ) : null;

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Event Triggers</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure workflow launches based on incoming events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshEventHealth}
            className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Refresh health
          </button>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canEdit || !workflowSlug}
            title={canEdit ? undefined : 'Requires workflows:write scope'}
          >
            Create trigger
          </button>
        </div>
      </div>

      {triggersError && (
        <div className="mt-4 rounded-2xl border border-rose-200/70 bg-rose-50/70 px-4 py-3 text-xs font-semibold text-rose-700 dark:border-rose-500/50 dark:bg-rose-900/30 dark:text-rose-200">
          {triggersError}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <aside className="w-full max-w-xs rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
            <span>Triggers</span>
            {triggersLoading && <Spinner size="xs" />}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {sortedTriggers.length === 0 ? (
              <p className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">No triggers configured.</p>
            ) : (
              <ul className="divide-y divide-slate-200/70 dark:divide-slate-800/60">
                {sortedTriggers.map((trigger) => {
                  const selected = selectedTrigger?.id === trigger.id;
                  const metrics = getTriggerHealth(eventHealth, trigger.id)?.metrics;
                  return (
                    <li
                      key={trigger.id}
                      className={`cursor-pointer px-4 py-3 text-xs transition hover:bg-indigo-50 dark:hover:bg-slate-800 ${selected ? 'bg-indigo-50/70 text-indigo-700 dark:bg-slate-800/60 dark:text-indigo-200' : 'text-slate-600 dark:text-slate-300'}`}
                      onClick={() => onSelectTrigger(trigger.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{trigger.eventType}</span>
                        <span
                          className={
                            trigger.status === 'active'
                              ? 'rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300'
                              : 'rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-600 dark:bg-amber-900/40 dark:text-amber-200'
                          }
                        >
                          {trigger.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {trigger.eventSource ?? 'any source'}
                      </p>
                      {metrics && (
                        <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                          {summarizeCounts(metrics)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <div className="flex-1 rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
          {!selectedTrigger ? (
            <div className="flex h-full items-center justify-center text-xs text-slate-500 dark:text-slate-400">
              Select a trigger to view details.
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                    {selectedTrigger.eventType}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {selectedTrigger.eventSource ?? 'Any source'} · Version {selectedTrigger.version}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenSamplesForTrigger(selectedTrigger)}
                    className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    View samples
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(selectedTrigger)}
                    className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                    disabled={!canEdit}
                    title={canEdit ? undefined : 'Requires workflows:write scope'}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(selectedTrigger)}
                    className="rounded-full border border-slate-200/70 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                    disabled={!canEdit}
                    title={canEdit ? undefined : 'Requires workflows:write scope'}
                  >
                    {selectedTrigger.status === 'active' ? 'Disable' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedTrigger)}
                    className="rounded-full border border-rose-200/70 px-3 py-2 text-xs font-semibold text-rose-600 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-900/30"
                    disabled={!canEdit}
                    title={canEdit ? 'Remove trigger' : 'Requires workflows:write scope'}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Summary
                  </h4>
                  <dl className="mt-2 space-y-1">
                    <div className="flex justify-between">
                      <dt>Name</dt>
                      <dd className="font-semibold text-slate-700 dark:text-slate-200">
                        {selectedTrigger.name ?? '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Throttle</dt>
                      <dd>
                        {selectedTrigger.throttleWindowMs && selectedTrigger.throttleCount
                          ? `${selectedTrigger.throttleCount} in ${selectedTrigger.throttleWindowMs}ms`
                          : 'Not configured'}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Max concurrency</dt>
                      <dd>{selectedTrigger.maxConcurrency ?? 'unlimited'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Idempotency</dt>
                      <dd>{selectedTrigger.idempotencyKeyExpression ?? 'none'}</dd>
                    </div>
                  </dl>
                </div>
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Health
                  </h4>
                  {eventHealthLoading ? (
                    <div className="mt-2 flex items-center gap-2 text-xs">
                      <Spinner size="xs" /> Loading snapshot…
                    </div>
                  ) : triggerHealth ? (
                    <dl className="mt-2 space-y-1">
                      <div className="flex justify-between">
                        <dt>Last status</dt>
                        <dd>{triggerHealth.lastStatus ?? '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Counts</dt>
                        <dd>{summarizeCounts(triggerHealth.metrics)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Last error</dt>
                        <dd>{triggerHealth.lastError ?? '—'}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt>Paused</dt>
                        <dd>
                          {triggerHealth.paused
                            ? `${triggerHealth.paused.reason}${triggerHealth.paused.until ? ` until ${formatDate(triggerHealth.paused.until)}` : ''}`
                            : 'No'}
                        </dd>
                      </div>
                    </dl>
                  ) : eventHealthError ? (
                    <p className="mt-2 text-rose-600 dark:text-rose-300">{eventHealthError}</p>
                  ) : (
                    <p className="mt-2 text-slate-500 dark:text-slate-400">No metrics yet.</p>
                  )}
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Deliveries
                </h4>
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{deliveriesSummary}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                      Status
                      <select
                        value={deliveryStatusFilter ?? ''}
                        onChange={(event) =>
                          handleReloadDeliveries(
                            event.target.value ? (event.target.value as WorkflowTriggerDeliveriesQuery['status']) : undefined
                          )
                        }
                        className="ml-2 rounded-lg border border-slate-200/70 bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <option value="">All</option>
                        <option value="matched">matched</option>
                        <option value="throttled">throttled</option>
                        <option value="launched">launched</option>
                        <option value="failed">failed</option>
                        <option value="skipped">skipped</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => onReloadDeliveries(deliveriesQuery)}
                      className="rounded-full border border-slate-200/70 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Event retries
                  </h4>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {formatSummary('scheduled', eventRetryBacklog.summary)}
                  </p>
                  {eventRetryBacklog.entries.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No pending event retries.</p>
                  ) : (
                    <ScrollableListContainer
                      className="mt-3"
                      height={260}
                      hasMore={eventRetryBacklog.entries.length > visibleEventRetries.length}
                      onLoadMore={handleLoadMoreEventRetries}
                      itemCount={visibleEventRetries.length}
                    >
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-[11px] dark:divide-slate-700">
                          <thead className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <tr>
                              <th className="px-2 py-2">Event</th>
                              <th className="px-2 py-2">Source</th>
                              <th className="px-2 py-2">Next attempt</th>
                              <th className="px-2 py-2">Attempts</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {visibleEventRetries.map((entry) => {
                              const pending = pendingEventRetryId === entry.eventId || eventHealthLoading;
                              return (
                                <tr key={entry.eventId} className="hover:bg-indigo-50/40 dark:hover:bg-slate-800/50">
                                  <td className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">{entry.eventId}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{entry.source}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatDate(entry.nextAttemptAt)}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{entry.attempts}</td>
                                  <td className="flex items-center gap-2 px-2 py-2 text-slate-500 dark:text-slate-400">
                                    <span className="capitalize">{entry.retryState}</span>
                                    {renderOverdueBadge(entry.overdue)}
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="rounded-full border border-slate-200/70 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                                        onClick={() => {
                                          void onCancelEventRetry(entry.eventId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingEventRetryId === entry.eventId ? 'Working…' : 'Cancel'}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full border border-indigo-200/70 px-2 py-1 text-[10px] font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-200 dark:hover:bg-indigo-900/30"
                                        onClick={() => {
                                          void onForceEventRetry(entry.eventId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingEventRetryId === entry.eventId ? 'Working…' : 'Run now'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </ScrollableListContainer>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Trigger retries
                  </h4>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {formatSummary('scheduled', triggerRetryBacklog.summary)}
                  </p>
                  {triggerRetryBacklog.entries.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No pending trigger deliveries.</p>
                  ) : (
                    <ScrollableListContainer
                      className="mt-3"
                      height={260}
                      hasMore={triggerRetryBacklog.entries.length > visibleTriggerRetries.length}
                      onLoadMore={handleLoadMoreTriggerRetries}
                      itemCount={visibleTriggerRetries.length}
                    >
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-[11px] dark:divide-slate-700">
                          <thead className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <tr>
                              <th className="px-2 py-2">Delivery</th>
                              <th className="px-2 py-2">Trigger</th>
                              <th className="px-2 py-2">Workflow</th>
                              <th className="px-2 py-2">Next attempt</th>
                              <th className="px-2 py-2">Attempts</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {visibleTriggerRetries.map((entry) => {
                              const pending = pendingTriggerRetryId === entry.deliveryId || eventHealthLoading;
                              return (
                                <tr key={entry.deliveryId} className="hover:bg-indigo-50/40 dark:hover:bg-slate-800/50">
                                  <td className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">{entry.deliveryId}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                                    {entry.triggerName ?? entry.triggerId}
                                  </td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">
                                    {entry.workflowSlug ?? entry.workflowDefinitionId}
                                  </td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatDate(entry.nextAttemptAt)}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{entry.retryAttempts}</td>
                                  <td className="flex items-center gap-2 px-2 py-2 text-slate-500 dark:text-slate-400">
                                    <span className="capitalize">{entry.retryState}</span>
                                    {renderOverdueBadge(entry.overdue)}
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="rounded-full border border-slate-200/70 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                                        onClick={() => {
                                          void onCancelTriggerRetry(entry.deliveryId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingTriggerRetryId === entry.deliveryId ? 'Working…' : 'Cancel'}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full border border-indigo-200/70 px-2 py-1 text-[10px] font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-200 dark:hover:bg-indigo-900/30"
                                        onClick={() => {
                                          void onForceTriggerRetry(entry.deliveryId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingTriggerRetryId === entry.deliveryId ? 'Working…' : 'Run now'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </ScrollableListContainer>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/60 p-4 text-xs text-slate-600 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Workflow step retries
                  </h4>
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {formatSummary('scheduled', workflowRetryBacklog.summary)}
                  </p>
                  {workflowRetryBacklog.entries.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">No pending workflow step retries.</p>
                  ) : (
                    <ScrollableListContainer
                      className="mt-3"
                      height={260}
                      hasMore={workflowRetryBacklog.entries.length > visibleWorkflowRetries.length}
                      onLoadMore={handleLoadMoreWorkflowRetries}
                      itemCount={visibleWorkflowRetries.length}
                    >
                      <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-[11px] dark:divide-slate-700">
                          <thead className="bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <tr>
                              <th className="px-2 py-2">Step</th>
                              <th className="px-2 py-2">Workflow</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2">Next attempt</th>
                              <th className="px-2 py-2">Attempts</th>
                              <th className="px-2 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                            {visibleWorkflowRetries.map((entry) => {
                              const pending = pendingWorkflowRetryId === entry.workflowRunStepId || eventHealthLoading;
                              return (
                                <tr key={entry.workflowRunStepId} className="hover:bg-indigo-50/40 dark:hover:bg-slate-800/50">
                                  <td className="px-2 py-2 font-semibold text-slate-700 dark:text-slate-200">{entry.stepId}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{entry.workflowSlug ?? entry.workflowDefinitionId}</td>
                                  <td className="flex items-center gap-2 px-2 py-2 text-slate-500 dark:text-slate-400">
                                    <span className="capitalize">{entry.status}</span>
                                    {renderOverdueBadge(entry.overdue)}
                                  </td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{formatDate(entry.nextAttemptAt)}</td>
                                  <td className="px-2 py-2 text-slate-500 dark:text-slate-400">{entry.retryAttempts}</td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        className="rounded-full border border-slate-200/70 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700/60 dark:text-slate-200 dark:hover:bg-slate-800"
                                        onClick={() => {
                                          void onCancelWorkflowRetry(entry.workflowRunStepId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingWorkflowRetryId === entry.workflowRunStepId ? 'Working…' : 'Cancel'}
                                      </button>
                                      <button
                                        type="button"
                                        className="rounded-full border border-indigo-200/70 px-2 py-1 text-[10px] font-semibold text-indigo-600 shadow-sm transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-500/40 dark:text-indigo-200 dark:hover:bg-indigo-900/30"
                                        onClick={() => {
                                          void onForceWorkflowRetry(entry.workflowRunStepId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingWorkflowRetryId === entry.workflowRunStepId ? 'Working…' : 'Run now'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </ScrollableListContainer>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/70 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-900">
                <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
                  <span>Recent deliveries</span>
                  {deliveriesLoading && <Spinner size="xs" />}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {deliveriesError ? (
                    <p className="px-4 py-3 text-xs text-rose-600 dark:text-rose-300">{deliveriesError}</p>
                  ) : deliveries.length === 0 ? (
                    <p className="px-4 py-3 text-xs text-slate-500 dark:text-slate-400">No deliveries recorded.</p>
                  ) : (
                    <table className="min-w-full divide-y divide-slate-200/70 text-left text-xs dark:divide-slate-800/60">
                      <thead className="bg-slate-50/70 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
                        <tr>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Event ID</th>
                          <th className="px-3 py-2">Attempts</th>
                          <th className="px-3 py-2">Updated</th>
                          <th className="px-3 py-2">Run</th>
                          <th className="px-3 py-2">Error</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200/70 text-[11px] dark:divide-slate-800/60">
                        {deliveries.map((delivery) => (
                          <tr key={delivery.id} className="hover:bg-indigo-50/50 dark:hover:bg-slate-800/40">
                            <td className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-200">{delivery.status}</td>
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{delivery.eventId}</td>
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{delivery.attempts}</td>
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{formatDate(delivery.updatedAt)}</td>
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{delivery.workflowRunId ?? '—'}</td>
                            <td className="px-3 py-2 text-slate-500 dark:text-slate-400">
                              {delivery.lastError ? delivery.lastError.slice(0, 80) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <EventTriggerFormModal
        open={formOpen}
        mode={formMode}
        workflowSlug={workflowSlug ?? ''}
        workflowName={workflow?.name ?? workflowSlug ?? 'workflow'}
        initialTrigger={formTrigger}
        canEdit={canEdit}
        eventSchema={eventSchema}
        eventSchemaLoading={eventSamplesLoading}
        eventSchemaQuery={eventSamplesQuery}
        onLoadEventSchema={loadEventSamples}
        onClose={handleFormClose}
        onCreate={handleCreate}
        onUpdate={handleUpdate}
        onPreview={handlePreviewRequest}
      />

      <EventSampleDrawer
        open={sampleDrawerOpen}
        loading={eventSamplesLoading}
        error={eventSamplesError}
        samples={eventSamples}
        schema={eventSchema}
        query={eventSamplesQuery}
        trigger={samplePreview ? null : selectedTrigger}
        previewSnapshot={samplePreview}
        onClose={() => {
          setSampleDrawerOpen(false);
          setSamplePreview(null);
        }}
        onLoad={loadEventSamples}
        onRefresh={refreshEventSamples}
      />
    </section>
  );
}
