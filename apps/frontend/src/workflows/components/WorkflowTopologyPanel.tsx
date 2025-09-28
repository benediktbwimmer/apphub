import { useMemo } from 'react';
import WorkflowGraphCanvas, {
  type WorkflowGraphCanvasThemeOverrides
} from './WorkflowGraphCanvas';
import type { WorkflowGraphFetchMeta, WorkflowGraphNormalized } from '../graph';

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

      <WorkflowGraphCanvas
        graph={graph}
        loading={graphLoading || graphRefreshing}
        error={graphError}
        theme={PANEL_THEME}
        height={640}
        {...selectionProps}
      />
    </section>
  );
}

export default WorkflowTopologyPanel;
