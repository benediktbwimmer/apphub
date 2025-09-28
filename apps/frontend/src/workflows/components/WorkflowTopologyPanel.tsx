import { useMemo, useState, useCallback, useEffect, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import WorkflowGraphCanvas, {
  type WorkflowGraphCanvasThemeOverrides,
  type WorkflowGraphCanvasNodeData
} from './WorkflowGraphCanvas';
import type { WorkflowGraphFetchMeta, WorkflowGraphNormalized } from '../graph';
import type { WorkflowGraphCanvasFilters } from '../graph/canvasModel';
import { ROUTE_PATHS } from '../../routes/paths';

type WorkflowTopologyPanelProps = {
  graph: WorkflowGraphNormalized | null;
  graphLoading: boolean;
  graphRefreshing: boolean;
  graphError: string | null;
  graphStale: boolean;
  lastLoadedAt: string | null;
  meta: WorkflowGraphFetchMeta | null;
  onRefresh: () => void;
  selection?: {
    workflowId?: string | null;
  };
};

const PANEL_THEME: WorkflowGraphCanvasThemeOverrides = {
  surface: 'rgba(255, 255, 255, 0.94)'
};

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
    <span className="inline-flex min-w-[96px] flex-col items-center rounded-xl bg-slate-100/70 px-3 py-2 text-[11px] font-semibold leading-4 text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{value}</span>
      <span className="uppercase tracking-[0.22em] text-[10px] text-slate-500 dark:text-slate-400">
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
  onRefresh,
  selection
}: WorkflowTopologyPanelProps) {
  const stats = graph?.stats ?? null;
  const cacheHitRate = meta?.cache?.stats?.hitRate ?? null;
  const cacheAgeSeconds = meta?.cache?.stats?.ageSeconds ?? null;

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

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-slate-200/80 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-950/45">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">Workflow Topology Explorer</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Interactive canvas combining workflows, steps, triggers, assets, and event sources.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex flex-col text-right text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">
              Status
            </span>
            <span className="text-slate-600 dark:text-slate-300">{statusMessage}</span>
            <span className="text-[10px] tracking-[0.24em] text-slate-400 dark:text-slate-500">
              {formatTimestamp(lastLoadedAt)}
            </span>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={graphRefreshing}
            className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-violet-500/30 transition hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-not-allowed disabled:bg-violet-300"
          >
            {graphRefreshing ? (
              <span className="h-3 w-3 animate-spin rounded-full border-[2px] border-white/60 border-b-transparent" aria-hidden="true" />
            ) : (
              <span aria-hidden="true">⟳</span>
            )}
            Refresh
          </button>
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
            <span className="ml-auto inline-flex items-center rounded-full bg-slate-100/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:bg-slate-900/40 dark:text-slate-400">
              Cache {cacheHitRate !== null ? `${Math.round(cacheHitRate * 100)}% hit` : 'primed'} ·
              {' '}
              {cacheAgeSeconds !== null ? `${Math.round(cacheAgeSeconds)}s old` : 'fresh'}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            <label
              className="mb-1 uppercase tracking-[0.18em] text-[10px] text-slate-400 dark:text-slate-500"
              htmlFor="topology-search-input"
            >
              Search
            </label>
            <input
              id="topology-search-input"
              type="search"
              value={searchTermLocal}
              onChange={handleSearchChange}
              placeholder="Search nodes"
              className="min-w-[200px] rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            />
          </div>

          <div className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            <label
              className="mb-1 uppercase tracking-[0.18em] text-[10px] text-slate-400 dark:text-slate-500"
              htmlFor="topology-workflow-filter"
            >
              Workflows
            </label>
            <select
              id="topology-workflow-filter"
              multiple
              value={filtersState.workflowIds ?? []}
              onChange={handleWorkflowFilterChange}
              size={multiSelectSize(workflowFilterOptions.length)}
              disabled={workflowFilterOptions.length === 0}
              className="min-w-[180px] rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            >
              {workflowFilterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            <label
              className="mb-1 uppercase tracking-[0.18em] text-[10px] text-slate-400 dark:text-slate-500"
              htmlFor="topology-asset-filter"
            >
              Assets
            </label>
            <select
              id="topology-asset-filter"
              multiple
              value={filtersState.assetNormalizedIds ?? []}
              onChange={handleAssetFilterChange}
              size={multiSelectSize(assetFilterOptions.length)}
              disabled={assetFilterOptions.length === 0}
              className="min-w-[200px] rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
            >
              {assetFilterOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col text-xs font-semibold text-slate-600 dark:text-slate-300">
            <label
              className="mb-1 uppercase tracking-[0.18em] text-[10px] text-slate-400 dark:text-slate-500"
              htmlFor="topology-event-type-filter"
            >
              Event Types
            </label>
            <select
              id="topology-event-type-filter"
              multiple
              value={filtersState.eventTypes ?? []}
              onChange={handleEventTypeFilterChange}
              size={multiSelectSize(eventTypeFilterOptions.length)}
              disabled={eventTypeFilterOptions.length === 0}
              className="min-w-[200px] rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-xs font-semibold text-slate-700 shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200"
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
            className="inline-flex items-center rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition hover:border-slate-300 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/60 dark:text-slate-300 dark:hover:border-slate-600"
          >
            Clear Filters
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <WorkflowGraphCanvas
            graph={graph}
            loading={graphLoading || graphRefreshing}
            error={graphError}
            theme={PANEL_THEME}
            height={640}
            filters={canvasFilters}
            searchTerm={canvasSearchTerm}
            onNodeSelect={handleCanvasNodeSelect}
            onCanvasClick={handleCanvasClick}
            {...selectionProps}
          />
          <WorkflowTopologyNodeDetails graph={graph} node={selectedNode} onClear={handleCanvasClick} />
        </div>
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
      return {
        title: trigger.name ?? trigger.id,
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
      const fields: NodeDetailField[] = [
        { label: 'Event type', value: source.eventType }
      ];
      if (source.eventSource) {
        fields.push({ label: 'Source key', value: source.eventSource });
      }
      if (linkedTriggers.length > 0) {
        fields.push({ label: 'Connected triggers', value: String(linkedTriggers.length) });
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
      <aside className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 p-4 text-center text-xs font-semibold text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500">
        Select a node to explore topology details.
      </aside>
    );
  }

  return (
    <aside className="flex min-h-[200px] flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/85 p-4 shadow-[0_18px_42px_-28px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/60 dark:bg-slate-950/45">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{detail.title}</p>
          {detail.subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400">{detail.subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="rounded-full border border-slate-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 transition hover:border-slate-300 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 dark:border-slate-700/60 dark:text-slate-300 dark:hover:border-slate-600"
        >
          Clear
        </button>
      </div>

      {detail.badges.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {detail.badges.map((badge) => (
            <span
              key={badge}
              className="inline-flex items-center rounded-full bg-violet-500/12 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:bg-violet-500/15 dark:text-violet-200"
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      {detail.description && (
        <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">{detail.description}</p>
      )}

      {detail.highlights.length > 0 && (
        <ul className="mt-1 space-y-1 text-[11px] text-slate-500 dark:text-slate-300">
          {detail.highlights.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}

      {detail.fields.length > 0 && (
        <dl className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-300">
          {detail.fields.map((field) => (
            <div key={`${field.label}:${field.value}`} className="flex justify-between gap-3">
              <dt className="uppercase tracking-[0.18em] text-[10px] text-slate-400 dark:text-slate-500">
                {field.label}
              </dt>
              <dd className="text-right">{field.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {detail.actions.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {detail.actions.map((action) => (
            <Link
              key={action.label}
              to={action.to}
              className="inline-flex items-center rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
            >
              {action.label}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}
