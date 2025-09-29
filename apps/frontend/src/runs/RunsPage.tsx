import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner, CopyButton } from '../components';
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
  type RunListMeta,
  type JobRunFilters,
  type WorkflowRunFilters
} from './api';
import { listWorkflowRunSteps } from '../workflows/api';
import type { WorkflowRun, WorkflowRunStep } from '../workflows/types';
import { useSavedSearches } from '../savedSearches/useSavedSearches';
import type { SavedSearch, SavedSearchMutationState } from '../savedSearches/types';

type RunsTabKey = 'workflows' | 'jobs';

type RunsTab = {
  key: RunsTabKey;
  label: string;
  description: string;
};

const WORKFLOW_PAGE_SIZE = 20;
const JOB_PAGE_SIZE = 25;

const WORKFLOW_STATUS_OPTIONS = ['pending', 'running', 'succeeded', 'failed', 'canceled'] as const;
type WorkflowStatusOption = (typeof WORKFLOW_STATUS_OPTIONS)[number];

const WORKFLOW_TRIGGER_OPTIONS = ['manual', 'schedule', 'event', 'auto-materialize'] as const;
type WorkflowTriggerOption = (typeof WORKFLOW_TRIGGER_OPTIONS)[number];

const JOB_STATUS_OPTIONS = ['pending', 'running', 'succeeded', 'failed', 'canceled', 'expired'] as const;
type JobStatusOption = (typeof JOB_STATUS_OPTIONS)[number];

const JOB_RUNTIME_OPTIONS = ['node', 'python', 'docker'] as const;
type JobRuntimeOption = (typeof JOB_RUNTIME_OPTIONS)[number];

type RunSavedSearchConfig =
  | {
      kind: 'workflows';
      filters: {
        search?: string;
        statuses?: string[];
        triggerTypes?: string[];
      };
    }
  | {
      kind: 'jobs';
      filters: {
        search?: string;
        statuses?: string[];
        runtimes?: string[];
      };
    };

type RunSavedSearchRecord = SavedSearch<string, RunSavedSearchConfig>;

type WorkflowFilterState = {
  search: string;
  statuses: WorkflowStatusOption[];
  triggerTypes: WorkflowTriggerOption[];
};

type JobFilterState = {
  search: string;
  statuses: JobStatusOption[];
  runtimes: JobRuntimeOption[];
};

const DEFAULT_WORKFLOW_FILTERS: WorkflowFilterState = {
  search: '',
  statuses: [],
  triggerTypes: []
};

const DEFAULT_JOB_FILTERS: JobFilterState = {
  search: '',
  statuses: [],
  runtimes: []
};

const WORKFLOW_STATUS_SET = new Set<WorkflowStatusOption>(WORKFLOW_STATUS_OPTIONS);
const WORKFLOW_TRIGGER_SET = new Set<WorkflowTriggerOption>(WORKFLOW_TRIGGER_OPTIONS);
const JOB_STATUS_SET = new Set<JobStatusOption>(JOB_STATUS_OPTIONS);
const JOB_RUNTIME_SET = new Set<JobRuntimeOption>(JOB_RUNTIME_OPTIONS);

function normalizeWorkflowStatuses(values: Iterable<string>): WorkflowStatusOption[] {
  const result: WorkflowStatusOption[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase() as WorkflowStatusOption;
    if (WORKFLOW_STATUS_SET.has(normalized) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function normalizeWorkflowTriggers(values: Iterable<string>): WorkflowTriggerOption[] {
  const result: WorkflowTriggerOption[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase() as WorkflowTriggerOption;
    if (WORKFLOW_TRIGGER_SET.has(normalized) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function normalizeJobStatuses(values: Iterable<string>): JobStatusOption[] {
  const result: JobStatusOption[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase() as JobStatusOption;
    if (JOB_STATUS_SET.has(normalized) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function normalizeJobRuntimes(values: Iterable<string>): JobRuntimeOption[] {
  const result: JobRuntimeOption[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase() as JobRuntimeOption;
    if (JOB_RUNTIME_SET.has(normalized) && !result.includes(normalized)) {
      result.push(normalized);
    }
  }
  return result;
}

function formatFilterLabel(value: string): string {
  return value
    .split(/[-_]/)
    .map((segment) => (segment.length === 0 ? segment : segment[0].toUpperCase() + segment.slice(1)))
    .join(' ');
}

function toWorkflowRunFilters(filters: WorkflowFilterState): WorkflowRunFilters {
  return {
    statuses: filters.statuses,
    triggerTypes: filters.triggerTypes,
    search: filters.search.trim() ? filters.search.trim() : undefined
  };
}

function toJobRunFilters(filters: JobFilterState): JobRunFilters {
  return {
    statuses: filters.statuses,
    runtimes: filters.runtimes,
    search: filters.search.trim() ? filters.search.trim() : undefined
  };
}

function parseRunSavedSearchConfig(value: unknown): RunSavedSearchConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as { kind?: unknown; filters?: unknown };
  if (record.kind === 'workflows' && record.filters && typeof record.filters === 'object') {
    const filters = record.filters as Record<string, unknown>;
    const statuses = Array.isArray(filters.statuses) ? filters.statuses.map(String) : [];
    const triggerTypes = Array.isArray(filters.triggerTypes) ? filters.triggerTypes.map(String) : [];
    const search = typeof filters.search === 'string' ? filters.search : '';
    return {
      kind: 'workflows',
      filters: {
        search,
        statuses,
        triggerTypes
      }
    };
  }
  if (record.kind === 'jobs' && record.filters && typeof record.filters === 'object') {
    const filters = record.filters as Record<string, unknown>;
    const statuses = Array.isArray(filters.statuses) ? filters.statuses.map(String) : [];
    const runtimes = Array.isArray(filters.runtimes) ? filters.runtimes.map(String) : [];
    const search = typeof filters.search === 'string' ? filters.search : '';
    return {
      kind: 'jobs',
      filters: {
        search,
        statuses,
        runtimes
      }
    };
  }
  return null;
}

type FilterChipProps = {
  label: string;
  active: boolean;
  onToggle: () => void;
};

function FilterChip({ label, active, onToggle }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`rounded-full border px-3 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 ${
        active
          ? 'border-violet-500 bg-violet-600 text-white shadow-sm'
          : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300 hover:text-violet-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-violet-400 dark:hover:text-violet-200'
      }`}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

type WorkflowFilterControlsProps = {
  filters: WorkflowFilterState;
  onSearchChange: (value: string) => void;
  onStatusToggle: (status: WorkflowStatusOption) => void;
  onTriggerToggle: (trigger: WorkflowTriggerOption) => void;
  onReset: () => void;
};

function WorkflowFilterControls({ filters, onSearchChange, onStatusToggle, onTriggerToggle, onReset }: WorkflowFilterControlsProps) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by run key, run ID, workflow, or trigger"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/40"
        />
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
        >
          Reset
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Status</span>
        {WORKFLOW_STATUS_OPTIONS.map((status) => (
          <FilterChip
            key={status}
            label={formatFilterLabel(status)}
            active={filters.statuses.includes(status)}
            onToggle={() => onStatusToggle(status)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Trigger</span>
        {WORKFLOW_TRIGGER_OPTIONS.map((trigger) => (
          <FilterChip
            key={trigger}
            label={formatFilterLabel(trigger)}
            active={filters.triggerTypes.includes(trigger)}
            onToggle={() => onTriggerToggle(trigger)}
          />
        ))}
      </div>
    </section>
  );
}

type JobFilterControlsProps = {
  filters: JobFilterState;
  onSearchChange: (value: string) => void;
  onStatusToggle: (status: JobStatusOption) => void;
  onRuntimeToggle: (runtime: JobRuntimeOption) => void;
  onReset: () => void;
};

function JobFilterControls({ filters, onSearchChange, onStatusToggle, onRuntimeToggle, onReset }: JobFilterControlsProps) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by run ID or job"
          className="min-w-[220px] flex-1 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200/50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-slate-400 dark:focus:ring-slate-500/40"
        />
        <button
          type="button"
          onClick={onReset}
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
        >
          Reset
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Status</span>
        {JOB_STATUS_OPTIONS.map((status) => (
          <FilterChip
            key={status}
            label={formatFilterLabel(status)}
            active={filters.statuses.includes(status)}
            onToggle={() => onStatusToggle(status)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Runtime</span>
        {JOB_RUNTIME_OPTIONS.map((runtime) => (
          <FilterChip
            key={runtime}
            label={formatFilterLabel(runtime)}
            active={filters.runtimes.includes(runtime)}
            onToggle={() => onRuntimeToggle(runtime)}
          />
        ))}
      </div>
    </section>
  );
}

type SavedViewToolbarProps = {
  kind: 'workflows' | 'jobs';
  savedViews: { entry: RunSavedSearchRecord; config: RunSavedSearchConfig }[];
  loading: boolean;
  error: string | null;
  mutationState: SavedSearchMutationState;
  onApply: (entry: RunSavedSearchRecord, config: RunSavedSearchConfig) => void;
  onRename: (entry: RunSavedSearchRecord) => void;
  onDelete: (entry: RunSavedSearchRecord) => void;
  onShare: (entry: RunSavedSearchRecord) => void;
  onSaveCurrent: () => void;
  onRefresh: () => Promise<void>;
};

function SavedViewToolbar({
  kind,
  savedViews,
  loading,
  error,
  mutationState,
  onApply,
  onRename,
  onDelete,
  onShare,
  onSaveCurrent,
  onRefresh
}: SavedViewToolbarProps) {
  const title = kind === 'workflows' ? 'Workflow saved views' : 'Job saved views';
  const description =
    kind === 'workflows'
      ? 'Save workflow filters to quickly revisit the runs that matter.'
      : 'Save job filters to monitor targeted executions.';

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void onRefresh();
            }}
            disabled={loading}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-slate-800"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onSaveCurrent}
            disabled={mutationState.creating}
            className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-400"
          >
            {mutationState.creating ? 'Saving…' : 'Save current view'}
          </button>
        </div>
      </div>
      {error && (
        <div className="rounded-lg border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs font-medium text-rose-600 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      )}
      {loading && savedViews.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">Loading saved views…</div>
      ) : savedViews.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400">No saved views yet.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {savedViews.map(({ entry, config }) => {
            const isApplying = mutationState.applyingSlug === entry.slug;
            const isRenaming = mutationState.updatingSlug === entry.slug;
            const isDeleting = mutationState.deletingSlug === entry.slug;
            const isSharing = mutationState.sharingSlug === entry.slug;
            const statusList =
              config.kind === 'workflows'
                ? normalizeWorkflowStatuses(config.filters.statuses ?? entry.statusFilters)
                : normalizeJobStatuses(config.filters.statuses ?? entry.statusFilters);
            const secondaryList =
              config.kind === 'workflows'
                ? normalizeWorkflowTriggers(config.filters.triggerTypes ?? [])
                : normalizeJobRuntimes(config.filters.runtimes ?? []);
            const searchSummary = (config.filters.search ?? entry.searchInput ?? '').trim();

            return (
              <li
                key={entry.id}
                className="flex flex-col gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 dark:border-slate-700/60 dark:bg-slate-800/60"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onApply(entry, config)}
                    disabled={isApplying || isDeleting}
                    className="text-left text-sm font-semibold text-violet-700 transition hover:text-violet-800 disabled:cursor-not-allowed disabled:text-violet-400 dark:text-slate-100 dark:hover:text-slate-50 dark:disabled:text-slate-500"
                  >
                    {isApplying ? 'Applying…' : entry.name}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onShare(entry)}
                      disabled={isSharing || isDeleting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
                    >
                      {isSharing ? 'Sharing…' : 'Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRename(entry)}
                      disabled={isRenaming || isDeleting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-slate-100"
                    >
                      {isRenaming ? 'Renaming…' : 'Rename'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(entry)}
                      disabled={isDeleting}
                      className="rounded-md px-2 py-1 text-xs font-medium text-rose-600 transition hover:bg-rose-100 hover:text-rose-700 disabled:cursor-not-allowed disabled:text-rose-400 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <span>Status: {statusList.length > 0 ? statusList.map(formatFilterLabel).join(', ') : 'All statuses'}</span>
                  <span>
                    {config.kind === 'workflows'
                      ? `Triggers: ${secondaryList.length > 0 ? secondaryList.map(formatFilterLabel).join(', ') : 'All triggers'}`
                      : `Runtimes: ${secondaryList.length > 0 ? secondaryList.map(formatFilterLabel).join(', ') : 'All runtimes'}`}
                  </span>
                  <span>Search: {searchSummary.length > 0 ? searchSummary : 'Any text'}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

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
  const [workflowFilters, setWorkflowFilters] = useState<WorkflowFilterState>(() => ({ ...DEFAULT_WORKFLOW_FILTERS }));
  const [jobFilters, setJobFilters] = useState<JobFilterState>(() => ({ ...DEFAULT_JOB_FILTERS }));
  const [pendingWorkflowRunId, setPendingWorkflowRunId] = useState<string | null>(null);
  const [pendingJobRunId, setPendingJobRunId] = useState<string | null>(null);
  const [selectedWorkflowEntry, setSelectedWorkflowEntry] = useState<WorkflowRunListItem | null>(null);
  const [workflowRunDetail, setWorkflowRunDetail] = useState<{ run: WorkflowRun; steps: WorkflowRunStep[] } | null>(null);
  const [workflowDetailLoading, setWorkflowDetailLoading] = useState(false);
  const [workflowDetailError, setWorkflowDetailError] = useState<string | null>(null);
  const [selectedJobEntry, setSelectedJobEntry] = useState<JobRunListItem | null>(null);

  const workflowReloadTimer = useRef<number | null>(null);
  const jobReloadTimer = useRef<number | null>(null);
  const workflowFiltersRef = useRef<WorkflowFilterState>(workflowFilters);
  const jobFiltersRef = useRef<JobFilterState>(jobFilters);
  const workflowFiltersInitialized = useRef(false);
  const jobFiltersInitialized = useRef(false);
  const runSavedSearches = useSavedSearches<string, RunSavedSearchConfig>({
    category: 'runs',
    analytics: {
      createdEvent: 'runs_saved_view_created',
      appliedEvent: 'runs_saved_view_applied',
      sharedEvent: 'runs_saved_view_shared',
      payloadMapper: (record) => {
        const parsed = parseRunSavedSearchConfig(record.config);
        return {
          slug: record.slug,
          category: record.category,
          kind: parsed?.kind ?? 'unknown',
          statusFilters: record.statusFilters,
          search: record.searchInput
        };
      }
    },
    sortComparator: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  });
  const savedViewEntries = useMemo(
    () =>
      runSavedSearches.savedSearches
        .map((entry) => {
          const parsed = parseRunSavedSearchConfig(entry.config);
          if (!parsed) {
            return null;
          }
          return { entry: entry as RunSavedSearchRecord, config: parsed };
        })
        .filter((item): item is { entry: RunSavedSearchRecord; config: RunSavedSearchConfig } => item !== null),
    [runSavedSearches.savedSearches]
  );
  const workflowSavedViews = useMemo(
    () => savedViewEntries.filter((item) => item.config.kind === 'workflows'),
    [savedViewEntries]
  );
  const jobSavedViews = useMemo(
    () => savedViewEntries.filter((item) => item.config.kind === 'jobs'),
    [savedViewEntries]
  );

  const handleSaveWorkflowView = useCallback(async () => {
    const name = window.prompt('Name this view');
    const trimmed = name?.trim();
    if (!trimmed) {
      return;
    }
    const config: RunSavedSearchConfig = {
      kind: 'workflows',
      filters: {
        search: workflowFilters.search,
        statuses: workflowFilters.statuses,
        triggerTypes: workflowFilters.triggerTypes
      }
    };
    try {
      await runSavedSearches.createSavedSearch({
        name: trimmed,
        description: null,
        searchInput: workflowFilters.search,
        statusFilters: workflowFilters.statuses,
        sort: 'recent',
        config
      });
      pushToast({
        tone: 'success',
        title: 'Saved view created',
        description: `Saved “${trimmed}”`
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to save view',
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }, [pushToast, runSavedSearches, workflowFilters]);

  const handleSaveJobView = useCallback(async () => {
    const name = window.prompt('Name this view');
    const trimmed = name?.trim();
    if (!trimmed) {
      return;
    }
    const config: RunSavedSearchConfig = {
      kind: 'jobs',
      filters: {
        search: jobFilters.search,
        statuses: jobFilters.statuses,
        runtimes: jobFilters.runtimes
      }
    };
    try {
      await runSavedSearches.createSavedSearch({
        name: trimmed,
        description: null,
        searchInput: jobFilters.search,
        statusFilters: jobFilters.statuses,
        sort: 'recent',
        config
      });
      pushToast({
        tone: 'success',
        title: 'Saved view created',
        description: `Saved “${trimmed}”`
      });
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to save view',
        description: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  }, [jobFilters, pushToast, runSavedSearches]);

  const handleApplySavedView = useCallback(
    async (record: RunSavedSearchRecord, config: RunSavedSearchConfig) => {
      if (config.kind === 'workflows') {
        setActiveTab('workflows');
        const statuses = config.filters.statuses && config.filters.statuses.length > 0 ? config.filters.statuses : record.statusFilters;
        const triggers = config.filters.triggerTypes ?? [];
        const nextFilters: WorkflowFilterState = {
          search: config.filters.search ?? record.searchInput ?? '',
          statuses: normalizeWorkflowStatuses(statuses),
          triggerTypes: normalizeWorkflowTriggers(triggers)
        };
        workflowFiltersRef.current = nextFilters;
        setWorkflowFilters(nextFilters);
        void loadWorkflowRuns({ filters: nextFilters });
      } else {
        setActiveTab('jobs');
        const statuses = config.filters.statuses && config.filters.statuses.length > 0 ? config.filters.statuses : record.statusFilters;
        const runtimes = config.filters.runtimes ?? [];
        const nextFilters: JobFilterState = {
          search: config.filters.search ?? record.searchInput ?? '',
          statuses: normalizeJobStatuses(statuses),
          runtimes: normalizeJobRuntimes(runtimes)
        };
        jobFiltersRef.current = nextFilters;
        setJobFilters(nextFilters);
        void loadJobRuns({ filters: nextFilters });
      }
      try {
        await runSavedSearches.recordSavedSearchApplied(record.slug);
        pushToast({
          tone: 'success',
          title: 'Saved view applied',
          description: `Applied “${record.name}”`
        });
      } catch (err) {
        pushToast({
          tone: 'error',
          title: 'Failed to apply view',
          description: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    },
    [loadJobRuns, loadWorkflowRuns, pushToast, runSavedSearches]
  );

  const handleRenameSavedView = useCallback(
    async (record: RunSavedSearchRecord) => {
      const nextName = window.prompt('Rename saved view', record.name);
      const trimmed = nextName?.trim();
      if (!trimmed || trimmed === record.name) {
        return;
      }
      try {
        await runSavedSearches.updateSavedSearch(record.slug, { name: trimmed });
        pushToast({ tone: 'success', title: 'Saved view renamed', description: `Renamed to “${trimmed}”` });
      } catch (err) {
        pushToast({
          tone: 'error',
          title: 'Failed to rename view',
          description: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    },
    [pushToast, runSavedSearches]
  );

  const handleDeleteSavedView = useCallback(
    async (record: RunSavedSearchRecord) => {
      const confirmed = window.confirm(`Delete saved view “${record.name}”?`);
      if (!confirmed) {
        return;
      }
      try {
        await runSavedSearches.deleteSavedSearch(record.slug);
        pushToast({ tone: 'info', title: 'Saved view deleted', description: `Deleted “${record.name}”` });
      } catch (err) {
        pushToast({
          tone: 'error',
          title: 'Failed to delete view',
          description: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    },
    [pushToast, runSavedSearches]
  );

  const handleShareSavedView = useCallback(
    async (record: RunSavedSearchRecord) => {
      const shareUrl = `${window.location.origin}${ROUTE_PATHS.runs}?saved=${encodeURIComponent(record.slug)}`;
      try {
        await runSavedSearches.recordSavedSearchShared(record.slug);
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          await navigator.clipboard.writeText(shareUrl);
          pushToast({ tone: 'success', title: 'Share link copied', description: 'Saved view link copied to clipboard.' });
        } else {
          pushToast({ tone: 'info', title: 'Share link ready', description: shareUrl });
        }
      } catch (err) {
        pushToast({
          tone: 'error',
          title: 'Failed to share view',
          description: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    },
    [pushToast, runSavedSearches]
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const savedSlug = params.get('saved');
    if (!savedSlug) {
      return;
    }

    let cancelled = false;

    const applyFromSlug = async () => {
      try {
        const record = await runSavedSearches.getSavedSearch(savedSlug);
        if (cancelled) {
          return;
        }
        if (!record) {
          pushToast({ tone: 'error', title: 'Saved view unavailable', description: 'The saved view could not be found.' });
          return;
        }
        const parsed = parseRunSavedSearchConfig(record.config);
        if (!parsed) {
          pushToast({ tone: 'error', title: 'Saved view incompatible', description: 'Unable to apply this saved view with the current filters.' });
          return;
        }
        await handleApplySavedView(record as RunSavedSearchRecord, parsed);
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('saved');
        window.history.replaceState({}, '', url.toString());
      }
    };

    void applyFromSlug();

    return () => {
      cancelled = true;
    };
  }, [handleApplySavedView, pushToast, runSavedSearches]);

  const loadWorkflowRuns = useCallback(
    async (options?: { offset?: number; append?: boolean; filters?: WorkflowFilterState }) => {
      const { offset = 0, append = false, filters } = options ?? {};
      const activeFilters = filters ?? workflowFiltersRef.current;
      const queryFilters = toWorkflowRunFilters(activeFilters);
      setWorkflowState((prev) => ({
        ...prev,
        loading: append ? prev.loading : true,
        loadingMore: append,
        error: append ? prev.error : null
      }));
      try {
        const result = await fetchWorkflowRuns(authorizedFetch, {
          limit: WORKFLOW_PAGE_SIZE,
          offset,
          filters: queryFilters
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
    async (options?: { offset?: number; append?: boolean; filters?: JobFilterState }) => {
      const { offset = 0, append = false, filters } = options ?? {};
      const activeFilters = filters ?? jobFiltersRef.current;
      const queryFilters = toJobRunFilters(activeFilters);
      setJobState((prev) => ({
        ...prev,
        loading: append ? prev.loading : true,
        loadingMore: append,
        error: append ? prev.error : null
      }));
      try {
        const result = await fetchJobRuns(authorizedFetch, {
          limit: JOB_PAGE_SIZE,
          offset,
          filters: queryFilters
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
    workflowFiltersRef.current = workflowFilters;
    if (!workflowFiltersInitialized.current) {
      workflowFiltersInitialized.current = true;
      return;
    }
    void loadWorkflowRuns();
  }, [workflowFilters, loadWorkflowRuns]);

  useEffect(() => {
    if (activeTab === 'jobs' && !jobState.loaded && !jobState.loading) {
      void loadJobRuns();
    }
  }, [activeTab, jobState.loaded, jobState.loading, loadJobRuns]);

  useEffect(() => {
    jobFiltersRef.current = jobFilters;
    if (!jobFiltersInitialized.current) {
      jobFiltersInitialized.current = true;
      return;
    }
    if (activeTab === 'jobs') {
      void loadJobRuns();
    }
  }, [activeTab, jobFilters, loadJobRuns]);

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

  const handleWorkflowSearchChange = useCallback((value: string) => {
    setWorkflowFilters((prev) => ({ ...prev, search: value }));
  }, []);

  const handleWorkflowStatusToggle = useCallback((status: WorkflowStatusOption) => {
    setWorkflowFilters((prev) => {
      const exists = prev.statuses.includes(status);
      const nextStatuses = exists ? prev.statuses.filter((item) => item !== status) : [...prev.statuses, status];
      return { ...prev, statuses: nextStatuses };
    });
  }, []);

  const handleWorkflowTriggerToggle = useCallback((trigger: WorkflowTriggerOption) => {
    setWorkflowFilters((prev) => {
      const exists = prev.triggerTypes.includes(trigger);
      const nextTriggers = exists ? prev.triggerTypes.filter((item) => item !== trigger) : [...prev.triggerTypes, trigger];
      return { ...prev, triggerTypes: nextTriggers };
    });
  }, []);

  const handleWorkflowResetFilters = useCallback(() => {
    setWorkflowFilters({ ...DEFAULT_WORKFLOW_FILTERS });
  }, []);

  const handleJobSearchChange = useCallback((value: string) => {
    setJobFilters((prev) => ({ ...prev, search: value }));
  }, []);

  const handleJobStatusToggle = useCallback((status: JobStatusOption) => {
    setJobFilters((prev) => {
      const exists = prev.statuses.includes(status);
      const nextStatuses = exists ? prev.statuses.filter((item) => item !== status) : [...prev.statuses, status];
      return { ...prev, statuses: nextStatuses };
    });
  }, []);

  const handleJobRuntimeToggle = useCallback((runtime: JobRuntimeOption) => {
    setJobFilters((prev) => {
      const exists = prev.runtimes.includes(runtime);
      const nextRuntimes = exists ? prev.runtimes.filter((item) => item !== runtime) : [...prev.runtimes, runtime];
      return { ...prev, runtimes: nextRuntimes };
    });
  }, []);

  const handleJobResetFilters = useCallback(() => {
    setJobFilters({ ...DEFAULT_JOB_FILTERS });
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
          <WorkflowFilterControls
            filters={workflowFilters}
            onSearchChange={handleWorkflowSearchChange}
            onStatusToggle={handleWorkflowStatusToggle}
            onTriggerToggle={handleWorkflowTriggerToggle}
            onReset={handleWorkflowResetFilters}
          />
          <SavedViewToolbar
            kind="workflows"
            savedViews={workflowSavedViews}
            loading={runSavedSearches.loading}
            error={runSavedSearches.error}
            mutationState={runSavedSearches.mutationState}
            onApply={handleApplySavedView}
            onRename={handleRenameSavedView}
            onDelete={handleDeleteSavedView}
            onShare={handleShareSavedView}
            onSaveCurrent={handleSaveWorkflowView}
            onRefresh={runSavedSearches.refresh}
          />
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
          <JobFilterControls
            filters={jobFilters}
            onSearchChange={handleJobSearchChange}
            onStatusToggle={handleJobStatusToggle}
            onRuntimeToggle={handleJobRuntimeToggle}
            onReset={handleJobResetFilters}
          />
          <SavedViewToolbar
            kind="jobs"
            savedViews={jobSavedViews}
            loading={runSavedSearches.loading}
            error={runSavedSearches.error}
            mutationState={runSavedSearches.mutationState}
            onApply={handleApplySavedView}
            onRename={handleRenameSavedView}
            onDelete={handleDeleteSavedView}
            onShare={handleShareSavedView}
            onSaveCurrent={handleSaveJobView}
            onRefresh={runSavedSearches.refresh}
          />
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
    return (
      <div className="rounded-2xl border border-slate-200/60 p-6 text-sm text-slate-600 dark:border-slate-700/70 dark:text-slate-300">
        <Spinner label="Loading workflow runs…" />
      </div>
    );
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
                Identifiers
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
                <td colSpan={8} className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
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
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        <div className="flex flex-col gap-1">
                          {entry.run.runKey ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                                Key
                              </span>
                              <code className="font-mono text-[11px] text-slate-700 dark:text-slate-100 break-all">
                                {entry.run.runKey}
                              </code>
                              <CopyButton value={entry.run.runKey} ariaLabel="Copy run key" />
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>
                          )}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-400 dark:text-slate-500">
                              ID
                            </span>
                            <code className="font-mono text-[11px] text-slate-700 dark:text-slate-100 break-all">
                              {entry.run.id}
                            </code>
                            <CopyButton value={entry.run.id} ariaLabel="Copy run id" />
                          </div>
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
                        <td colSpan={8} className="px-4 pb-6 pt-2 text-left align-top">
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
            {loadingMore ? <Spinner label="Loading more…" size="xs" /> : 'Load more'}
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
        <InfoRow label="Run key" value={run.runKey ?? '—'} copyValue={run.runKey ?? null} monospace />
        <InfoRow label="Run ID" value={run.id} copyValue={run.id} monospace />
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
          {loading && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              <Spinner label="Loading steps…" size="xs" />
            </span>
          )}
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
        <InfoRow label="Run ID" value={entry.run.id} copyValue={entry.run.id} monospace />
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
  copyValue?: string | null;
  monospace?: boolean;
};

function InfoRow({ label, value, copyValue, monospace = false }: InfoRowProps) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
      <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`font-medium text-slate-800 dark:text-slate-100 ${monospace ? 'break-all font-mono' : ''}`}
        >
          {value}
        </span>
        {copyValue ? <CopyButton value={copyValue} ariaLabel={`Copy ${label.toLowerCase()}`} /> : null}
      </div>
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
    return (
      <div className="rounded-2xl border border-slate-200/60 p-6 text-sm text-slate-600 dark:border-slate-700/70 dark:text-slate-300">
        <Spinner label="Loading job runs…" />
      </div>
    );
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
            {loadingMore ? <Spinner label="Loading more…" size="xs" /> : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
