import classNames from 'classnames';
import { useMemo, useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { ReactFlowProvider } from 'reactflow';
import WorkflowGraphCanvas, {
  type WorkflowGraphCanvasThemeOverrides,
  type WorkflowGraphCanvasNodeData
} from './WorkflowGraphCanvas';
import type {
  WorkflowGraphFetchMeta,
  WorkflowGraphLiveOverlay,
  WorkflowGraphNormalized,
  WorkflowGraphOverlayMeta
} from '../graph';
import type { WorkflowGraphCanvasFilters } from '../graph/canvasModel';
import { ROUTE_PATHS } from '../../routes/paths';
import { useIsDarkMode } from '../../hooks/useIsDarkMode';
import { getStatusToneClasses } from '../../theme/statusTokens';

type WorkflowTopologyPanelProps = {
  graph: WorkflowGraphNormalized | null;
  graphLoading: boolean;
  graphRefreshing: boolean;
  graphError: string | null;
  graphStale: boolean;
  lastLoadedAt: string | null;
  meta: WorkflowGraphFetchMeta | null;
  overlay: WorkflowGraphLiveOverlay | null;
  overlayMeta: WorkflowGraphOverlayMeta | null;
  onRefresh: () => void;
  selection?: {
    workflowId?: string | null;
  };
};

const PANEL_THEME_LIGHT: WorkflowGraphCanvasThemeOverrides = {
  surface: 'rgba(255, 255, 255, 0.94)',
  surfaceMuted: 'rgba(248, 250, 252, 0.8)'
};

const PANEL_THEME_DARK: WorkflowGraphCanvasThemeOverrides = {
  surface: 'rgba(15, 23, 42, 0.78)',
  surfaceMuted: 'rgba(15, 23, 42, 0.62)'
};

const LIVE_STALE_THRESHOLD_MS = 90_000;
type StatusLegendTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const STATUS_LEGEND_ITEMS: Array<{ label: string; tone: StatusLegendTone }> = [
  { label: 'Running / Pending', tone: 'info' },
  { label: 'Succeeded / Fresh / Active', tone: 'success' },
  { label: 'Degraded / Stale / Throttled', tone: 'warning' },
  { label: 'Failed / Failing', tone: 'danger' },
  { label: 'Idle / Unknown', tone: 'neutral' }
];

const TONE_TO_STATUS: Record<StatusLegendTone, string> = {
  neutral: 'unknown',
  info: 'running',
  success: 'success',
  warning: 'warning',
  danger: 'error'
};

const PANEL_CONTAINER_CLASSES =
  'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-xl backdrop-blur-md transition-colors';

const HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const HEADER_SUBTEXT_CLASSES = 'text-scale-xs text-muted';

const STATUS_COLUMN_CLASSES = 'flex flex-col text-right text-[11px] text-secondary';

const STATUS_COLUMN_LABEL_CLASSES = 'font-weight-semibold uppercase tracking-[0.22em] text-muted';

const STATUS_COLUMN_VALUE_CLASSES = 'text-secondary';

const STATUS_COLUMN_META_CLASSES = 'text-[10px] tracking-[0.16em] text-muted';

const STATUS_BADGE_BASE_CLASSES =
  'inline-flex items-center justify-end rounded-full border px-2 py-[1px] text-[10px] font-weight-semibold uppercase tracking-wide';

const REFRESH_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-accent bg-accent px-4 py-2 text-scale-xs font-weight-semibold text-inverse shadow-elevation-md transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const FULLSCREEN_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.18em] text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft/50 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';
const FULLSCREEN_FLOATING_BUTTON_CLASSES =
  'absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.18em] text-secondary shadow-elevation-lg hover:border-accent-soft hover:bg-accent-soft/50 hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const STAT_BADGE_CONTAINER_CLASSES =
  'inline-flex min-w-[96px] flex-col items-center rounded-xl border border-subtle bg-surface-glass-soft px-3 py-2 text-[11px] font-weight-semibold leading-4 text-secondary';

const STAT_BADGE_VALUE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const STAT_BADGE_LABEL_CLASSES = 'uppercase tracking-[0.22em] text-[10px] text-muted';

const CACHE_BADGE_CLASSES =
  'ml-auto inline-flex items-center rounded-full border border-subtle bg-surface-glass-soft px-3 py-1 text-[10px] font-weight-semibold uppercase tracking-[0.22em] text-muted';

const LEGEND_CONTAINER_CLASSES =
  'flex flex-wrap items-center gap-2 text-[10px] font-weight-semibold uppercase tracking-[0.18em] text-muted';

const LEGEND_LABEL_CLASSES = 'mr-1 text-muted';

const LEGEND_BADGE_BASE_CLASSES =
  'inline-flex items-center rounded-full border px-2 py-[1px] text-[10px] font-weight-semibold tracking-wide';

const FILTER_FIELDSET_CLASSES = 'flex flex-col text-scale-xs font-weight-semibold text-secondary';

const FILTER_LABEL_CLASSES = 'mb-1 uppercase tracking-[0.18em] text-[10px] text-muted';

const FILTER_CONTROL_BASE_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass px-3 py-2 text-scale-xs font-weight-semibold text-secondary shadow-inner transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted disabled:opacity-60';

const CLEAR_FILTERS_BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.18em] text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50';

const DETAIL_EMPTY_CLASSES =
  'flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-subtle bg-surface-glass-soft p-4 text-center text-scale-xs font-weight-semibold text-muted';

const DETAIL_CONTAINER_CLASSES =
  'flex min-h-[200px] flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-lg backdrop-blur-md transition-colors';

const DETAIL_HEADER_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const DETAIL_HEADER_SUBTITLE_CLASSES = 'text-scale-xs text-muted';

const DETAIL_BADGE_CLASSES =
  'inline-flex items-center rounded-full bg-accent-soft px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-wide text-accent';

const DETAIL_DESCRIPTION_CLASSES = 'text-scale-xs leading-relaxed text-secondary';

const DETAIL_HIGHLIGHTS_CLASSES = 'mt-1 space-y-1 text-[11px] text-muted';

const DETAIL_FIELDS_CLASSES = 'mt-2 space-y-2 text-scale-xs text-secondary';

const DETAIL_FIELD_LABEL_CLASSES = 'uppercase tracking-[0.18em] text-[10px] text-muted';

const DETAIL_ACTION_BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-accent bg-accent px-3 py-1 text-[11px] font-weight-semibold text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function formatTimestamp(ts: string | null): string {
  if (!ts) {
    return '—';
  }
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return `${date.toLocaleDateString()} • ${date.toLocaleTimeString()}`;
}

function StatBadge({ label, value }: { label: string; value: number }) {
  return (
    <span className={STAT_BADGE_CONTAINER_CLASSES}>
      <span className={STAT_BADGE_VALUE_CLASSES}>{value}</span>
      <span className={STAT_BADGE_LABEL_CLASSES}>
        {label}
      </span>
    </span>
  );
}

export function WorkflowTopologyPanel({
  graph,
  graphLoading,
  graphRefreshing,
  graphError,
  graphStale,
  lastLoadedAt,
  meta,
  overlay,
  overlayMeta,
  onRefresh,
  selection
}: WorkflowTopologyPanelProps) {
  const graphContainerRef = useRef<HTMLDivElement | null>(null);
  const isDarkMode = useIsDarkMode();
  const panelTheme = isDarkMode ? PANEL_THEME_DARK : PANEL_THEME_LIGHT;
  const stats = graph?.stats ?? null;
  const cacheStats = meta?.cache?.stats ?? null;
  let cacheHitRate: number | null = null;
  if (cacheStats) {
    const total = cacheStats.hits + cacheStats.misses;
    if (total > 0) {
      cacheHitRate = cacheStats.hits / total;
    }
  }
  const cacheAgeSeconds = meta?.cache?.ageMs !== null && meta?.cache?.ageMs !== undefined
    ? Math.round(meta.cache.ageMs / 1000)
    : null;

  const lastProcessedIso = overlayMeta?.lastProcessedAt
    ? new Date(overlayMeta.lastProcessedAt).toISOString()
    : null;
  const lastEventIso = overlayMeta?.lastEventAt ? new Date(overlayMeta.lastEventAt).toISOString() : null;
  const liveLagMs = overlayMeta?.lastProcessedAt ? Date.now() - overlayMeta.lastProcessedAt : null;
  const liveStale = liveLagMs === null || liveLagMs > LIVE_STALE_THRESHOLD_MS;
  const liveTone: 'success' | 'warning' | 'neutral' = liveStale ? 'warning' : 'success';
  const liveStatusLabel = liveStale ? 'Live updates delayed' : 'Live feed active';
  const processedLabel = formatTimestamp(lastProcessedIso);
  const liveStatusDetail = processedLabel !== '—' ? `Updated ${processedLabel}` : 'No live events yet';
  const lastEventLabel = formatTimestamp(lastEventIso);
  const droppedEvents = overlayMeta?.droppedEvents ?? 0;
  const overlayQueueSize = overlayMeta?.queueSize ?? 0;

  const statusMessage = useMemo(() => {
    if (graphError) {
      return 'Topology fetch failed';
    }
    if (graphRefreshing) {
      return 'Refreshing…';
    }
    if (graphStale) {
      return 'Awaiting new snapshot';
    }
    return 'Up to date';
  }, [graphError, graphRefreshing, graphStale]);

  const selectionProps = selection?.workflowId ? { selection: { workflowId: selection.workflowId } } : {};

  const [searchTermLocal, setSearchTermLocal] = useState('');
  const [filtersState, setFiltersState] = useState<WorkflowGraphCanvasFilters>({});
  const [selectedNode, setSelectedNode] = useState<WorkflowGraphCanvasNodeData | null>(null);

  const workflowFilterOptions = useMemo(() => {
    if (!graph) {
      return [] as Array<{ id: string; name: string; slug: string }>;
    }
    return graph.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      slug: workflow.slug
    }));
  }, [graph]);

  const assetFilterOptions = useMemo(() => {
    if (!graph) {
      return [] as Array<{ id: string; label: string }>;
    }
    return graph.assets.map((asset) => ({
      id: asset.normalizedAssetId,
      label: asset.assetId
    }));
  }, [graph]);

  const eventTypeFilterOptions = useMemo(() => {
    if (!graph) {
      return [] as string[];
    }
    const eventTypes = new Set<string>();
    for (const trigger of graph.triggers) {
      if (trigger.kind === 'event' && trigger.eventType) {
        eventTypes.add(trigger.eventType);
      }
    }
    for (const source of graph.eventSources) {
      if (source.eventType) {
        eventTypes.add(source.eventType);
      }
    }
    return Array.from(eventTypes).sort((a, b) => a.localeCompare(b));
  }, [graph]);

  const updateFilters = useCallback(
    <K extends keyof WorkflowGraphCanvasFilters>(key: K, values: string[]) => {
      setFiltersState((previous) => {
        const next: WorkflowGraphCanvasFilters = { ...previous };
        if (values.length > 0) {
          next[key] = values;
        } else {
          delete next[key];
        }
        return next;
      });
    },
    []
  );

  const canvasFilters = useMemo(() => {
    const { workflowIds, assetNormalizedIds, eventTypes } = filtersState;
    if (
      (workflowIds?.length ?? 0) === 0 &&
      (assetNormalizedIds?.length ?? 0) === 0 &&
      (eventTypes?.length ?? 0) === 0
    ) {
      return undefined;
    }
    return filtersState;
  }, [filtersState]);

  const canvasSearchTerm = searchTermLocal.trim().length > 0 ? searchTermLocal : null;
  const hasActiveFilters = Boolean(canvasFilters);
  const searchIsActive = canvasSearchTerm !== null;
  const clearDisabled = !hasActiveFilters && !searchIsActive;

  useEffect(() => {
    setSelectedNode(null);
  }, [graph]);

  useEffect(() => {
    setSelectedNode(null);
  }, [filtersState, canvasSearchTerm]);

  const handleSearchChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSearchTermLocal(event.target.value);
  }, []);

  const handleWorkflowFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
      updateFilters('workflowIds', values);
    },
    [updateFilters]
  );

  const handleAssetFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
      updateFilters('assetNormalizedIds', values);
    },
    [updateFilters]
  );

  const handleEventTypeFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const values = Array.from(event.target.selectedOptions).map((option) => option.value);
      updateFilters('eventTypes', values);
    },
    [updateFilters]
  );

  const handleClearFilters = useCallback(() => {
    setFiltersState({});
    setSearchTermLocal('');
    setSelectedNode(null);
  }, []);

  const handleCanvasNodeSelect = useCallback((_: string, data: WorkflowGraphCanvasNodeData) => {
    setSelectedNode(data);
  }, []);

  const handleCanvasClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const multiSelectSize = (length: number) => Math.min(4, Math.max(3, length || 3));

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(true);

  useEffect(() => {
    if (typeof document === 'undefined') {
      setFullscreenSupported(false);
      return;
    }

    setFullscreenSupported(document.fullscreenEnabled ?? true);

    const handleFullscreenChange = () => {
      const element = graphContainerRef.current;
      if (!element) {
        setIsFullscreen(Boolean(document.fullscreenElement));
        return;
      }
      setIsFullscreen(document.fullscreenElement === element);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') {
      return;
    }
    if (isFullscreen) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    const element = graphContainerRef.current;
    if (!element) {
      return;
    }
    element.requestFullscreen?.().catch(() => {});
  }, [isFullscreen]);

  return (
    <section className={PANEL_CONTAINER_CLASSES}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className={HEADER_TITLE_CLASSES}>Workflow Topology Explorer</h2>
          <p className={HEADER_SUBTEXT_CLASSES}>
            Interactive canvas combining workflows, steps, triggers, assets, and event sources.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className={STATUS_COLUMN_CLASSES}>
            <span className={STATUS_COLUMN_LABEL_CLASSES}>Status</span>
            <span className={STATUS_COLUMN_VALUE_CLASSES}>{statusMessage}</span>
            <span className={STATUS_COLUMN_META_CLASSES}>{formatTimestamp(lastLoadedAt)}</span>
            <span className={classNames('mt-3', STATUS_COLUMN_LABEL_CLASSES)}>Live Data</span>
            <span
              className={classNames(
                STATUS_BADGE_BASE_CLASSES,
                getStatusToneClasses(TONE_TO_STATUS[liveTone])
              )}
              title={liveStatusDetail}
            >
              {liveStatusLabel}
            </span>
            <span className={STATUS_COLUMN_META_CLASSES}>
              {liveStatusDetail}
              {lastEventLabel !== '—' ? ` • Last event ${lastEventLabel}` : ''}
            </span>
            <span className={STATUS_COLUMN_META_CLASSES}>
              Stream queue · {overlayQueueSize}
            </span>
            {droppedEvents > 0 && (
              <span className="text-[10px] font-weight-semibold text-status-warning">
                Dropped {droppedEvents} events
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={graphRefreshing}
            className={REFRESH_BUTTON_CLASSES}
          >
            {graphRefreshing ? (
              <span
                className="h-3 w-3 animate-spin rounded-full border-2 border-current border-b-transparent opacity-80"
                aria-hidden="true"
              />
            ) : (
              <span aria-hidden="true">⟳</span>
            )}
            Refresh
          </button>
          {fullscreenSupported && (
            <button
              type="button"
              onClick={handleToggleFullscreen}
              className={FULLSCREEN_BUTTON_CLASSES}
            >
              <span aria-hidden="true">{isFullscreen ? '⤫' : '⤢'}</span>
              {isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            </button>
          )}
        </div>
      </header>

      {stats && (
        <div className="flex flex-wrap items-center gap-3">
          <StatBadge label="Workflows" value={stats.totalWorkflows} />
          <StatBadge label="Steps" value={stats.totalSteps} />
          <StatBadge label="Triggers" value={stats.totalTriggers} />
          <StatBadge label="Schedules" value={stats.totalSchedules} />
          <StatBadge label="Assets" value={stats.totalAssets} />
          <StatBadge label="Sources" value={stats.totalEventSources} />
          {(cacheHitRate !== null || cacheAgeSeconds !== null) && (
            <span className={CACHE_BADGE_CLASSES}>
              Cache {cacheHitRate !== null ? `${Math.round(cacheHitRate * 100)}% hit` : 'primed'} ·{' '}
              {cacheAgeSeconds !== null ? `${Math.round(cacheAgeSeconds)}s old` : 'fresh'}
            </span>
          )}
        </div>
      )}

      <div className={LEGEND_CONTAINER_CLASSES}>
        <span className={LEGEND_LABEL_CLASSES}>Legend</span>
        {STATUS_LEGEND_ITEMS.map(({ label, tone }) => (
          <span
            key={tone}
            className={classNames(LEGEND_BADGE_BASE_CLASSES, getStatusToneClasses(TONE_TO_STATUS[tone]))}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="mt-2 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className={FILTER_FIELDSET_CLASSES}>
            <label className={FILTER_LABEL_CLASSES} htmlFor="topology-search-input">
              Search
            </label>
            <input
              id="topology-search-input"
              type="search"
              value={searchTermLocal}
              onChange={handleSearchChange}
              placeholder="Search nodes"
              className={classNames('min-w-[200px]', FILTER_CONTROL_BASE_CLASSES)}
            />
          </div>

          <div className={FILTER_FIELDSET_CLASSES}>
            <label className={FILTER_LABEL_CLASSES} htmlFor="topology-workflow-filter">
              Workflows
            </label>
            <select
              id="topology-workflow-filter"
              multiple
              value={filtersState.workflowIds ?? []}
              onChange={handleWorkflowFilterChange}
              size={multiSelectSize(workflowFilterOptions.length)}
              disabled={workflowFilterOptions.length === 0}
              className={classNames('min-w-[180px]', FILTER_CONTROL_BASE_CLASSES)}
            >
              {workflowFilterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <div className={FILTER_FIELDSET_CLASSES}>
            <label className={FILTER_LABEL_CLASSES} htmlFor="topology-asset-filter">
              Assets
            </label>
            <select
              id="topology-asset-filter"
              multiple
              value={filtersState.assetNormalizedIds ?? []}
              onChange={handleAssetFilterChange}
              size={multiSelectSize(assetFilterOptions.length)}
              disabled={assetFilterOptions.length === 0}
              className={classNames('min-w-[200px]', FILTER_CONTROL_BASE_CLASSES)}
            >
              {assetFilterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className={FILTER_FIELDSET_CLASSES}>
            <label className={FILTER_LABEL_CLASSES} htmlFor="topology-event-type-filter">
              Event Types
            </label>
            <select
              id="topology-event-type-filter"
              multiple
              value={filtersState.eventTypes ?? []}
              onChange={handleEventTypeFilterChange}
              size={multiSelectSize(eventTypeFilterOptions.length)}
              disabled={eventTypeFilterOptions.length === 0}
              className={classNames('min-w-[200px]', FILTER_CONTROL_BASE_CLASSES)}
            >
              {eventTypeFilterOptions.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {eventType}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handleClearFilters}
            disabled={clearDisabled}
            className={CLEAR_FILTERS_BUTTON_CLASSES}
          >
            Clear Filters
          </button>
        </div>

        <ReactFlowProvider>
          <div
            ref={graphContainerRef}
            className={classNames(
              'relative grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]',
              isFullscreen && 'h-full w-full lg:grid-cols-[minmax(0,1fr)]'
            )}
          >
            {isFullscreen && (
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className={FULLSCREEN_FLOATING_BUTTON_CLASSES}
                aria-label="Exit fullscreen"
              >
                <span aria-hidden="true">⤫</span>
                Exit Fullscreen
              </button>
            )}
            <WorkflowGraphCanvas
              graph={graph}
              loading={graphLoading || graphRefreshing}
              error={graphError}
              theme={panelTheme}
              height={isFullscreen ? '100vh' : 640}
              filters={canvasFilters}
              searchTerm={canvasSearchTerm}
              onNodeSelect={handleCanvasNodeSelect}
              onCanvasClick={handleCanvasClick}
              overlay={overlay ?? null}
              {...selectionProps}
            />
            {!isFullscreen && (
              <WorkflowTopologyNodeDetails graph={graph} node={selectedNode} onClear={handleCanvasClick} />
            )}
          </div>
        </ReactFlowProvider>
      </div>
    </section>
  );
}

export default WorkflowTopologyPanel;

type NodeDetailField = {
  label: string;
  value: string;
};

type NodeDetailAction = {
  label: string;
  to: string;
};

type NodeDetail = {
  title: string;
  subtitle?: string;
  description?: string | null;
  badges: string[];
  highlights: string[];
  fields: NodeDetailField[];
  actions: NodeDetailAction[];
};

function formatDetailTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleString();
}

function mergeBadges(existing: string[] | undefined, extra: string[]): string[] {
  const all = new Set<string>();
  for (const badge of existing ?? []) {
    if (badge) {
      all.add(badge);
    }
  }
  for (const badge of extra) {
    if (badge) {
      all.add(badge);
    }
  }
  return Array.from(all);
}

function buildNodeDetails(
  graph: WorkflowGraphNormalized | null,
  node: WorkflowGraphCanvasNodeData | null
): NodeDetail | null {
  if (!graph || !node) {
    return null;
  }

  switch (node.kind) {
    case 'workflow': {
      const workflow = graph.workflowsIndex.byId[node.refId];
      if (!workflow) {
        return null;
      }
      const fields: NodeDetailField[] = [
        { label: 'Slug', value: workflow.slug },
        { label: 'Version', value: `v${workflow.version}` }
      ];
      const updated = formatDetailTimestamp(workflow.updatedAt);
      if (updated) {
        fields.push({ label: 'Updated', value: updated });
      }
      if (workflow.annotations?.ownerName) {
        fields.push({ label: 'Owner', value: workflow.annotations.ownerName });
      }
      if (workflow.annotations?.ownerContact) {
        fields.push({ label: 'Contact', value: workflow.annotations.ownerContact });
      }
      if (workflow.annotations?.tags?.length) {
        fields.push({ label: 'Tags', value: workflow.annotations.tags.join(', ') });
      }
      const actions: NodeDetailAction[] = [
        { label: 'Open workflow', to: `${ROUTE_PATHS.workflows}?slug=${workflow.slug}` },
        { label: 'View runs', to: ROUTE_PATHS.runs }
      ];
      const badges = mergeBadges(node.badges, [workflow.annotations?.domain ?? ''].filter(Boolean));
      return {
        title: workflow.name,
        subtitle: workflow.slug,
        description: workflow.description,
        badges,
        highlights: node.meta,
        fields: fields.filter((field) => Boolean(field.value)),
        actions
      } satisfies NodeDetail;
    }
    case 'step-job':
    case 'step-service':
    case 'step-fanout': {
      const step = graph.stepsIndex.byId[node.refId];
      if (!step) {
        return null;
      }
      const workflow = graph.workflowsIndex.byId[step.workflowId];
      const fields: NodeDetailField[] = [];
      if (workflow) {
        fields.push({ label: 'Workflow', value: workflow.name });
      }
      fields.push({ label: 'Type', value: step.type });
      if (step.runtime.type === 'job' && step.runtime.jobSlug) {
        fields.push({ label: 'Job slug', value: step.runtime.jobSlug });
      }
      if (step.runtime.type === 'service' && step.runtime.serviceSlug) {
        fields.push({ label: 'Service slug', value: step.runtime.serviceSlug });
      }
      if (step.runtime.type === 'fanout') {
        const templateType = step.runtime.template?.runtime.type;
        if (templateType) {
          fields.push({ label: 'Template runtime', value: templateType });
        }
        if (typeof step.runtime.maxConcurrency === 'number') {
          fields.push({ label: 'Max concurrency', value: String(step.runtime.maxConcurrency) });
        }
      }
      const actions: NodeDetailAction[] = [];
      if (workflow) {
        actions.push({ label: 'View workflow', to: `${ROUTE_PATHS.workflows}?slug=${workflow.slug}` });
      }
      actions.push({ label: 'View runs', to: ROUTE_PATHS.runs });
      return {
        title: step.name,
        subtitle: step.type,
        description: step.description,
        badges: node.badges ?? [],
        highlights: node.meta,
        fields: fields.filter((field) => Boolean(field.value)),
        actions
      } satisfies NodeDetail;
    }
    case 'trigger-event':
    case 'trigger-definition': {
      const trigger = graph.triggersIndex.byId[node.refId];
      if (!trigger) {
        return null;
      }
      const workflow = graph.workflowsIndex.byId[trigger.workflowId];
      const fields: NodeDetailField[] = [];
      if (workflow) {
        fields.push({ label: 'Workflow', value: workflow.name });
      }
      if (trigger.kind === 'event') {
        fields.push({ label: 'Event type', value: trigger.eventType });
        if (trigger.eventSource) {
          fields.push({ label: 'Source', value: trigger.eventSource });
        }
        fields.push({ label: 'Status', value: trigger.status });
        if (trigger.maxConcurrency) {
          fields.push({ label: 'Max concurrency', value: String(trigger.maxConcurrency) });
        }
        if (trigger.throttleWindowMs && trigger.throttleCount) {
          fields.push({
            label: 'Throttle',
            value: `${trigger.throttleCount} in ${trigger.throttleWindowMs}ms`
          });
        }
      } else {
        fields.push({ label: 'Trigger type', value: trigger.triggerType });
        if (trigger.schedule) {
          fields.push({ label: 'Cron', value: trigger.schedule.cron });
          if (trigger.schedule.timezone) {
            fields.push({ label: 'Timezone', value: trigger.schedule.timezone });
          }
        }
      }
      const updated = 'updatedAt' in trigger ? formatDetailTimestamp(trigger.updatedAt) : null;
      if (updated) {
        fields.push({ label: 'Updated', value: updated });
      }
      const actions: NodeDetailAction[] = [];
      if (workflow) {
        const base = `${ROUTE_PATHS.workflows}?slug=${workflow.slug}`;
        actions.push({ label: 'View workflow', to: base });
        actions.push({ label: 'Workflow triggers', to: `${base}#triggers` });
      }
      const title = trigger.kind === 'event' ? trigger.name ?? trigger.id : trigger.triggerType;

      return {
        title,
        subtitle: node.subtitle,
        description: 'description' in trigger ? trigger.description ?? null : null,
        badges: node.badges ?? [],
        highlights: node.meta,
        fields: fields.filter((field) => Boolean(field.value)),
        actions
      } satisfies NodeDetail;
    }
    case 'schedule': {
      const schedule = graph.schedulesIndex.byId[node.refId];
      if (!schedule) {
        return null;
      }
      const workflow = graph.workflowsIndex.byId[schedule.workflowId];
      const fields: NodeDetailField[] = [
        { label: 'Cron', value: schedule.cron }
      ];
      if (schedule.timezone) {
        fields.push({ label: 'Timezone', value: schedule.timezone });
      }
      fields.push({ label: 'Catch-up', value: schedule.catchUp ? 'Enabled' : 'Disabled' });
      const actions: NodeDetailAction[] = workflow
        ? [
            { label: 'View workflow', to: `${ROUTE_PATHS.workflows}?slug=${workflow.slug}` },
            { label: 'Workflow schedules', to: `${ROUTE_PATHS.workflows}?slug=${workflow.slug}#schedules` }
          ]
        : [];
      return {
        title: schedule.name ?? schedule.id,
        subtitle: node.subtitle,
        description: schedule.description,
        badges: node.badges ?? [],
        highlights: node.meta,
        fields: fields.filter((field) => Boolean(field.value)),
        actions
      } satisfies NodeDetail;
    }
    case 'asset': {
      const asset = graph.assetsIndex.byNormalizedId[node.refId];
      if (!asset) {
        return null;
      }
      const fields: NodeDetailField[] = [
        { label: 'Asset ID', value: asset.assetId },
        { label: 'Normalized ID', value: asset.normalizedAssetId }
      ];
      if (asset.annotations?.ownerName) {
        fields.push({ label: 'Owner', value: asset.annotations.ownerName });
      }
      if (asset.annotations?.tags?.length) {
        fields.push({ label: 'Tags', value: asset.annotations.tags.join(', ') });
      }
      const actions: NodeDetailAction[] = [{ label: 'View assets', to: ROUTE_PATHS.assets }];
      return {
        title: asset.assetId,
        subtitle: asset.normalizedAssetId,
        description: null,
        badges: mergeBadges(node.badges, asset.annotations?.tags ?? []),
        highlights: node.meta,
        fields: fields.filter((field) => Boolean(field.value)),
        actions
      } satisfies NodeDetail;
    }
    case 'event-source': {
      const source = graph.eventSourcesIndex.byId[node.refId];
      if (!source) {
        return null;
      }
      const linkedTriggers = graph.adjacency.eventSourceTriggerEdges[source.id] ?? [];
      const observedEdges = graph.adjacency.eventSourceStepEdges[source.id] ?? [];
      const fields: NodeDetailField[] = [
        { label: 'Event type', value: source.eventType }
      ];
      if (source.eventSource) {
        fields.push({ label: 'Source key', value: source.eventSource });
      }
      if (linkedTriggers.length > 0) {
        fields.push({ label: 'Connected triggers', value: String(linkedTriggers.length) });
      }
      if (observedEdges.length > 0) {
        const totalSamples = observedEdges.reduce((sum, edge) => sum + edge.confidence.sampleCount, 0);
        fields.push({ label: 'Observed producers', value: String(observedEdges.length) });
        fields.push({ label: 'Sampled events', value: totalSamples.toLocaleString() });
        const latest = observedEdges.reduce<string | null>((acc, edge) => {
          if (!acc) {
            return edge.confidence.lastSeenAt;
          }
          return Date.parse(edge.confidence.lastSeenAt) > Date.parse(acc)
            ? edge.confidence.lastSeenAt
            : acc;
        }, null);
        if (latest) {
          fields.push({ label: 'Last seen', value: formatTimestamp(latest) });
        }
      }
      const actions: NodeDetailAction[] = [{ label: 'View runs', to: ROUTE_PATHS.runs }];
      return {
        title: source.eventSource ?? source.id,
        subtitle: source.eventType,
        description: null,
        badges: node.badges ?? [],
        highlights: node.meta,
        fields,
        actions
      } satisfies NodeDetail;
    }
    default:
      return null;
  }
}

type WorkflowTopologyNodeDetailsProps = {
  graph: WorkflowGraphNormalized | null;
  node: WorkflowGraphCanvasNodeData | null;
  onClear: () => void;
};

function WorkflowTopologyNodeDetails({ graph, node, onClear }: WorkflowTopologyNodeDetailsProps) {
  const detail = useMemo(() => buildNodeDetails(graph, node), [graph, node]);

  if (!detail) {
    return (
      <aside className={DETAIL_EMPTY_CLASSES}>
        Select a node to explore topology details.
      </aside>
    );
  }

  return (
    <aside className={DETAIL_CONTAINER_CLASSES}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <p className={DETAIL_HEADER_TITLE_CLASSES}>{detail.title}</p>
          {detail.subtitle && <p className={DETAIL_HEADER_SUBTITLE_CLASSES}>{detail.subtitle}</p>}
        </div>
        <button type="button" onClick={onClear} className={CLEAR_FILTERS_BUTTON_CLASSES}>
          Clear
        </button>
      </div>

      {detail.badges.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.badges.map((badge) => (
            <span key={badge} className={DETAIL_BADGE_CLASSES}>
              {badge}
            </span>
          ))}
        </div>
      )}

      {detail.description && <p className={DETAIL_DESCRIPTION_CLASSES}>{detail.description}</p>}

      {detail.highlights.length > 0 && (
        <ul className={DETAIL_HIGHLIGHTS_CLASSES}>
          {detail.highlights.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}

      {detail.fields.length > 0 && (
        <dl className={DETAIL_FIELDS_CLASSES}>
          {detail.fields.map((field) => (
            <div key={`${field.label}:${field.value}`} className="flex justify-between gap-3">
              <dt className={DETAIL_FIELD_LABEL_CLASSES}>{field.label}</dt>
              <dd className="text-right">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {detail.actions.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {detail.actions.map((action) => (
            <Link key={action.label} to={action.to} className={DETAIL_ACTION_BUTTON_CLASSES}>
              {action.label}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
