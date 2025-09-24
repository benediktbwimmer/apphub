import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { useToasts } from '../components/toast';
import { ROUTE_PATHS } from '../routes/paths';
import { useAppHubEvent } from '../events/context';
import {
  fetchJobRuns,
  fetchWorkflowRuns,
  retriggerJobRun,
  retriggerWorkflowRun,
  type JobRunListItem,
  type WorkflowRunListItem,
  type RunListMeta
} from './api';
import { listWorkflowRunSteps } from '../workflows/api';
import type { WorkflowRun, WorkflowRunStep } from '../workflows/types';

type RunsTabKey = 'workflows' | 'jobs';

type RunsTab = {
  key: RunsTabKey;
  label: string;
  description: string;
};

const WORKFLOW_PAGE_SIZE = 20;
const JOB_PAGE_SIZE = 25;

const WORKFLOW_RUN_EVENT_TYPES = [
  'workflow.run.updated',
  'workflow.run.pending',
  'workflow.run.running',
  'workflow.run.succeeded',
  'workflow.run.failed',
  'workflow.run.canceled'
] as const;

const JOB_RUN_EVENT_TYPES = [
  'job.run.updated',
  'job.run.pending',
  'job.run.running',
  'job.run.succeeded',
  'job.run.failed',
  'job.run.canceled',
  'job.run.expired'
] as const;

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
  const navigate = useNavigate();
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
  const [selectedWorkflowEntry, setSelectedWorkflowEntry] = useState<WorkflowRunListItem | null>(null);
  const [workflowRunDetail, setWorkflowRunDetail] = useState<{ run: WorkflowRun; steps: WorkflowRunStep[] } | null>(null);
  const [workflowDetailLoading, setWorkflowDetailLoading] = useState(false);
  const [workflowDetailError, setWorkflowDetailError] = useState<string | null>(null);
  const [selectedJobEntry, setSelectedJobEntry] = useState<JobRunListItem | null>(null);

  const workflowReloadTimer = useRef<number | null>(null);
  const jobReloadTimer = useRef<number | null>(null);

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

  const scheduleWorkflowReload = useCallback(() => {
    if (workflowReloadTimer.current !== null) {
      return;
    }
    workflowReloadTimer.current = window.setTimeout(() => {
      workflowReloadTimer.current = null;
      void loadWorkflowRuns();
    }, 250);
  }, [loadWorkflowRuns]);

  const scheduleJobReload = useCallback(() => {
    if (jobReloadTimer.current !== null) {
      return;
    }
    jobReloadTimer.current = window.setTimeout(() => {
      jobReloadTimer.current = null;
      void loadJobRuns();
    }, 250);
  }, [loadJobRuns]);

  useEffect(() => {
    void loadWorkflowRuns();
  }, [loadWorkflowRuns]);

  useEffect(() => {
    if (activeTab === 'jobs' && !jobState.loaded && !jobState.loading) {
      void loadJobRuns();
    }
  }, [activeTab, jobState.loaded, jobState.loading, loadJobRuns]);

  useEffect(() => {
    if (!selectedWorkflowEntry) {
      setWorkflowRunDetail(null);
      setWorkflowDetailError(null);
      setWorkflowDetailLoading(false);
      return;
    }
    let cancelled = false;
    setWorkflowDetailLoading(true);
    setWorkflowDetailError(null);
    listWorkflowRunSteps(authorizedFetch, selectedWorkflowEntry.run.id)
      .then((detail) => {
        if (!cancelled) {
          setWorkflowRunDetail(detail);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Failed to load workflow run detail';
          setWorkflowDetailError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWorkflowDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [authorizedFetch, selectedWorkflowEntry]);

  useEffect(() => {
    if (activeTab !== 'workflows') {
      setSelectedWorkflowEntry(null);
    }
    if (activeTab !== 'jobs') {
      setSelectedJobEntry(null);
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedWorkflowEntry) {
      const exists = workflowState.items.some((item) => item.run.id === selectedWorkflowEntry.run.id);
      if (!exists) {
        setSelectedWorkflowEntry(null);
      }
    }
  }, [workflowState.items, selectedWorkflowEntry]);

  useEffect(() => {
    if (selectedJobEntry) {
      const exists = jobState.items.some((item) => item.run.id === selectedJobEntry.run.id);
      if (!exists) {
        setSelectedJobEntry(null);
      }
    }
  }, [jobState.items, selectedJobEntry]);

  useEffect(() => {
    return () => {
      if (workflowReloadTimer.current !== null) {
        window.clearTimeout(workflowReloadTimer.current);
        workflowReloadTimer.current = null;
      }
      if (jobReloadTimer.current !== null) {
        window.clearTimeout(jobReloadTimer.current);
        jobReloadTimer.current = null;
      }
    };
  }, []);

  useAppHubEvent(WORKFLOW_RUN_EVENT_TYPES, scheduleWorkflowReload);
  useAppHubEvent(JOB_RUN_EVENT_TYPES, scheduleJobReload);

  const workflowNextOffset = workflowState.meta?.nextOffset ?? null;
  const workflowHasMore = Boolean(workflowState.meta?.hasMore && workflowNextOffset !== null);
  const jobNextOffset = jobState.meta?.nextOffset ?? null;
  const jobHasMore = Boolean(jobState.meta?.hasMore && jobNextOffset !== null);
  const workflowLoading = workflowState.loading;
  const workflowLoadingMore = workflowState.loadingMore;
  const jobLoading = jobState.loading;
  const jobLoadingMore = jobState.loadingMore;

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

  const handleWorkflowReload = useCallback(() => {
    void loadWorkflowRuns();
  }, [loadWorkflowRuns]);

  const handleJobReload = useCallback(() => {
    void loadJobRuns();
  }, [loadJobRuns]);

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

  const handleWorkflowSelect = useCallback((entry: WorkflowRunListItem) => {
    setSelectedWorkflowEntry((current) => (current && current.run.id === entry.run.id ? null : entry));
  }, []);

  const handleJobSelect = useCallback((entry: JobRunListItem) => {
    setSelectedJobEntry((current) => (current && current.run.id === entry.run.id ? null : entry));
  }, []);

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
        <div className="flex flex-col gap-4">
          <WorkflowRunsTable
            state={workflowState}
            onRetry={handleWorkflowRetrigger}
            pendingRunId={pendingWorkflowRunId}
            onReload={handleWorkflowReload}
            onLoadMore={handleWorkflowLoadMore}
            onSelect={handleWorkflowSelect}
            selectedEntry={selectedWorkflowEntry}
            detail={workflowRunDetail}
            detailLoading={workflowDetailLoading}
            detailError={workflowDetailError}
            onCloseDetail={() => setSelectedWorkflowEntry(null)}
            onViewWorkflow={() => {
              if (!selectedWorkflowEntry) {
                return;
              }
              const params = new URLSearchParams();
              params.set('slug', selectedWorkflowEntry.workflow.slug);
              params.set('run', selectedWorkflowEntry.run.id);
              navigate(`${ROUTE_PATHS.workflows}?${params.toString()}`);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <JobRunsTable
            state={jobState}
            onRetry={handleJobRetrigger}
            pendingRunId={pendingJobRunId}
            onReload={handleJobReload}
            onLoadMore={handleJobLoadMore}
            onSelect={handleJobSelect}
            selectedEntry={selectedJobEntry}
            onCloseDetail={() => setSelectedJobEntry(null)}
            onViewJob={() => navigate(ROUTE_PATHS.jobs)}
          />
        </div>
      )}
    </div>
  );
}

type WorkflowRunsTableProps = {
  state: WorkflowRunsState;
  onRetry: (entry: WorkflowRunListItem) => void;
  pendingRunId: string | null;
  onReload: () => void;
  onLoadMore: () => void;
  onSelect: (entry: WorkflowRunListItem) => void;
  selectedEntry: WorkflowRunListItem | null;
  detail: { run: WorkflowRun; steps: WorkflowRunStep[] } | null;
  detailLoading: boolean;
  detailError: string | null;
  onCloseDetail: () => void;
  onViewWorkflow: () => void;
};

type JobRunsTableProps = {
  state: JobRunsState;
  onRetry: (entry: JobRunListItem) => void;
  pendingRunId: string | null;
  onReload: () => void;
  onLoadMore: () => void;
  onSelect: (entry: JobRunListItem) => void;
  selectedEntry: JobRunListItem | null;
  onCloseDetail: () => void;
  onViewJob: () => void;
};

function WorkflowRunsTable({
  state,
  onRetry,
  pendingRunId,
  onReload,
  onLoadMore,
  onSelect,
  selectedEntry,
  detail,
  detailLoading,
  detailError,
  onCloseDetail,
  onViewWorkflow
}: WorkflowRunsTableProps) {
  const { items, loading, loadingMore, error } = state;
  const hasMore = Boolean(state.meta?.hasMore && state.meta.nextOffset !== null);
  const selectedRunId = selectedEntry?.run.id ?? null;

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
          onClick={onReload}
          disabled={loading}
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
        {loading && state.loaded && (
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Updating…</span>
        )}
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
                const isSelected = selectedRunId === entry.run.id;
                const detailForEntry = isSelected && detail?.run.id === entry.run.id ? detail : null;
                const detailErrorForEntry = isSelected ? detailError : null;
                const detailLoadingForEntry = isSelected ? detailLoading : false;
                return (
                  <Fragment key={entry.run.id}>
                    <tr
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-violet-100/70 dark:bg-violet-500/20'
                          : 'bg-white/70 hover:bg-violet-50/70 dark:bg-slate-900/40 dark:hover:bg-violet-500/10'
                      }`}
                      onClick={() => onSelect(entry)}
                      aria-selected={isSelected}
                    >
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
                          onClick={(event) => {
                            event.stopPropagation();
                            onRetry(entry);
                          }}
                          disabled={isPending}
                        >
                          {isPending ? 'Retriggering…' : 'Retrigger'}
                        </button>
                      </td>
                    </tr>
                    {isSelected && (
                      <tr className="bg-violet-50/50 dark:bg-slate-900/70">
                        <td colSpan={7} className="px-4 pb-6 pt-2 text-left align-top">
                          <WorkflowRunDetailPanel
                            entry={entry}
                            detail={detailForEntry}
                            loading={detailLoadingForEntry}
                            error={detailErrorForEntry}
                            onClose={onCloseDetail}
                            onViewWorkflow={onViewWorkflow}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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

type WorkflowRunDetailPanelProps = {
  entry: WorkflowRunListItem;
  detail: { run: WorkflowRun; steps: WorkflowRunStep[] } | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onViewWorkflow: () => void;
};

function WorkflowRunDetailPanel({ entry, detail, loading, error, onClose, onViewWorkflow }: WorkflowRunDetailPanelProps) {
  const run = detail?.run ?? entry.run;
  const steps = detail?.steps ?? [];
  const duration = computeDurationMs(run.startedAt, run.completedAt, run.durationMs);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.55)] dark:border-slate-700/70 dark:bg-slate-900/60">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Workflow run detail
          </span>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{entry.workflow.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-4 py-1 text-xs font-semibold capitalize ${statusChipClass(run.status)}`}>
            {run.status}
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-200/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
            onClick={onViewWorkflow}
          >
            View workflow
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-200/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoRow label="Run ID" value={run.id} />
        <InfoRow label="Workflow slug" value={entry.workflow.slug} />
        <InfoRow label="Triggered by" value={run.triggeredBy ?? '—'} />
        <InfoRow label="Partition" value={run.partitionKey ?? '—'} />
        <InfoRow label="Started" value={formatDateTime(run.startedAt)} />
        <InfoRow label="Completed" value={formatDateTime(run.completedAt)} />
        <InfoRow label="Duration" value={formatDuration(duration) ?? '—'} />
        <InfoRow label="Current step" value={run.currentStepId ?? '—'} />
      </div>

      {run.errorMessage && (
        <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {run.errorMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <JsonPreview title="Parameters" value={run.parameters} />
        <JsonPreview title="Context" value={run.context} />
        <JsonPreview title="Output" value={run.output} />
        <JsonPreview title="Trigger payload" value={run.trigger} />
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Step timeline</h4>
          {loading && <span className="text-xs text-slate-500 dark:text-slate-400">Loading steps…</span>}
        </div>
        {error && (
          <div className="rounded-xl border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
            {error}
          </div>
        )}
        {!loading && steps.length === 0 && !error && (
          <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-sm text-slate-500 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
            No steps recorded yet.
          </div>
        )}
        {steps.length > 0 && (
          <ul className="flex flex-col gap-2">
            {steps.map((step) => {
              const stepDuration = computeDurationMs(step.startedAt, step.completedAt, null);
              return (
                <li
                  key={step.id}
                  className="rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-sm shadow-sm dark:border-slate-700/60 dark:bg-slate-900/50"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{step.stepId}</span>
                      {step.parentStepId && (
                        <span className="text-xs text-slate-500 dark:text-slate-400">Parent: {step.parentStepId}</span>
                      )}
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold capitalize ${statusChipClass(step.status)}`}>
                      {step.status}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-2 text-xs text-slate-500 dark:text-slate-400 md:grid-cols-2">
                    <span>Started {formatDateTime(step.startedAt)}</span>
                    <span>Completed {formatDateTime(step.completedAt)}</span>
                    <span>Duration {formatDuration(stepDuration) ?? '—'}</span>
                    {step.errorMessage && <span className="text-rose-600 dark:text-rose-300">Error: {step.errorMessage}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

type JobRunDetailPanelProps = {
  entry: JobRunListItem;
  onClose: () => void;
  onViewJob: () => void;
};

function JobRunDetailPanel({ entry, onClose, onViewJob }: JobRunDetailPanelProps) {
  const duration = computeDurationMs(entry.run.startedAt, entry.run.completedAt, entry.run.durationMs);

  return (
    <div className="flex flex-col gap-4 rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.55)] dark:border-slate-700/70 dark:bg-slate-900/60">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
            Job run detail
          </span>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{entry.job.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-4 py-1 text-xs font-semibold capitalize ${statusChipClass(entry.run.status)}`}>
            {entry.run.status}
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-200/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:border-violet-300 hover:bg-violet-500/10 hover:text-violet-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-200/10 dark:hover:text-slate-100"
            onClick={onViewJob}
          >
            View jobs
          </button>
          <button
            type="button"
            className="rounded-full border border-slate-200/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400 dark:border-slate-700/60 dark:text-slate-300 dark:hover:bg-slate-800"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoRow label="Run ID" value={entry.run.id} />
        <InfoRow label="Job slug" value={entry.job.slug} />
        <InfoRow label="Runtime" value={entry.job.runtime} />
        <InfoRow label="Started" value={formatDateTime(entry.run.startedAt)} />
        <InfoRow label="Completed" value={formatDateTime(entry.run.completedAt)} />
        <InfoRow label="Duration" value={formatDuration(duration) ?? '—'} />
        <InfoRow label="Attempt" value={`${entry.run.attempt} of ${entry.run.maxAttempts ?? '∞'}`} />
        <InfoRow label="Timeout" value={entry.run.timeoutMs ? `${Math.round(entry.run.timeoutMs / 1000)}s` : '—'} />
      </div>

      {entry.run.errorMessage && (
        <div className="rounded-2xl border border-rose-300/70 bg-rose-50/70 p-3 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {entry.run.errorMessage}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <JsonPreview title="Parameters" value={entry.run.parameters} />
        <JsonPreview title="Context" value={entry.run.context} />
        <JsonPreview title="Result" value={entry.run.result} />
        <JsonPreview title="Metrics" value={entry.run.metrics} />
      </div>
    </div>
  );
}

type InfoRowProps = {
  label: string;
  value: string;
};

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
      <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <span className="font-medium text-slate-800 dark:text-slate-100">{value}</span>
    </div>
  );
}

type JsonPreviewProps = {
  title: string;
  value: unknown;
};

function JsonPreview({ title, value }: JsonPreviewProps) {
  let content: string | null = null;
  if (value !== null && value !== undefined) {
    try {
      content = JSON.stringify(value, null, 2);
    } catch {
      content = String(value);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-white/70 p-3 text-sm text-slate-600 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200">
      <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
        {title}
      </span>
      {content ? (
        <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950/80 p-3 text-xs text-slate-100 dark:bg-slate-950/60">
          {content}
        </pre>
      ) : (
        <span className="text-xs text-slate-500 dark:text-slate-400">No data</span>
      )}
    </div>
  );
}

function JobRunsTable({
  state,
  onRetry,
  pendingRunId,
  onReload,
  onLoadMore,
  onSelect,
  selectedEntry,
  onCloseDetail,
  onViewJob
}: JobRunsTableProps) {
  const { items, loading, loadingMore, error } = state;
  const hasMore = Boolean(state.meta?.hasMore && state.meta.nextOffset !== null);
  const selectedRunId = selectedEntry?.run.id ?? null;

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
          onClick={onReload}
          disabled={loading}
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
        {loading && state.loaded && (
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Updating…</span>
        )}
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
                const isSelected = selectedRunId === entry.run.id;
                return (
                  <Fragment key={entry.run.id}>
                    <tr
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-violet-100/70 dark:bg-violet-500/20'
                          : 'bg-white/70 hover:bg-violet-50/70 dark:bg-slate-900/40 dark:hover:bg-violet-500/10'
                      }`}
                      onClick={() => onSelect(entry)}
                      aria-selected={isSelected}
                    >
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
                          onClick={(event) => {
                            event.stopPropagation();
                            onRetry(entry);
                          }}
                          disabled={isPending}
                        >
                          {isPending ? 'Retriggering…' : 'Retrigger'}
                        </button>
                      </td>
                    </tr>
                    {isSelected && (
                      <tr className="bg-violet-50/50 dark:bg-slate-900/70">
                        <td colSpan={7} className="px-4 pb-6 pt-2 text-left align-top">
                          <JobRunDetailPanel entry={entry} onClose={onCloseDetail} onViewJob={onViewJob} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
