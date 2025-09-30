import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollableListContainer, Spinner } from '../../../components';
import { getStatusToneClasses } from '../../../theme/statusTokens';
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

const PANEL_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md';

const PANEL_HEADER_TITLE = 'text-scale-lg font-weight-semibold text-primary';

const PANEL_HEADER_META = 'text-scale-xs text-secondary';

const SIDEBAR_CONTAINER =
  'w-full max-w-xs rounded-2xl border border-subtle bg-surface-glass shadow-elevation-sm';

const SIDEBAR_HEADER =
  'flex items-center justify-between border-b border-subtle px-4 py-3 text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

const SIDEBAR_ITEM_BASE =
  'cursor-pointer px-4 py-3 text-scale-xs transition-colors hover:bg-accent-soft';

const SIDEBAR_ITEM_ACTIVE = 'bg-accent-soft text-accent shadow-elevation-sm';

const SIDEBAR_ITEM_INACTIVE = 'text-secondary';

const SIDEBAR_BADGE_BASE =
  'inline-flex items-center rounded-full px-2 py-[3px] text-[10px] font-weight-semibold capitalize';

const ACTION_BUTTON_SMALL =
  'rounded-full border border-subtle bg-surface-glass px-3 py-2 text-scale-xs font-weight-semibold text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-full border border-accent bg-accent px-4 py-2 text-scale-sm font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const CARD_CONTAINER =
  'rounded-2xl border border-subtle bg-surface-glass p-5 shadow-elevation-sm';

const LIGHT_CARD_CONTAINER =
  'rounded-2xl border border-subtle bg-surface-muted px-4 py-4 text-scale-xs text-secondary shadow-inner';

const SECTION_SUBTEXT = 'text-scale-xs text-secondary';

const TABLE_STYLES =
  'min-w-full divide-y divide-subtle text-left text-[11px] text-secondary';

const TABLE_HEAD =
  'bg-surface-muted text-[10px] font-weight-semibold uppercase tracking-[0.3em] text-muted';

const TABLE_BODY = 'divide-y divide-subtle';

const BADGE_BASE =
  'inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-[0.25em]';

const SECTION_LABEL = 'text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

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
      <span className={`${BADGE_BASE} ${getStatusToneClasses('warning')}`}>Overdue</span>
    ) : null;

  return (
    <section className={PANEL_CONTAINER}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={PANEL_HEADER_TITLE}>Event Triggers</h2>
          <p className={PANEL_HEADER_META}>Configure workflow launches based on incoming events.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefreshEventHealth}
            className={ACTION_BUTTON_SMALL}
          >
            Refresh health
          </button>
          <button
            type="button"
            onClick={handleOpenCreate}
            className={PRIMARY_BUTTON}
            disabled={!canEdit || !workflowSlug}
            title={canEdit ? undefined : 'Requires workflows:write scope'}
          >
            Create trigger
          </button>
        </div>
      </div>

      {triggersError && (
        <div className={`mt-4 ${ALERT_BOX_BASE} ${getStatusToneClasses('error')}`}>
          {triggersError}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-4 lg:flex-row">
        <aside className={SIDEBAR_CONTAINER}>
          <div className={SIDEBAR_HEADER}>
            <span>Triggers</span>
            {triggersLoading && <Spinner size="xs" />}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {sortedTriggers.length === 0 ? (
              <p className="px-4 py-4 text-scale-xs text-secondary">No triggers configured.</p>
            ) : (
              <ul className="divide-y divide-subtle">
                {sortedTriggers.map((trigger) => {
                  const selected = selectedTrigger?.id === trigger.id;
                  const metrics = getTriggerHealth(eventHealth, trigger.id)?.metrics;
                  return (
                    <li
                      key={trigger.id}
                      className={`${SIDEBAR_ITEM_BASE} ${selected ? SIDEBAR_ITEM_ACTIVE : SIDEBAR_ITEM_INACTIVE}`}
                      onClick={() => onSelectTrigger(trigger.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-weight-semibold">{trigger.eventType}</span>
                        <span className={`${SIDEBAR_BADGE_BASE} ${getStatusToneClasses(trigger.status)}`}>
                          {trigger.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted">{trigger.eventSource ?? 'any source'}</p>
                      {metrics && (
                        <p className="mt-2 text-[10px] text-muted">{summarizeCounts(metrics)}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        <div className={CARD_CONTAINER}>
          {!selectedTrigger ? (
            <div className="flex h-full items-center justify-center text-scale-xs text-secondary">Select a trigger to view details.</div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-scale-md font-weight-semibold text-primary">{selectedTrigger.eventType}</h3>
                  <p className={SECTION_SUBTEXT}>
                    {selectedTrigger.eventSource ?? 'Any source'} · Version {selectedTrigger.version}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenSamplesForTrigger(selectedTrigger)}
                    className={ACTION_BUTTON_SMALL}
                  >
                    View samples
                  </button>
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(selectedTrigger)}
                    className={ACTION_BUTTON_SMALL}
                    disabled={!canEdit}
                    title={canEdit ? undefined : 'Requires workflows:write scope'}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(selectedTrigger)}
                    className={ACTION_BUTTON_SMALL}
                    disabled={!canEdit}
                    title={canEdit ? undefined : 'Requires workflows:write scope'}
                  >
                    {selectedTrigger.status === 'active' ? 'Disable' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(selectedTrigger)}
                    className={`${ACTION_BUTTON_SMALL} border-status-danger text-status-danger hover:border-status-danger hover:text-status-danger focus-visible:outline-status-danger`}
                    disabled={!canEdit}
                    title={canEdit ? 'Remove trigger' : 'Requires workflows:write scope'}
                  >
                    Delete
                  </button>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className={LIGHT_CARD_CONTAINER}>
                  <h4 className={SECTION_LABEL}>Summary</h4>
                  <dl className="mt-2 space-y-1 text-scale-xs text-secondary">
                    <div className="flex justify-between">
                      <dt>Name</dt>
                      <dd className="font-weight-semibold text-primary">{selectedTrigger.name ?? '—'}</dd>
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
                    <div className="flex justify-between">
                      <dt>Run key template</dt>
                      <dd>{selectedTrigger.runKeyTemplate ?? 'auto-generated'}</dd>
                    </div>
                  </dl>
                </div>
                <div className={LIGHT_CARD_CONTAINER}>
                  <h4 className={SECTION_LABEL}>Health</h4>
                  {eventHealthLoading ? (
                    <div className="mt-2 flex items-center gap-2 text-scale-xs text-secondary">
                      <Spinner size="xs" /> Loading snapshot…
                    </div>
                  ) : triggerHealth ? (
                    <dl className="mt-2 space-y-1 text-scale-xs text-secondary">
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
                    <p className={`${SECTION_SUBTEXT} mt-2 text-status-danger`}>{eventHealthError}</p>
                  ) : (
                    <p className={`${SECTION_SUBTEXT} mt-2`}>No metrics yet.</p>
                  )}
                </div>
                <div className={LIGHT_CARD_CONTAINER}>
                  <h4 className={SECTION_LABEL}>Deliveries</h4>
                  <p className="mt-2 text-[11px] text-secondary">{deliveriesSummary}</p>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-secondary">
                    <label className="font-weight-semibold text-secondary">
                      Status
                      <select
                        value={deliveryStatusFilter ?? ''}
                        onChange={(event) =>
                          handleReloadDeliveries(
                            event.target.value ? (event.target.value as WorkflowTriggerDeliveriesQuery['status']) : undefined
                          )
                        }
                        className="ml-2 rounded-xl border border-subtle bg-surface-glass px-2 py-1 text-[11px] text-secondary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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
                      className={ACTION_BUTTON_SMALL}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <div className={LIGHT_CARD_CONTAINER}>
                  <h4 className={SECTION_LABEL}>Event retries</h4>
                  <p className="mt-2 text-[11px] text-secondary">{formatSummary('scheduled', eventRetryBacklog.summary)}</p>
                  {eventRetryBacklog.entries.length === 0 ? (
                    <p className="mt-2 text-[11px] text-secondary">No pending event retries.</p>
                  ) : (
                    <ScrollableListContainer
                      className="mt-3"
                      height={260}
                      hasMore={eventRetryBacklog.entries.length > visibleEventRetries.length}
                      onLoadMore={handleLoadMoreEventRetries}
                      itemCount={visibleEventRetries.length}
                    >
                      <div className="overflow-x-auto">
                        <table className={TABLE_STYLES}>
                          <thead className={TABLE_HEAD}>
                            <tr>
                              <th className="px-2 py-2">Event</th>
                              <th className="px-2 py-2">Source</th>
                              <th className="px-2 py-2">Next attempt</th>
                              <th className="px-2 py-2">Attempts</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className={TABLE_BODY}>
                            {visibleEventRetries.map((entry) => {
                              const pending = pendingEventRetryId === entry.eventId || eventHealthLoading;
                              return (
                                <tr key={entry.eventId} className="hover:bg-accent-soft/60">
                                  <td className="px-2 py-2 font-weight-semibold text-primary">{entry.eventId}</td>
                                  <td className="px-2 py-2 text-secondary">{entry.source}</td>
                                  <td className="px-2 py-2 text-secondary">{formatDate(entry.nextAttemptAt)}</td>
                                  <td className="px-2 py-2 text-secondary">{entry.attempts}</td>
                                  <td className="flex items-center gap-2 px-2 py-2 text-secondary">
                                    <span className="capitalize">{entry.retryState}</span>
                                    {renderOverdueBadge(entry.overdue)}
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        className={`${ACTION_BUTTON_SMALL} px-2 py-1`}
                                        onClick={() => {
                                          void onCancelEventRetry(entry.eventId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingEventRetryId === entry.eventId ? 'Working…' : 'Cancel'}
                                      </button>
                                      <button
                                        type="button"
                                        className={`${ACTION_BUTTON_SMALL} border-accent text-accent hover:border-accent hover:text-accent`}
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

                <div className={LIGHT_CARD_CONTAINER}>
                  <h4 className={SECTION_LABEL}>Trigger retries</h4>
                  <p className="mt-2 text-[11px] text-secondary">{formatSummary('scheduled', triggerRetryBacklog.summary)}</p>
                  {triggerRetryBacklog.entries.length === 0 ? (
                    <p className="mt-2 text-[11px] text-secondary">No pending trigger deliveries.</p>
                  ) : (
                    <ScrollableListContainer
                      className="mt-3"
                      height={260}
                      hasMore={triggerRetryBacklog.entries.length > visibleTriggerRetries.length}
                      onLoadMore={handleLoadMoreTriggerRetries}
                      itemCount={visibleTriggerRetries.length}
                    >
                      <div className="overflow-x-auto">
                        <table className={TABLE_STYLES}>
                          <thead className={TABLE_HEAD}>
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
                          <tbody className={TABLE_BODY}>
                            {visibleTriggerRetries.map((entry) => {
                              const pending = pendingTriggerRetryId === entry.deliveryId || eventHealthLoading;
                              return (
                                <tr key={entry.deliveryId} className="hover:bg-accent-soft/60">
                                  <td className="px-2 py-2 font-weight-semibold text-primary">{entry.deliveryId}</td>
                                  <td className="px-2 py-2 text-secondary">
                                    {entry.triggerName ?? entry.triggerId}
                                  </td>
                                  <td className="px-2 py-2 text-secondary">
                                    {entry.workflowSlug ?? entry.workflowDefinitionId}
                                  </td>
                                  <td className="px-2 py-2 text-secondary">{formatDate(entry.nextAttemptAt)}</td>
                                  <td className="px-2 py-2 text-secondary">{entry.retryAttempts}</td>
                                  <td className="flex items-center gap-2 px-2 py-2 text-secondary">
                                    <span className="capitalize">{entry.retryState}</span>
                                    {renderOverdueBadge(entry.overdue)}
                                  </td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        className={`${ACTION_BUTTON_SMALL} px-2 py-1`}
                                        onClick={() => {
                                          void onCancelTriggerRetry(entry.deliveryId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingTriggerRetryId === entry.deliveryId ? 'Working…' : 'Cancel'}
                                      </button>
                                      <button
                                        type="button"
                                        className={`${ACTION_BUTTON_SMALL} border-accent text-accent hover:border-accent hover:text-accent px-2 py-1`}
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

                <div className={LIGHT_CARD_CONTAINER}>
                  <h4 className={SECTION_LABEL}>Workflow step retries</h4>
                  <p className="mt-2 text-[11px] text-secondary">{formatSummary('scheduled', workflowRetryBacklog.summary)}</p>
                  {workflowRetryBacklog.entries.length === 0 ? (
                    <p className="mt-2 text-[11px] text-secondary">No pending workflow step retries.</p>
                  ) : (
                    <ScrollableListContainer
                      className="mt-3"
                      height={260}
                      hasMore={workflowRetryBacklog.entries.length > visibleWorkflowRetries.length}
                      onLoadMore={handleLoadMoreWorkflowRetries}
                      itemCount={visibleWorkflowRetries.length}
                    >
                      <div className="overflow-x-auto">
                        <table className={TABLE_STYLES}>
                          <thead className={TABLE_HEAD}>
                            <tr>
                              <th className="px-2 py-2">Step</th>
                              <th className="px-2 py-2">Workflow</th>
                              <th className="px-2 py-2">Status</th>
                              <th className="px-2 py-2">Next attempt</th>
                              <th className="px-2 py-2">Attempts</th>
                              <th className="px-2 py-2 text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody className={TABLE_BODY}>
                            {visibleWorkflowRetries.map((entry) => {
                              const pending = pendingWorkflowRetryId === entry.workflowRunStepId || eventHealthLoading;
                              return (
                                <tr key={entry.workflowRunStepId} className="hover:bg-accent-soft/60">
                                  <td className="px-2 py-2 font-weight-semibold text-primary">{entry.stepId}</td>
                                  <td className="px-2 py-2 text-secondary">{entry.workflowSlug ?? entry.workflowDefinitionId}</td>
                                  <td className="flex items-center gap-2 px-2 py-2 text-secondary">
                                    <span className="capitalize">{entry.status}</span>
                                    {renderOverdueBadge(entry.overdue)}
                                  </td>
                                  <td className="px-2 py-2 text-secondary">{formatDate(entry.nextAttemptAt)}</td>
                                  <td className="px-2 py-2 text-secondary">{entry.retryAttempts}</td>
                                  <td className="px-2 py-2 text-right">
                                    <div className="inline-flex items-center gap-2">
                                      <button
                                        type="button"
                                        className={`${ACTION_BUTTON_SMALL} px-2 py-1`}
                                        onClick={() => {
                                          void onCancelWorkflowRetry(entry.workflowRunStepId);
                                        }}
                                        disabled={!canEdit || pending}
                                      >
                                        {pending && pendingWorkflowRetryId === entry.workflowRunStepId ? 'Working…' : 'Cancel'}
                                      </button>
                                      <button
                                        type="button"
                                        className={`${ACTION_BUTTON_SMALL} border-accent text-accent hover:border-accent hover:text-accent px-2 py-1`}
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

              <div className={CARD_CONTAINER}>
                <div className={`${SIDEBAR_HEADER} justify-between`}>  
                  <span>Recent deliveries</span>
                  {deliveriesLoading && <Spinner size="xs" />}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {deliveriesError ? (
                    <p className="px-4 py-3 text-scale-xs text-status-danger">{deliveriesError}</p>
                  ) : deliveries.length === 0 ? (
                    <p className="px-4 py-3 text-scale-xs text-secondary">No deliveries recorded.</p>
                  ) : (
                    <table className={TABLE_STYLES}>
                      <thead className={TABLE_HEAD}>
                        <tr>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Event ID</th>
                          <th className="px-3 py-2">Attempts</th>
                          <th className="px-3 py-2">Updated</th>
                          <th className="px-3 py-2">Run</th>
                          <th className="px-3 py-2">Error</th>
                        </tr>
                      </thead>
                      <tbody className={TABLE_BODY}>
                        {deliveries.map((delivery) => (
                          <tr key={delivery.id} className="hover:bg-accent-soft/60">
                            <td className="px-3 py-2 font-weight-semibold text-primary">{delivery.status}</td>
                            <td className="px-3 py-2 text-secondary">{delivery.eventId}</td>
                            <td className="px-3 py-2 text-secondary">{delivery.attempts}</td>
                            <td className="px-3 py-2 text-secondary">{formatDate(delivery.updatedAt)}</td>
                            <td className="px-3 py-2 text-secondary">{delivery.workflowRunId ?? '—'}</td>
                            <td className="px-3 py-2 text-secondary">
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
