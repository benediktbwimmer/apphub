import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { VirtualItem } from '@tanstack/react-virtual';
import type { WorkflowEventSample, WorkflowEventSchema } from '../workflows/types';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner } from '../components/Spinner';
import EventSchemaExplorer from '../workflows/components/eventTriggers/EventSchemaExplorer';
import { Modal } from '../components/Modal';
import {
  DEFAULT_EVENTS_FILTERS,
  EVENTS_SEVERITIES,
  filtersMatchSavedView,
  fromSavedViewFilters,
  toSavedViewFilters,
  type EventsExplorerFilters
} from './explorerTypes';
import { useEventsExplorer } from './useEventsExplorer';
import type { EventsExplorerPreset } from './explorerTypes';
import type { AppHubConnectionStatus } from './context';
import SavedEventViewsPanel from './SavedEventViewsPanel';
import { useSavedEventViews } from './useSavedEventViews';
import { useEventHealthSnapshot } from './useEventHealthSnapshot';
import EventsHealthRail from './EventsHealthRail';
import type { EventSavedViewRecord } from '@apphub/shared/eventsExplorer';
import { useModuleScope } from '../modules/ModuleScopeContext';
import { ModuleScopeGate } from '../modules/ModuleScopeGate';

type EventsExplorerListProps = {
  events: WorkflowEventSample[];
  highlightedIds: Set<string>;
  selectedId: string | null;
  connectionStatus: AppHubConnectionStatus;
  loading: boolean;
  refreshing: boolean;
  onSelect: (event: WorkflowEventSample) => void;
};

type EventDetailDrawerProps = {
  event: WorkflowEventSample | null;
  open: boolean;
  onClose: () => void;
};

type SchemaBrowserProps = {
  schema: WorkflowEventSchema | null;
  open: boolean;
  onClose: () => void;
  onApply: (jsonPath: string) => void;
};

type EventsFilterBarProps = {
  presets: readonly EventsExplorerPreset[];
  activePresetId: string;
  draftFilters: EventsExplorerFilters;
  schema: WorkflowEventSchema | null;
  onChange: (next: EventsExplorerFilters) => void;
  onApply: () => Promise<void>;
  onReset: () => Promise<void>;
  onPresetSelect: (presetId: string) => Promise<void>;
  onOpenSchemaBrowser: () => void;
};

const PAGE_TITLE_CLASSES = 'text-scale-2xl font-weight-semibold text-primary';
const PAGE_SUBTITLE_CLASSES = 'text-scale-sm text-muted';
const OUTLINE_FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SECONDARY_PILL_BUTTON =
  `rounded-full border border-subtle text-scale-sm font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:bg-surface-glass-soft ${OUTLINE_FOCUS}`;
const NEUTRAL_PILL_BUTTON =
  `rounded-full border border-subtle text-scale-xs font-weight-semibold text-secondary transition-colors hover:bg-surface-glass-soft ${OUTLINE_FOCUS}`;
const PRIMARY_PILL_BUTTON =
  `rounded-full bg-accent text-scale-sm font-weight-semibold text-on-accent shadow-elevation-md transition-colors hover:bg-accent-strong ${OUTLINE_FOCUS}`;
const GHOST_PILL_BUTTON =
  `rounded-full text-scale-xs font-weight-semibold transition-colors ${OUTLINE_FOCUS}`;
const SECTION_CONTAINER = 'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md';
const INPUT_LABEL_CLASSES = 'flex flex-col text-scale-xs font-weight-semibold text-secondary';
const TEXT_INPUT_CLASSES =
  'mt-1 rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const DATA_PANEL_CLASSES = 'rounded-2xl border border-subtle bg-surface-glass-soft p-4';
const PRESET_ACTIVE_CLASSES = 'bg-accent text-on-accent shadow-elevation-md';
const PRESET_INACTIVE_CLASSES = 'border border-subtle text-secondary hover:bg-surface-glass-soft';
const SEVERITY_ACTIVE_CLASSES: Record<string, string> = {
  critical: 'bg-status-danger-soft text-status-danger shadow-elevation-sm',
  error: 'bg-status-danger-soft text-status-danger shadow-elevation-sm',
  warning: 'bg-status-warning-soft text-status-warning shadow-elevation-sm',
  info: 'bg-status-info-soft text-status-info shadow-elevation-sm',
  debug: 'bg-status-neutral-soft text-secondary shadow-elevation-sm'
};
const SEVERITY_BADGE_CLASSES: Record<string, string> = {
  critical: 'bg-status-danger text-status-danger-on',
  error: 'bg-status-danger text-status-danger-on',
  warning: 'bg-status-warning text-status-warning-on',
  info: 'bg-status-info text-status-info-on',
  debug: 'bg-status-neutral text-status-neutral-on'
};
const CONNECTION_BADGE_CLASSES: Record<AppHubConnectionStatus, string> = {
  connected: 'bg-status-success-soft text-status-success',
  connecting: 'bg-status-warning-soft text-status-warning',
  disconnected: 'bg-status-danger-soft text-status-danger'
};

function formatDateTime(value: string): string {
  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

function toLocalInputValue(value: string): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (num: number) => String(num).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function fromLocalInputValue(value: string): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

function EventsExplorerPageContent() {
  const authorizedFetch = useAuthorizedFetch();
  const {
    filters,
    presets,
    activePresetId,
    events,
    schema,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    connectionStatus,
    highlightedIds,
    applyFilters,
    applyPreset,
    refresh,
    loadMore
  } = useEventsExplorer(authorizedFetch);
  const savedViews = useSavedEventViews();
  const healthSnapshot = useEventHealthSnapshot();

  const [activeSavedViewSlug, setActiveSavedViewSlug] = useState<string | null>(null);

  const [draftFilters, setDraftFilters] = useState<EventsExplorerFilters>(filters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [schemaBrowserOpen, setSchemaBrowserOpen] = useState(false);

  useEffect(() => {
    setDraftFilters(filters);
    setSchemaBrowserOpen(false);
  }, [filters]);

  useEffect(() => {
    if (savedViews.savedViews.length === 0) {
      setActiveSavedViewSlug((current) => (current !== null ? null : current));
      return;
    }
    const match = savedViews.savedViews.find((view) => filtersMatchSavedView(filters, view.filters));
    setActiveSavedViewSlug((current) => {
      const next = match ? match.slug : null;
      return next === current ? current : next;
    });
  }, [filters, savedViews.savedViews]);

  const selectedEvent = useMemo(() => events.find((event) => event.id === selectedId) ?? null, [events, selectedId]);

  useEffect(() => {
    if (selectedId && !events.some((event) => event.id === selectedId)) {
      setSelectedId(null);
    }
  }, [events, selectedId]);

  const handleApply = async () => {
    setSelectedId(null);
    setActiveSavedViewSlug(null);
    await applyFilters(draftFilters);
  };

  const handleReset = async () => {
    const next = { ...DEFAULT_EVENTS_FILTERS };
    setDraftFilters(next);
    setSelectedId(null);
    setActiveSavedViewSlug(null);
    await applyFilters(next);
  };

  const handlePreset = async (presetId: string) => {
    setSelectedId(null);
    setActiveSavedViewSlug(null);
    await applyPreset(presetId);
  };

  const handleCreateSavedView = async (input: {
    name: string;
    description: string | null;
    visibility: 'private' | 'shared';
  }) => {
    const record = await savedViews.createSavedView({
      name: input.name,
      description: input.description ?? null,
      visibility: input.visibility,
      filters: toSavedViewFilters(draftFilters)
    });
    setActiveSavedViewSlug(record.slug);
  };

  const handleApplySavedView = async (view: EventSavedViewRecord) => {
    const nextFilters = fromSavedViewFilters(view.filters);
    setDraftFilters(nextFilters);
    setSelectedId(null);
    await applyFilters(nextFilters);
    await savedViews.applySavedView(view.slug);
    setActiveSavedViewSlug(view.slug);
  };

  const handleRenameSavedView = async (view: EventSavedViewRecord, nextName: string) => {
    await savedViews.updateSavedView(view.slug, { name: nextName });
  };

  const handleDeleteSavedView = async (view: EventSavedViewRecord) => {
    const deleted = await savedViews.deleteSavedView(view.slug);
    if (deleted && activeSavedViewSlug === view.slug) {
      setActiveSavedViewSlug(null);
    }
  };

  const handleShareSavedView = async (view: EventSavedViewRecord) => {
    await savedViews.shareSavedView(view.slug);
  };

  const handleRefresh = async () => {
    await refresh();
  };

  const handleLoadMore = async () => {
    await loadMore();
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className={PAGE_TITLE_CLASSES}>Events Explorer</h1>
          <p className={PAGE_SUBTITLE_CLASSES}>
            Inspect live platform events, filter by envelope metadata, and drill into payload details.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionBadge status={connectionStatus} refreshing={refreshing} />
          <button
            type="button"
            onClick={handleRefresh}
            className={`${SECONDARY_PILL_BUTTON} px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60`}
            disabled={loading}
          >
            Refresh feed
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-6 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <EventsFilterBar
            presets={presets}
            activePresetId={activePresetId}
            draftFilters={draftFilters}
            schema={schema}
            onChange={setDraftFilters}
            onApply={handleApply}
            onReset={handleReset}
            onPresetSelect={handlePreset}
            onOpenSchemaBrowser={() => setSchemaBrowserOpen(true)}
          />

          <SavedEventViewsPanel
            savedViews={savedViews.savedViews}
            loading={savedViews.loading}
            error={savedViews.error}
            mutationState={savedViews.mutationState}
            viewerSubject={savedViews.viewerSubject}
            onCreate={handleCreateSavedView}
            onApply={handleApplySavedView}
            onRename={handleRenameSavedView}
            onDelete={handleDeleteSavedView}
            onShare={handleShareSavedView}
            activeSlug={activeSavedViewSlug}
          />

          {error ? (
            <div className="rounded-2xl border border-status-danger bg-status-danger-soft px-4 py-3 text-scale-sm text-status-danger">
              {error}
            </div>
          ) : null}

          <EventsExplorerList
            events={events}
            highlightedIds={highlightedIds}
            selectedId={selectedId}
            connectionStatus={connectionStatus}
            loading={loading}
            refreshing={refreshing}
            onSelect={(event) => setSelectedId(event.id)}
          />

          <div className="flex flex-col items-center gap-4">
            {hasMore ? (
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className={`${SECONDARY_PILL_BUTTON} px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {loadingMore ? 'Loading…' : 'Load older events'}
              </button>
            ) : null}
          </div>
        </div>

        <EventsHealthRail
          health={healthSnapshot.health}
          loading={healthSnapshot.loading}
          refreshing={healthSnapshot.refreshing}
          error={healthSnapshot.error}
          lastUpdatedAt={healthSnapshot.lastUpdatedAt}
          onRefresh={() => {
            void healthSnapshot.refresh();
          }}
        />
      </div>

      <EventDetailDrawer event={selectedEvent} open={selectedEvent !== null} onClose={() => setSelectedId(null)} />

      <SchemaBrowser
        schema={schema}
        open={schemaBrowserOpen}
        onClose={() => setSchemaBrowserOpen(false)}
        onApply={(jsonPath) => {
          setDraftFilters((current) => ({ ...current, jsonPath }));
          setSchemaBrowserOpen(false);
        }}
      />
    </div>
  );
}

function EventsFilterBar({
  presets,
  activePresetId,
  draftFilters,
  schema,
  onChange,
  onApply,
  onReset,
  onPresetSelect,
  onOpenSchemaBrowser
}: EventsFilterBarProps) {
  const jsonPathSuggestions = useMemo(() => schema?.fields.map((field) => field.jsonPath) ?? [], [schema]);

  const handleInputChange = (key: keyof EventsExplorerFilters, value: string) => {
    onChange({ ...draftFilters, [key]: value });
  };

  const toggleSeverity = (severity: (typeof EVENTS_SEVERITIES)[number]) => {
    onChange({
      ...draftFilters,
      severity: draftFilters.severity.includes(severity)
        ? draftFilters.severity.filter((entry) => entry !== severity)
        : [...draftFilters.severity, severity]
    });
  };

  return (
    <section className={SECTION_CONTAINER}>
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => {
              void onPresetSelect(preset.id);
            }}
            className={`${GHOST_PILL_BUTTON} px-3 py-1 ${
              activePresetId === preset.id ? PRESET_ACTIVE_CLASSES : `${PRESET_INACTIVE_CLASSES}`
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className={INPUT_LABEL_CLASSES}>
          Event type
          <input
            type="text"
            value={draftFilters.type}
            onChange={(event) => handleInputChange('type', event.target.value)}
            placeholder="metastore.record.updated"
            className={TEXT_INPUT_CLASSES}
          />
        </label>
        <label className={INPUT_LABEL_CLASSES}>
          Source
          <input
            type="text"
            value={draftFilters.source}
            onChange={(event) => handleInputChange('source', event.target.value)}
            placeholder="metastore.api"
            className={TEXT_INPUT_CLASSES}
          />
        </label>
        <label className={INPUT_LABEL_CLASSES}>
          Correlation ID
          <input
            type="text"
            value={draftFilters.correlationId}
            onChange={(event) => handleInputChange('correlationId', event.target.value)}
            placeholder="req-41ac2fd3"
            className={TEXT_INPUT_CLASSES}
          />
        </label>
        <label className={INPUT_LABEL_CLASSES}>
          From
          <input
            type="datetime-local"
            value={toLocalInputValue(draftFilters.from)}
            onChange={(event) => handleInputChange('from', fromLocalInputValue(event.target.value))}
            className={TEXT_INPUT_CLASSES}
          />
        </label>
        <label className={INPUT_LABEL_CLASSES}>
          To
          <input
            type="datetime-local"
            value={toLocalInputValue(draftFilters.to)}
            onChange={(event) => handleInputChange('to', fromLocalInputValue(event.target.value))}
            className={TEXT_INPUT_CLASSES}
          />
        </label>
        <label className={INPUT_LABEL_CLASSES}>
          JSONPath filter
          <input
            type="text"
            list="events-jsonpath-options"
            value={draftFilters.jsonPath}
            onChange={(event) => handleInputChange('jsonPath', event.target.value)}
            placeholder="$.payload.assetId"
            className={TEXT_INPUT_CLASSES}
          />
          <datalist id="events-jsonpath-options">
            {jsonPathSuggestions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {EVENTS_SEVERITIES.map((severity) => {
          const active = draftFilters.severity.includes(severity);
          return (
            <button
              key={severity}
              type="button"
              onClick={() => toggleSeverity(severity)}
              className={`${GHOST_PILL_BUTTON} px-3 py-1 capitalize ${
                active ? SEVERITY_ACTIVE_CLASSES[severity] ?? PRESET_ACTIVE_CLASSES : PRESET_INACTIVE_CLASSES
              }`}
            >
              {severity}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange({ ...draftFilters, severity: [] })}
          className={`${NEUTRAL_PILL_BUTTON} px-3 py-1`}
        >
          Clear severities
        </button>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            void onApply();
          }}
          className={`${PRIMARY_PILL_BUTTON} px-5 py-2`}
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={() => {
            void onReset();
          }}
          className={`${SECONDARY_PILL_BUTTON} px-4 py-2`}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => {
            if (schema) {
              onOpenSchemaBrowser();
            }
          }}
          disabled={!schema}
          className={`${SECONDARY_PILL_BUTTON} px-4 py-2 disabled:cursor-not-allowed disabled:opacity-60`}
        >
          Browse schema
        </button>
      </div>
    </section>
  );
}

function EventsExplorerList({
  events,
  highlightedIds,
  selectedId,
  connectionStatus,
  loading,
  refreshing,
  onSelect
}: EventsExplorerListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 80,
    overscan: 12
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-scale-lg font-weight-semibold text-primary">Live events</h2>
        <div className="flex items-center gap-2 text-scale-xs text-muted">
          {refreshing ? (
            <span className="inline-flex items-center gap-2">
              <Spinner size="xs" /> Refreshing…
            </span>
          ) : (
            <span>{connectionStatus === 'connected' ? 'Streaming in real time' : 'Polling for updates'}</span>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className="h-[28rem] overflow-y-auto rounded-3xl border border-subtle bg-surface-glass-soft shadow-inner"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 py-6 text-scale-sm text-muted">
            No events match the current filters.
          </div>
        ) : (
          <div
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
            className="w-full"
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow: VirtualItem) => {
              const event = events[virtualRow.index];
              const isSelected = event.id === selectedId;
              const isHighlighted = highlightedIds.has(event.id);
              return (
                <article
                  key={virtualRow.key}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  className={`cursor-pointer border-b border-subtle px-6 py-4 transition ${
                    isSelected ? 'bg-accent-soft shadow-elevation-sm' : 'bg-transparent'
                  } ${isHighlighted ? 'shadow-[0_0_0_2px_var(--color-accent-default)]' : ''}`}
                  onClick={() => onSelect(event)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={event.severity} />
                      <h3 className="text-scale-sm font-weight-semibold text-primary">{event.type}</h3>
                      {isHighlighted ? (
                        <span className="rounded-full bg-status-success-soft px-2 py-0.5 text-[10px] font-weight-semibold uppercase tracking-wide text-status-success">
                          New
                        </span>
                      ) : null}
                    </div>
                    <span className="text-scale-xs text-muted">{formatDateTime(event.occurredAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-scale-xs text-muted">
                    <span className="rounded-full bg-surface-glass px-2 py-0.5 text-secondary">{event.source}</span>
                    {event.correlationId ? <span>Correlation: {event.correlationId}</span> : null}
                    <span>Received: {formatDateTime(event.receivedAt)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function SeverityBadge({ severity }: { severity: WorkflowEventSample['severity'] }) {
  if (!severity) {
    return null;
  }
  const classes = SEVERITY_BADGE_CLASSES[severity] ?? 'bg-status-neutral text-status-neutral-on';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-weight-semibold uppercase tracking-wide ${classes}`}>
      {severity}
    </span>
  );
}

function EventDetailDrawer({ event, open, onClose }: EventDetailDrawerProps) {
  return (
    <Modal open={open} onClose={onClose} contentClassName="max-w-4xl">
      {event ? (
        <div className="flex max-h-[80vh] flex-col gap-4 overflow-hidden p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={event.severity} />
                <h2 className="text-scale-lg font-weight-semibold text-primary">{event.type}</h2>
              </div>
              <p className="text-scale-xs text-muted">
                {event.source} · {formatDateTime(event.occurredAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className={`${NEUTRAL_PILL_BUTTON} px-3 py-1`}
            >
              Close
            </button>
          </div>

          <div className="grid gap-3 text-scale-xs text-secondary md:grid-cols-2">
            <div className={DATA_PANEL_CLASSES}>
              <h3 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">Envelope</h3>
              <dl className="mt-2 space-y-1">
                <div>
                  <dt className="font-weight-semibold text-secondary">Event ID</dt>
                  <dd className="break-all text-muted">{event.id}</dd>
                </div>
                <div>
                  <dt className="font-weight-semibold text-secondary">Source</dt>
                  <dd>{event.source}</dd>
                </div>
                {event.correlationId ? (
                  <div>
                    <dt className="font-weight-semibold text-secondary">Correlation</dt>
                    <dd className="break-all text-muted">{event.correlationId}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-weight-semibold text-secondary">Occurred</dt>
                  <dd>{formatDateTime(event.occurredAt)}</dd>
                </div>
                <div>
                  <dt className="font-weight-semibold text-secondary">Received</dt>
                  <dd>{formatDateTime(event.receivedAt)}</dd>
                </div>
                {event.ttlMs !== null ? (
                  <div>
                    <dt className="font-weight-semibold text-secondary">TTL (ms)</dt>
                    <dd>{event.ttlMs}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <div className={DATA_PANEL_CLASSES}>
              <h3 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">Links</h3>
              {event.links ? (
                <pre className="mt-2 max-h-40 overflow-auto text-scale-xs text-secondary">
                  {JSON.stringify(event.links, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-scale-xs text-muted">No related resources recorded.</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 overflow-hidden">
            <h3 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">Payload</h3>
            <pre className="max-h-60 overflow-auto rounded-2xl border border-subtle bg-surface-glass-soft p-4 text-scale-xs text-primary">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>

          {event.metadata ? (
            <div className="flex flex-col gap-3 overflow-hidden">
              <h3 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">Metadata</h3>
              <pre className="max-h-40 overflow-auto rounded-2xl border border-subtle bg-surface-glass-soft p-4 text-scale-xs text-primary">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          ) : null}

          {event.derived ? (
            <div className="flex flex-col gap-3 overflow-hidden">
              <h3 className="text-scale-xs font-weight-semibold uppercase tracking-wide text-muted">Derived</h3>
              <pre className="max-h-40 overflow-auto rounded-2xl border border-subtle bg-surface-glass-soft p-4 text-scale-xs text-primary">
                {JSON.stringify(event.derived, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function SchemaBrowser({ schema, open, onClose, onApply }: SchemaBrowserProps) {
  return (
    <Modal open={open} onClose={onClose} contentClassName="max-w-5xl">
      <div className="flex max-h-[80vh] flex-col gap-4 overflow-hidden p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-scale-lg font-weight-semibold text-primary">Event schema</h2>
          <button
            type="button"
            onClick={onClose}
            className={`${NEUTRAL_PILL_BUTTON} px-3 py-1`}
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-hidden rounded-2xl border border-subtle bg-surface-glass">
          {schema ? (
            <EventSchemaExplorer
              schema={schema}
              onAddPredicate={({ path }) => {
                onApply(path);
                onClose();
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-scale-sm text-muted">
              Schema metadata is not available for the selected filters.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ConnectionBadge({
  status,
  refreshing
}: {
  status: AppHubConnectionStatus;
  refreshing: boolean;
}) {
  const label = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Offline';
  const baseClasses = `${GHOST_PILL_BUTTON} inline-flex items-center gap-2 px-3 py-1 text-scale-xs font-weight-semibold`;
  return (
    <span className={`${baseClasses} ${CONNECTION_BADGE_CLASSES[status]}`}>
      {refreshing ? <Spinner size="xs" /> : null}
      {label}
    </span>
  );
}

export default function EventsExplorerPage() {
  const moduleScope = useModuleScope();
  if (moduleScope.kind !== 'module' || moduleScope.loadingResources) {
    return <ModuleScopeGate resourceName="events" />;
  }
  return <EventsExplorerPageContent />;
}
