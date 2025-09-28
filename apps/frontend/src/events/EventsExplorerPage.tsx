import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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

export default function EventsExplorerPage() {
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
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">Events Explorer</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Inspect live platform events, filter by envelope metadata, and drill into payload details.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConnectionBadge status={connectionStatus} refreshing={refreshing} />
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded-full border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
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
            onApply={(view) => {
              void handleApplySavedView(view);
            }}
            onRename={(view, nextName) => {
              void handleRenameSavedView(view, nextName);
            }}
            onDelete={(view) => {
              void handleDeleteSavedView(view);
            }}
            onShare={(view) => {
              void handleShareSavedView(view);
            }}
            activeSlug={activeSavedViewSlug}
          />

          {error ? (
            <div className="rounded-2xl border border-rose-200/70 bg-rose-50/60 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-200">
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
                className="rounded-full border border-slate-200/70 px-5 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
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
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center gap-2">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
          onClick={() => {
            void onPresetSelect(preset.id);
          }}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
              activePresetId === preset.id
                ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/30'
                : 'border border-slate-200/70 text-slate-600 hover:bg-violet-50 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
          Event type
          <input
            type="text"
            value={draftFilters.type}
            onChange={(event) => handleInputChange('type', event.target.value)}
            placeholder="metastore.record.updated"
            className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
          Source
          <input
            type="text"
            value={draftFilters.source}
            onChange={(event) => handleInputChange('source', event.target.value)}
            placeholder="metastore.api"
            className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
          Correlation ID
          <input
            type="text"
            value={draftFilters.correlationId}
            onChange={(event) => handleInputChange('correlationId', event.target.value)}
            placeholder="req-41ac2fd3"
            className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
          From
          <input
            type="datetime-local"
            value={toLocalInputValue(draftFilters.from)}
            onChange={(event) => handleInputChange('from', fromLocalInputValue(event.target.value))}
            className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
          To
          <input
            type="datetime-local"
            value={toLocalInputValue(draftFilters.to)}
            onChange={(event) => handleInputChange('to', fromLocalInputValue(event.target.value))}
            className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
          />
        </label>
        <label className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
          JSONPath filter
          <input
            type="text"
            list="events-jsonpath-options"
            value={draftFilters.jsonPath}
            onChange={(event) => handleInputChange('jsonPath', event.target.value)}
            placeholder="$.payload.assetId"
            className="mt-1 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-200"
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
              className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                active
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/25'
                  : 'border border-slate-200/70 text-slate-600 hover:bg-indigo-50 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {severity}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange({ ...draftFilters, severity: [] })}
          className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
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
          className="rounded-full bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:bg-violet-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          Apply filters
        </button>
        <button
          type="button"
          onClick={() => {
            void onReset();
          }}
          className="rounded-full border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
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
          className="rounded-full border border-slate-200/70 px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
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
    estimateSize: () => 96,
    overscan: 12
  });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Live events</h2>
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
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
        className="h-[28rem] overflow-y-auto rounded-3xl border border-slate-200/70 bg-white/60 shadow-inner dark:border-slate-700/60 dark:bg-slate-900/60"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : events.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4 py-6 text-sm text-slate-500 dark:text-slate-400">
            No events match the current filters.
          </div>
        ) : (
          <div
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}
            className="w-full"
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
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
                  className={`cursor-pointer px-6 py-4 transition ${
                    isSelected
                      ? 'bg-violet-50/80 dark:bg-slate-800/80'
                      : 'border-b border-slate-200/70 dark:border-slate-800/60'
                  } ${isHighlighted ? 'shadow-[0_0_0_2px_rgba(129,140,248,0.6)]' : ''}`}
                  onClick={() => onSelect(event)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <SeverityBadge severity={event.severity} />
                      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{event.type}</h3>
                      {isHighlighted ? (
                        <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-200">
                          New
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(event.occurredAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{event.source}</span>
                    {event.correlationId ? <span>Correlation: {event.correlationId}</span> : null}
                    <span>Received: {formatDateTime(event.receivedAt)}</span>
                  </div>
                  <pre className="mt-2 max-h-24 overflow-hidden text-xs text-slate-600 dark:text-slate-300">
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
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
  const colorMap: Record<string, string> = {
    critical: 'bg-rose-600 text-white',
    error: 'bg-rose-500 text-white',
    warning: 'bg-amber-500 text-black',
    info: 'bg-sky-500 text-white',
    debug: 'bg-slate-500 text-white'
  };
  const classes = colorMap[severity] ?? 'bg-slate-500 text-white';
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classes}`}>{severity}</span>;
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
                <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{event.type}</h2>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {event.source} · {formatDateTime(event.occurredAt)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Close
            </button>
          </div>

          <div className="grid gap-3 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/60 dark:bg-slate-900">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Envelope</h3>
              <dl className="mt-2 space-y-1">
                <div>
                  <dt className="font-semibold">Event ID</dt>
                  <dd className="break-all text-slate-500 dark:text-slate-400">{event.id}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Source</dt>
                  <dd>{event.source}</dd>
                </div>
                {event.correlationId ? (
                  <div>
                    <dt className="font-semibold">Correlation</dt>
                    <dd className="break-all text-slate-500 dark:text-slate-400">{event.correlationId}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="font-semibold">Occurred</dt>
                  <dd>{formatDateTime(event.occurredAt)}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Received</dt>
                  <dd>{formatDateTime(event.receivedAt)}</dd>
                </div>
                {event.ttlMs !== null ? (
                  <div>
                    <dt className="font-semibold">TTL (ms)</dt>
                    <dd>{event.ttlMs}</dd>
                  </div>
                ) : null}
              </dl>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-white p-4 dark:border-slate-700/60 dark:bg-slate-900">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Links</h3>
              {event.links ? (
                <pre className="mt-2 max-h-40 overflow-auto text-xs text-slate-600 dark:text-slate-300">
                  {JSON.stringify(event.links, null, 2)}
                </pre>
              ) : (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">No related resources recorded.</p>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 overflow-hidden">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Payload</h3>
            <pre className="max-h-60 overflow-auto rounded-2xl border border-slate-200/70 bg-white p-4 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-300">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>

          {event.metadata ? (
            <div className="flex flex-col gap-3 overflow-hidden">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Metadata</h3>
              <pre className="max-h-40 overflow-auto rounded-2xl border border-slate-200/70 bg-white p-4 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-300">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          ) : null}

          {event.derived ? (
            <div className="flex flex-col gap-3 overflow-hidden">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Derived</h3>
              <pre className="max-h-40 overflow-auto rounded-2xl border border-slate-200/70 bg-white p-4 text-xs text-slate-700 dark:border-slate-700/60 dark:bg-slate-900 dark:text-slate-300">
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
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Event schema</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200/70 px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-hidden rounded-2xl border border-slate-200/70 bg-white dark:border-slate-700/60 dark:bg-slate-900">
          {schema ? (
            <EventSchemaExplorer
              schema={schema}
              onAddPredicate={({ path }) => {
                onApply(path);
                onClose();
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-sm text-slate-500 dark:text-slate-400">
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
  const baseClasses =
    'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500';
  const palette =
    status === 'connected'
      ? 'bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-200'
      : status === 'connecting'
      ? 'bg-amber-500/20 text-amber-600 dark:bg-amber-500/30 dark:text-amber-200'
      : 'bg-rose-500/20 text-rose-600 dark:bg-rose-500/30 dark:text-rose-200';
  return (
    <span className={`${baseClasses} ${palette}`}>
      {refreshing ? <Spinner size="xs" /> : null}
      {label}
    </span>
  );
}
