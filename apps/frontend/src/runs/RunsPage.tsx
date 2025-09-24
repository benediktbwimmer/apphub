import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useToasts } from '../components/toast';
import {
  fetchJobRuns,
  fetchWorkflowRuns,
  retriggerJobRun,
  retriggerWorkflowRun,
  type JobRunListItem,
  type WorkflowRunListItem,
  type RunListMeta
} from './api';

type RunsTabKey = 'workflows' | 'jobs';

type RunsTab = {
  key: RunsTabKey;
  label: string;
  description: string;
};

const WORKFLOW_PAGE_SIZE = 20;
const JOB_PAGE_SIZE = 25;

type WorkflowRunsState = {
  items: WorkflowRunListItem[];
  meta: RunListMeta | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
};

type JobRunsState = {
  items: JobRunListItem[];
  meta: RunListMeta | null;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loaded: boolean;
};

const TABS: RunsTab[] = [
  {
    key: 'workflows',
    label: 'Workflow runs',
    description: 'Recent workflow executions with status, timing, and trigger details.'
  },
  {
    key: 'jobs',
    label: 'Job runs',
    description: 'Latest job invocations across all definitions and runtimes.'
  }
];

function formatDateTime(value: string | null): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function computeDurationMs(
  startedAt: string | null,
  completedAt: string | null,
  fallback: number | null
): number | null {
  if (typeof fallback === 'number' && Number.isFinite(fallback)) {
    return fallback;
  }
  if (!startedAt || !completedAt) {
    return null;
  }
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (Number.isNaN(started) || Number.isNaN(completed)) {
    return null;
  }
  const diff = completed - started;
  return diff >= 0 ? diff : null;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null || Number.isNaN(durationMs)) {
    return '—';
  }
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function statusChipClass(status: string): string {
  switch (status) {
    case 'succeeded':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'running':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300';
    case 'failed':
      return 'bg-rose-100 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300';
    case 'canceled':
    case 'cancelled':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-500/10 dark:text-slate-300';
    case 'expired':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200';
    default:
      return 'bg-slate-100 text-slate-700 dark:bg-slate-500/10 dark:text-slate-300';
  }
}

export default function RunsPage() {
  const authorizedFetch = useAuthorizedFetch();
  const { pushToast } = useToasts();
  const [activeTab, setActiveTab] = useState<RunsTabKey>('workflows');
  const [workflowState, setWorkflowState] = useState<WorkflowRunsState>({
    items: [],
    meta: null,
    loading: false,
    loadingMore: false,
    error: null,
    loaded: false
  });
  const [jobState, setJobState] = useState<JobRunsState>({
    items: [],
    meta: null,
    loading: false,
    loadingMore: false,
    error: null,
    loaded: false
  });
  const [pendingWorkflowRunId, setPendingWorkflowRunId] = useState<string | null>(null);
  const [pendingJobRunId, setPendingJobRunId] = useState<string | null>(null);

  const loadWorkflowRuns = useCallback(
    async (options?: { offset?: number; append?: boolean }) => {
      const { offset = 0, append = false } = options ?? {};
      setWorkflowState((prev) => ({
        ...prev,
        loading: append ? prev.loading : true,
        loadingMore: append,
        error: append ? prev.error : null
      }));
      try {
        const result = await fetchWorkflowRuns(authorizedFetch, {
          limit: WORKFLOW_PAGE_SIZE,
          offset
        });
        setWorkflowState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...result.items] : result.items,
          meta: result.meta,
          loading: false,
          loadingMore: false,
          error: null,
          loaded: true
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load workflow runs';
        setWorkflowState((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: message,
          loaded: prev.loaded || !append
        }));
      }
    },
    [authorizedFetch]
  );

  const loadJobRuns = useCallback(
    async (options?: { offset?: number; append?: boolean }) => {
      const { offset = 0, append = false } = options ?? {};
      setJobState((prev) => ({
        ...prev,
        loading: append ? prev.loading : true,
        loadingMore: append,
        error: append ? prev.error : null
      }));
      try {
        const result = await fetchJobRuns(authorizedFetch, {
          limit: JOB_PAGE_SIZE,
          offset
        });
        setJobState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...result.items] : result.items,
          meta: result.meta,
          loading: false,
          loadingMore: false,
          error: null,
          loaded: true
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load job runs';
        setJobState((prev) => ({
          ...prev,
          loading: false,
          loadingMore: false,
          error: message,
          loaded: prev.loaded || !append
        }));
      }
    },
    [authorizedFetch]
  );

  useEffect(() => {
    void loadWorkflowRuns();
  }, [loadWorkflowRuns]);

  useEffect(() => {
    if (activeTab === 'jobs' && !jobState.loaded && !jobState.loading) {
      void loadJobRuns();
    }
  }, [activeTab, jobState.loaded, jobState.loading, loadJobRuns]);

  const workflowNextOffset = workflowState.meta?.nextOffset ?? null;
  const workflowHasMore = Boolean(workflowState.meta?.hasMore && workflowNextOffset !== null);
  const jobNextOffset = jobState.meta?.nextOffset ?? null;
  const jobHasMore = Boolean(jobState.meta?.hasMore && jobNextOffset !== null);
  const workflowLoading = workflowState.loading;
  const workflowLoadingMore = workflowState.loadingMore;
  const jobLoading = jobState.loading;
  const jobLoadingMore = jobState.loadingMore;

  const handleWorkflowRefresh = useCallback(() => {
    void loadWorkflowRuns();
  }, [loadWorkflowRuns]);

  const handleJobRefresh = useCallback(() => {
    void loadJobRuns();
  }, [loadJobRuns]);

  const handleWorkflowLoadMore = useCallback(() => {
    if (!workflowHasMore || workflowNextOffset === null || workflowLoadingMore || workflowLoading) {
      return;
    }
    void loadWorkflowRuns({ offset: workflowNextOffset, append: true });
  }, [workflowHasMore, workflowNextOffset, workflowLoadingMore, workflowLoading, loadWorkflowRuns]);

  const handleJobLoadMore = useCallback(() => {
    if (!jobHasMore || jobNextOffset === null || jobLoadingMore || jobLoading) {
      return;
    }
    void loadJobRuns({ offset: jobNextOffset, append: true });
  }, [jobHasMore, jobNextOffset, jobLoadingMore, jobLoading, loadJobRuns]);

  const handleWorkflowRetrigger = useCallback(
    async (entry: WorkflowRunListItem) => {
      setPendingWorkflowRunId(entry.run.id);
      try {
        await retriggerWorkflowRun(authorizedFetch, entry);
        pushToast({
          tone: 'success',
          title: 'Workflow retriggered',
          description: `Workflow ${entry.workflow.slug} run queued`
        });
        await loadWorkflowRuns();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to trigger workflow run';
        pushToast({
          tone: 'error',
          title: 'Workflow retrigger failed',
          description: message
        });
      } finally {
        setPendingWorkflowRunId(null);
      }
    },
    [authorizedFetch, loadWorkflowRuns, pushToast]
  );

  const handleJobRetrigger = useCallback(
    async (entry: JobRunListItem) => {
      setPendingJobRunId(entry.run.id);
      try {
        await retriggerJobRun(authorizedFetch, entry);
        pushToast({
          tone: 'success',
          title: 'Job retriggered',
          description: `Job ${entry.job.slug} run queued`
        });
        await loadJobRuns();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to trigger job run';
        pushToast({
          tone: 'error',
          title: 'Job retrigger failed',
          description: message
        });
      } finally {
        setPendingJobRunId(null);
      }
    },
    [authorizedFetch, loadJobRuns, pushToast]
  );

  const activeTabConfig = useMemo(() => TABS.find((tab) => tab.key === activeTab) ?? TABS[0], [activeTab]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Runs</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Monitor recent workflow and job runs, inspect timing, and retrigger executions when needed.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/70 p-1 dark:border-slate-700/70 dark:bg-slate-900/60">
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
                  isActive
                    ? 'bg-violet-600 text-white shadow-md dark:bg-violet-500'
                    : 'text-slate-600 hover:bg-violet-600/10 hover:text-violet-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white'
                }`}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
          {activeTabConfig.description}
        </p>
      </div>

      {activeTab === 'workflows' ? (
        <WorkflowRunsTable
          state={workflowState}
          onRetry={handleWorkflowRetrigger}
          pendingRunId={pendingWorkflowRunId}
          onRefresh={handleWorkflowRefresh}
          onLoadMore={handleWorkflowLoadMore}
        />
      ) : (
        <JobRunsTable
          state={jobState}
          onRetry={handleJobRetrigger}
          pendingRunId={pendingJobRunId}
          onRefresh={handleJobRefresh}
          onLoadMore={handleJobLoadMore}
        />
      )}
    </div>
  );
}

type WorkflowRunsTableProps = {
  state: WorkflowRunsState;
  onRetry: (entry: WorkflowRunListItem) => void;
  pendingRunId: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
};

type JobRunsTableProps = {
  state: JobRunsState;
  onRetry: (entry: JobRunListItem) => void;
  pendingRunId: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
};

function WorkflowRunsTable({ state, onRetry, pendingRunId, onRefresh, onLoadMore }: WorkflowRunsTableProps) {
  const { items, loading, loadingMore, error } = state;
  const hasMore = Boolean(state.meta?.hasMore && state.meta.nextOffset !== null);

  if (loading && !state.loaded) {
    return <div className="rounded-2xl border border-slate-200/60 p-6 text-sm text-slate-600 dark:border-slate-700/70 dark:text-slate-300">Loading workflow runs…</div>;
  }

  if (error && items.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
        <span>{error}</span>
        <button
          type="button"
          className="self-start rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          onClick={onRefresh}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <span>Workflow runs</span>
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          onClick={onRefresh}
          disabled={loading || loadingMore}
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50/60 dark:bg-slate-900/60">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Workflow
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Triggered by
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Started
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Completed
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Duration
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-500 dark:text-slate-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No workflow runs recorded yet.
                </td>
              </tr>
            ) : (
              items.map((entry) => {
                const durationMs = computeDurationMs(
                  entry.run.startedAt,
                  entry.run.completedAt,
                  entry.run.durationMs
                );
                const isPending = pendingRunId === entry.run.id;
                return (
                  <tr key={entry.run.id} className="bg-white/70 dark:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusChipClass(entry.run.status)}`}
                      >
                        {entry.run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col text-sm">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {entry.workflow.name}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{entry.workflow.slug}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {entry.run.triggeredBy ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDateTime(entry.run.startedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDateTime(entry.run.completedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDuration(durationMs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onRetry(entry)}
                        disabled={isPending}
                      >
                        {isPending ? 'Retriggering…' : 'Retrigger'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {error && items.length > 0 && (
        <div className="border-t border-amber-300/80 bg-amber-50/80 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      )}
      {hasMore && (
        <div className="border-t border-slate-200/70 bg-slate-50/60 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/40">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={onLoadMore}
            disabled={loadingMore || loading}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}

function JobRunsTable({ state, onRetry, pendingRunId, onRefresh, onLoadMore }: JobRunsTableProps) {
  const { items, loading, loadingMore, error } = state;
  const hasMore = Boolean(state.meta?.hasMore && state.meta.nextOffset !== null);

  if (loading && !state.loaded) {
    return <div className="rounded-2xl border border-slate-200/60 p-6 text-sm text-slate-600 dark:border-slate-700/70 dark:text-slate-300">Loading job runs…</div>;
  }

  if (error && items.length === 0) {
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50/80 p-6 text-sm text-rose-700 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
        <span>{error}</span>
        <button
          type="button"
          className="self-start rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold text-white shadow hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          onClick={onRefresh}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/70 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50">
      <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-300">
        <span>Job runs</span>
        <button
          type="button"
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          onClick={onRefresh}
          disabled={loading || loadingMore}
        >
          Refresh
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-800">
          <thead className="bg-slate-50/60 dark:bg-slate-900/60">
            <tr>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Status
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Job
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Runtime
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Started
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Completed
              </th>
              <th scope="col" className="px-4 py-3 text-left font-semibold text-slate-500 dark:text-slate-400">
                Duration
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold text-slate-500 dark:text-slate-400">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  No job runs recorded yet.
                </td>
              </tr>
            ) : (
              items.map((entry) => {
                const durationMs = computeDurationMs(
                  entry.run.startedAt,
                  entry.run.completedAt,
                  entry.run.durationMs
                );
                const isPending = pendingRunId === entry.run.id;
                return (
                  <tr key={entry.run.id} className="bg-white/70 dark:bg-slate-900/40">
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusChipClass(entry.run.status)}`}
                      >
                        {entry.run.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col text-sm">
                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                          {entry.job.name}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400">{entry.job.slug}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {entry.job.runtime}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDateTime(entry.run.startedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDateTime(entry.run.completedAt)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {formatDuration(durationMs)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="rounded-full bg-violet-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => onRetry(entry)}
                        disabled={isPending}
                      >
                        {isPending ? 'Retriggering…' : 'Retrigger'}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {error && items.length > 0 && (
        <div className="border-t border-amber-300/80 bg-amber-50/80 px-4 py-3 text-xs text-amber-700 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
          {error}
        </div>
      )}
      {hasMore && (
        <div className="border-t border-slate-200/70 bg-slate-50/60 px-4 py-3 text-right dark:border-slate-800 dark:bg-slate-900/40">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            onClick={onLoadMore}
            disabled={loadingMore || loading}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
