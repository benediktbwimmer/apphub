import classNames from 'classnames';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthorizedFetch } from '../auth/useAuthorizedFetch';
import { Spinner, CopyButton, Modal } from '../components';
import { useToasts } from '../components/toast';
import { ROUTE_PATHS } from '../routes/paths';
import { useAppHubEvent } from '../events/context';
import {
  fetchJobRuns,
  fetchWorkflowActivity,
  retriggerJobRun,
  retriggerWorkflowRun,
  fetchWorkflowRunDiff,
  replayWorkflowRun,
  WorkflowRunReplayBlockedError,
  type JobRunListItem,
  type WorkflowActivityEntry,
  type WorkflowActivityDeliveryEntry,
  type WorkflowActivityRunEntry,
  type RunListMeta,
  type JobRunFilters,
  type WorkflowActivityFilters
} from './api';
import { listWorkflowRunSteps } from '../workflows/api';
import type { WorkflowRun, WorkflowRunStep } from '../workflows/types';
import { useSavedSearches } from '../savedSearches/useSavedSearches';
import type { SavedSearch, SavedSearchMutationState } from '../savedSearches/types';
import { getStatusToneClasses } from '../theme/statusTokens';
import type {
  WorkflowRunDiffPayload,
  WorkflowRunStaleAssetWarning,
  WorkflowRunDiffEntry,
  WorkflowRunStatusDiffEntry,
  WorkflowRunAssetDiffEntry
} from './types';

type RunsTabKey = 'workflows' | 'jobs';

type RunsTab = {
  key: RunsTabKey;
  label: string;
  description: string;
};

type CompareDialogState = {
  open: boolean;
  baseEntry: WorkflowActivityRunEntry | null;
  compareRunId: string | null;
  diff: WorkflowRunDiffPayload | null;
  loading: boolean;
  error: string | null;
};

type ReplayState = {
  runId: string | null;
  loading: boolean;
  warnings: WorkflowRunStaleAssetWarning[];
};

const WORKFLOW_PAGE_SIZE = 20;
const JOB_PAGE_SIZE = 25;

const WORKFLOW_STATUS_OPTIONS = ['pending', 'running', 'succeeded', 'failed', 'canceled', 'matched', 'throttled', 'skipped', 'launched'] as const;
type WorkflowStatusOption = (typeof WORKFLOW_STATUS_OPTIONS)[number];

const WORKFLOW_TRIGGER_OPTIONS = ['manual', 'schedule', 'event', 'auto-materialize'] as const;
type WorkflowTriggerOption = (typeof WORKFLOW_TRIGGER_OPTIONS)[number];

const WORKFLOW_KIND_OPTIONS = ['run', 'delivery'] as const;
type WorkflowKindOption = (typeof WORKFLOW_KIND_OPTIONS)[number];

const JOB_STATUS_OPTIONS = ['pending', 'running', 'succeeded', 'failed', 'canceled', 'expired'] as const;
type JobStatusOption = (typeof JOB_STATUS_OPTIONS)[number];

const JOB_RUNTIME_OPTIONS = ['node', 'python', 'docker'] as const;
type JobRuntimeOption = (typeof JOB_RUNTIME_OPTIONS)[number];

const PAGE_HEADER_TITLE_CLASSES = 'text-scale-2xl font-weight-semibold text-primary';

const PAGE_HEADER_SUBTITLE_CLASSES = 'text-scale-sm text-secondary';

const TAB_SWITCHER_CONTAINER_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass p-1 shadow-elevation-sm transition-colors';

const TAB_BUTTON_BASE_CLASSES =
  'rounded-full px-4 py-2 text-scale-sm font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const TAB_BUTTON_ACTIVE_CLASSES = 'bg-accent text-inverse shadow-elevation-sm';

const TAB_BUTTON_INACTIVE_CLASSES = 'text-secondary hover:bg-accent-soft hover:text-accent-strong';

const TAB_DESCRIPTION_CLASSES = 'text-scale-xs uppercase tracking-[0.2em] text-muted';

const STATUS_CHIP_BASE_CLASSES =
  'inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold capitalize';

const FILTER_PANEL_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-sm transition-colors';

const FILTER_SEARCH_INPUT_CLASSES =
  'min-w-[220px] flex-1 rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-elevation-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILTER_RESET_BUTTON_CLASSES =
  'rounded-full border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILTER_SECTION_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.24em] text-muted';

const FILTER_CHIP_BASE_CLASSES =
  'rounded-full border px-3 py-1 text-scale-xs font-weight-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const FILTER_CHIP_ACTIVE_CLASSES = 'border-accent bg-accent text-inverse shadow-elevation-sm';

const FILTER_CHIP_INACTIVE_CLASSES =
  'border-subtle bg-surface-glass text-secondary hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong';

const SAVED_VIEW_SECTION_CLASSES = FILTER_PANEL_CLASSES;

const SAVED_VIEW_TITLE_CLASSES = 'text-scale-sm font-weight-semibold text-primary';

const SAVED_VIEW_SUBTITLE_CLASSES = 'text-scale-xs text-secondary';

const SAVED_VIEW_REFRESH_BUTTON_CLASSES = FILTER_RESET_BUTTON_CLASSES;

const SAVED_VIEW_PRIMARY_BUTTON_CLASSES =
  'rounded-full border border-accent bg-accent px-3 py-1.5 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const SAVED_VIEW_EMPTY_TEXT_CLASSES = 'text-scale-sm text-secondary';

const SAVED_VIEW_ERROR_CLASSES =
  'rounded-lg border border-status-danger bg-status-danger-soft px-3 py-2 text-scale-xs font-weight-semibold text-status-danger';

const SAVED_VIEW_ITEM_CLASSES =
  'flex flex-col gap-2 rounded-xl border border-subtle bg-surface-glass px-3 py-2 shadow-elevation-sm';

const SAVED_VIEW_LINK_BUTTON_CLASSES =
  'text-left text-scale-sm font-weight-semibold text-accent transition-colors hover:text-accent-strong disabled:cursor-not-allowed disabled:text-muted';

const SAVED_VIEW_ACTION_BUTTON_BASE =
  'rounded-md px-2 py-1 text-scale-xs font-weight-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-muted';

const SAVED_VIEW_ACTION_BUTTON_NEUTRAL =
  'border border-transparent text-secondary hover:bg-accent-soft hover:text-accent-strong';

const SAVED_VIEW_ACTION_BUTTON_DELETE =
  'border border-transparent text-status-danger hover:bg-status-danger-soft hover:text-status-danger';

const SAVED_VIEW_SUMMARY_TEXT_CLASSES = 'flex flex-col gap-1 text-scale-xs text-secondary';

const TABLE_CARD_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass shadow-elevation-sm transition-colors';

const TABLE_HEADER_BAR_CLASSES =
  'flex items-center justify-between border-b border-subtle px-4 py-3 text-scale-sm text-secondary';

const TABLE_ELEMENT_CLASSES = 'min-w-full divide-y divide-subtle text-scale-sm';

const TABLE_HEAD_CELL_CLASSES =
  'px-4 py-3 text-left text-scale-xs font-weight-semibold uppercase tracking-[0.24em] text-muted';

const TABLE_BODY_ROW_BASE_CLASSES = 'cursor-pointer transition-colors';

const TABLE_BODY_ROW_SELECTED_CLASSES = 'bg-accent-soft shadow-elevation-sm';

const TABLE_BODY_ROW_DEFAULT_CLASSES = 'bg-surface-glass hover:bg-accent-soft/60';

const TABLE_META_TEXT_CLASSES = 'text-scale-xs text-secondary';

const TABLE_BADGE_LABEL_CLASSES = 'text-[10px] font-weight-semibold uppercase tracking-[0.3em] text-muted';

const TABLE_STACK_TEXT_CLASSES = 'flex flex-col gap-1 text-scale-xs text-secondary';

const TABLE_EMPTY_TEXT_CLASSES = 'px-4 py-6 text-center text-scale-sm text-muted';

const TABLE_ERROR_BAR_CLASSES = 'border-t border-status-warning bg-status-warning-soft px-4 py-3 text-scale-xs text-status-warning';

const TABLE_LOAD_MORE_CONTAINER_CLASSES = 'border-t border-subtle bg-surface-glass px-4 py-3 text-right';

const TERTIARY_BUTTON_CLASSES = 'inline-flex items-center justify-center rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const PRIMARY_RETRY_BUTTON_CLASSES =
  'self-start rounded-full border border-accent bg-accent px-3 py-1 text-scale-xs font-weight-semibold text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60';

const ERROR_PANEL_CLASSES =
  'flex flex-col gap-3 rounded-2xl border border-status-danger bg-status-danger-soft p-6 text-scale-sm text-status-danger';

const LOADING_PANEL_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-6 text-scale-sm text-secondary';

const DETAIL_PANEL_CONTAINER_CLASSES =
  'flex flex-col gap-4 rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg transition-colors';

const DETAIL_PANEL_HEADER_LABEL_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted';

const DETAIL_PANEL_HEADER_TITLE_CLASSES = 'text-scale-lg font-weight-semibold text-primary';

const DETAIL_PANEL_ACTION_PRIMARY =
  'rounded-full border border-accent bg-accent px-4 py-1.5 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-inverse shadow-elevation-sm transition-colors hover:bg-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const DETAIL_PANEL_ACTION_SECONDARY =
  'rounded-full border border-subtle bg-surface-glass px-4 py-1.5 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const DETAIL_PANEL_BODY_TEXT_CLASSES = 'text-scale-xs text-secondary';

const JSON_PREVIEW_CONTAINER_CLASSES =
  'flex flex-col gap-2 rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-secondary';

const JSON_PREVIEW_TITLE_CLASSES = 'text-[11px] font-weight-semibold uppercase tracking-[0.25em] text-muted';

const JSON_PREVIEW_CONTENT_CLASSES = 'max-h-48 overflow-auto rounded-lg bg-surface-sunken px-3 py-2 text-scale-xs text-primary';

const JSON_PREVIEW_EMPTY_TEXT_CLASSES = 'text-scale-xs text-muted';

const INFO_ROW_CONTAINER_CLASSES =
  'flex flex-col gap-1 rounded-xl border border-subtle bg-surface-muted px-3 py-2 text-scale-sm text-secondary';

const INFO_ROW_LABEL_CLASSES = 'text-[11px] font-weight-semibold uppercase tracking-[0.25em] text-muted';

const INFO_ROW_VALUE_CLASSES = 'font-weight-medium text-primary';

const INFO_ROW_MONO_VALUE_CLASSES = 'break-all font-mono text-scale-xs';

const DETAIL_PANEL_ALERT_BASE_CLASSES = 'rounded-2xl border px-3 py-2 text-scale-sm font-weight-medium';

const DETAIL_PANEL_EMPTY_STATE_CLASSES =
  'rounded-xl border border-subtle bg-surface-muted px-3 py-2 text-scale-sm text-secondary';

const DETAIL_PANEL_STEP_CARD_CLASSES =
  'rounded-xl border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-secondary shadow-elevation-sm';

const DETAIL_PANEL_STEP_TITLE_CLASSES = 'font-weight-semibold text-primary';

const DETAIL_PANEL_STEP_META_CLASSES = 'text-scale-xs text-secondary';











type RunSavedSearchConfig =
  | {
      kind: 'workflows';
      filters: {
        search?: string;
        statuses?: string[];
        triggerTypes?: string[];
        kinds?: string[];
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
  kinds: WorkflowKindOption[];
};

type JobFilterState = {
  search: string;
  statuses: JobStatusOption[];
  runtimes: JobRuntimeOption[];
};

const DEFAULT_WORKFLOW_FILTERS: WorkflowFilterState = {
  search: '',
  statuses: [],
  triggerTypes: [],
  kinds: [...WORKFLOW_KIND_OPTIONS]
};

const DEFAULT_JOB_FILTERS: JobFilterState = {
  search: '',
  statuses: [],
  runtimes: []
};

const WORKFLOW_STATUS_SET = new Set<WorkflowStatusOption>(WORKFLOW_STATUS_OPTIONS);
const WORKFLOW_TRIGGER_SET = new Set<WorkflowTriggerOption>(WORKFLOW_TRIGGER_OPTIONS);
const WORKFLOW_KIND_SET = new Set<WorkflowKindOption>(WORKFLOW_KIND_OPTIONS);
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

function normalizeWorkflowKinds(values: Iterable<string>): WorkflowKindOption[] {
  const result: WorkflowKindOption[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase() as WorkflowKindOption;
    if (WORKFLOW_KIND_SET.has(normalized) && !result.includes(normalized)) {
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

function toWorkflowActivityFilters(filters: WorkflowFilterState): WorkflowActivityFilters {
  return {
    statuses: filters.statuses,
    triggerTypes: filters.triggerTypes,
    kinds: filters.kinds,
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
    const kinds = Array.isArray(filters.kinds) ? filters.kinds.map(String) : [];
    const search = typeof filters.search === 'string' ? filters.search : '';
    return {
      kind: 'workflows',
      filters: {
        search,
        statuses,
        triggerTypes,
        kinds
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
  const chipClasses = classNames(
    FILTER_CHIP_BASE_CLASSES,
    active ? FILTER_CHIP_ACTIVE_CLASSES : FILTER_CHIP_INACTIVE_CLASSES
  );

  return (
    <button
      type="button"
      onClick={onToggle}
      className={chipClasses}
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
  onKindToggle: (kind: WorkflowKindOption) => void;
  onReset: () => void;
};

function WorkflowFilterControls({ filters, onSearchChange, onStatusToggle, onTriggerToggle, onKindToggle, onReset }: WorkflowFilterControlsProps) {
  return (
    <section className={FILTER_PANEL_CLASSES}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by run key, run ID, workflow, or trigger"
          className={FILTER_SEARCH_INPUT_CLASSES}
        />
        <button
          type="button"
          onClick={onReset}
          className={FILTER_RESET_BUTTON_CLASSES}
        >
          Reset
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={FILTER_SECTION_LABEL_CLASSES}>Status</span>
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
        <span className={FILTER_SECTION_LABEL_CLASSES}>Trigger</span>
        {WORKFLOW_TRIGGER_OPTIONS.map((trigger) => (
          <FilterChip
            key={trigger}
            label={formatFilterLabel(trigger)}
            active={filters.triggerTypes.includes(trigger)}
            onToggle={() => onTriggerToggle(trigger)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={FILTER_SECTION_LABEL_CLASSES}>Include</span>
        {WORKFLOW_KIND_OPTIONS.map((kind) => (
          <FilterChip
            key={kind}
            label={formatFilterLabel(kind)}
            active={filters.kinds.includes(kind)}
            onToggle={() => onKindToggle(kind)}
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
    <section className={FILTER_PANEL_CLASSES}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by run ID or job"
          className={FILTER_SEARCH_INPUT_CLASSES}
        />
        <button
          type="button"
          onClick={onReset}
          className={FILTER_RESET_BUTTON_CLASSES}
        >
          Reset
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={FILTER_SECTION_LABEL_CLASSES}>Status</span>
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
        <span className={FILTER_SECTION_LABEL_CLASSES}>Runtime</span>
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
    <section className={SAVED_VIEW_SECTION_CLASSES}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className={SAVED_VIEW_TITLE_CLASSES}>{title}</h3>
          <p className={SAVED_VIEW_SUBTITLE_CLASSES}>{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void onRefresh();
            }}
            disabled={loading}
            className={SAVED_VIEW_REFRESH_BUTTON_CLASSES}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={onSaveCurrent}
            disabled={mutationState.creating}
            className={SAVED_VIEW_PRIMARY_BUTTON_CLASSES}
          >
            {mutationState.creating ? 'Saving…' : 'Save current view'}
          </button>
        </div>
      </div>
      {error && (
        <div className={SAVED_VIEW_ERROR_CLASSES}>
          {error}
        </div>
      )}
      {loading && savedViews.length === 0 ? (
        <div className={SAVED_VIEW_EMPTY_TEXT_CLASSES}>Loading saved views…</div>
      ) : savedViews.length === 0 ? (
        <div className={SAVED_VIEW_EMPTY_TEXT_CLASSES}>No saved views yet.</div>
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
              <li key={entry.id} className={SAVED_VIEW_ITEM_CLASSES}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => onApply(entry, config)}
                    disabled={isApplying || isDeleting}
                    className={SAVED_VIEW_LINK_BUTTON_CLASSES}
                  >
                    {isApplying ? 'Applying…' : entry.name}
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onShare(entry)}
                      disabled={isSharing || isDeleting}
                      className={classNames(SAVED_VIEW_ACTION_BUTTON_BASE, SAVED_VIEW_ACTION_BUTTON_NEUTRAL)}
                    >
                      {isSharing ? 'Sharing…' : 'Share'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRename(entry)}
                      disabled={isRenaming || isDeleting}
                      className={classNames(SAVED_VIEW_ACTION_BUTTON_BASE, SAVED_VIEW_ACTION_BUTTON_NEUTRAL)}
                    >
                      {isRenaming ? 'Renaming…' : 'Rename'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(entry)}
                      disabled={isDeleting}
                      className={classNames(SAVED_VIEW_ACTION_BUTTON_BASE, SAVED_VIEW_ACTION_BUTTON_DELETE)}
                    >
                      {isDeleting ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div className={SAVED_VIEW_SUMMARY_TEXT_CLASSES}>
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
  items: WorkflowActivityEntry[];
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
  return getStatusToneClasses(status);
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
  const [selectedWorkflowEntry, setSelectedWorkflowEntry] = useState<WorkflowActivityEntry | null>(null);
  const [workflowRunDetail, setWorkflowRunDetail] = useState<{ run: WorkflowRun; steps: WorkflowRunStep[] } | null>(null);
  const [workflowDetailLoading, setWorkflowDetailLoading] = useState(false);
  const [workflowDetailError, setWorkflowDetailError] = useState<string | null>(null);
  const [selectedJobEntry, setSelectedJobEntry] = useState<JobRunListItem | null>(null);
  const [compareState, setCompareState] = useState<CompareDialogState>({
    open: false,
    baseEntry: null,
    compareRunId: null,
    diff: null,
    loading: false,
    error: null
  });
  const [replayState, setReplayState] = useState<ReplayState>({
    runId: null,
    loading: false,
    warnings: []
  });

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
        triggerTypes: workflowFilters.triggerTypes,
        kinds: workflowFilters.kinds
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

  const loadWorkflowRuns = useCallback(
    async (options?: { offset?: number; append?: boolean; filters?: WorkflowFilterState }) => {
      const { offset = 0, append = false, filters } = options ?? {};
      const activeFilters = filters ?? workflowFiltersRef.current;
      const queryFilters = toWorkflowActivityFilters(activeFilters);
      setWorkflowState((prev) => ({
        ...prev,
        loading: append ? prev.loading : true,
        loadingMore: append,
        error: append ? prev.error : null
      }));
      try {
        const result = await fetchWorkflowActivity(authorizedFetch, {
          limit: WORKFLOW_PAGE_SIZE,
          offset,
          filters: queryFilters
        });
        const filteredItems = queryFilters.kinds && queryFilters.kinds.length > 0
          ? result.items.filter((entry) => queryFilters.kinds?.includes(entry.kind))
          : result.items;
        setWorkflowState((prev) => ({
          ...prev,
          items: append ? [...prev.items, ...filteredItems] : filteredItems,
          meta: result.meta,
          loading: false,
          loadingMore: false,
          error: null,
          loaded: true
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load workflow activity';
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

  const handleApplySavedView = useCallback(
    async (record: RunSavedSearchRecord, config: RunSavedSearchConfig) => {
      if (config.kind === 'workflows') {
        setActiveTab('workflows');
        const statuses = config.filters.statuses && config.filters.statuses.length > 0 ? config.filters.statuses : record.statusFilters;
        const triggers = config.filters.triggerTypes ?? [];
        const kinds = config.filters.kinds && config.filters.kinds.length > 0 ? config.filters.kinds : WORKFLOW_KIND_OPTIONS;
        const nextFilters: WorkflowFilterState = {
          search: config.filters.search ?? record.searchInput ?? '',
          statuses: normalizeWorkflowStatuses(statuses),
          triggerTypes: normalizeWorkflowTriggers(triggers),
          kinds: normalizeWorkflowKinds(kinds)
        };
        if (nextFilters.kinds.length === 0) {
          nextFilters.kinds = [...WORKFLOW_KIND_OPTIONS];
        }
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
    if (!selectedWorkflowEntry || selectedWorkflowEntry.kind !== 'run') {
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
    if (!selectedWorkflowEntry) {
      return;
    }
    const selectedRunId = selectedWorkflowEntry.run?.id ?? null;
    if (!selectedRunId) {
      setSelectedWorkflowEntry(null);
      return;
    }
    const exists = workflowState.items.some((item) => item.run?.id === selectedRunId);
    if (!exists) {
      setSelectedWorkflowEntry(null);
    }
  }, [workflowState.items, selectedWorkflowEntry]);

  useEffect(() => {
    setReplayState((current) => {
      if (!selectedWorkflowEntry || selectedWorkflowEntry.kind !== 'run') {
        return current.runId ? { runId: null, loading: false, warnings: [] } : current;
      }
      if (current.runId && current.runId !== selectedWorkflowEntry.run.id) {
        return { runId: null, loading: false, warnings: [] };
      }
      return current;
    });
  }, [selectedWorkflowEntry]);

  useEffect(() => {
    if (!selectedJobEntry) {
      return;
    }
    const selectedRunId = selectedJobEntry.run?.id ?? null;
    if (!selectedRunId) {
      setSelectedJobEntry(null);
      return;
    }
    const exists = jobState.items.some((item) => item.run?.id === selectedRunId);
    if (!exists) {
      setSelectedJobEntry(null);
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

  const loadCompareDiff = useCallback(
    async (baseEntry: WorkflowActivityRunEntry, compareRunId: string) => {
      setCompareState((current) => {
        if (current.baseEntry && current.baseEntry.run.id !== baseEntry.run.id) {
          return current;
        }
        return {
          open: true,
          baseEntry,
          compareRunId,
          diff: null,
          loading: true,
          error: null
        };
      });
      try {
        const diff = await fetchWorkflowRunDiff(authorizedFetch, {
          runId: baseEntry.run.id,
          compareTo: compareRunId
        });
        setCompareState((current) => {
          if (
            !current.baseEntry ||
            current.baseEntry.run.id !== baseEntry.run.id ||
            current.compareRunId !== compareRunId
          ) {
            return current;
          }
          return {
            ...current,
            diff,
            loading: false,
            error: null
          };
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load workflow run diff';
        setCompareState((current) => {
          if (
            !current.baseEntry ||
            current.baseEntry.run.id !== baseEntry.run.id ||
            current.compareRunId !== compareRunId
          ) {
            return current;
          }
          return {
            ...current,
            loading: false,
            error: message
          };
        });
      }
    },
    [authorizedFetch]
  );

  const handleOpenCompareDialog = useCallback(
    (entry: WorkflowActivityRunEntry) => {
      const candidates = workflowState.items.filter(
        (item): item is WorkflowActivityRunEntry =>
          item.kind === 'run' &&
          item.workflow.id === entry.workflow.id &&
          item.run.id !== entry.run.id
      );
      const defaultCompareId = candidates.length > 0 ? candidates[0].run.id : null;
      setCompareState({
        open: true,
        baseEntry: entry,
        compareRunId: defaultCompareId,
        diff: null,
        loading: Boolean(defaultCompareId),
        error: null
      });
      if (defaultCompareId) {
        void loadCompareDiff(entry, defaultCompareId);
      }
    },
    [workflowState.items, loadCompareDiff]
  );

  const handleCloseCompareDialog = useCallback(() => {
    setCompareState({ open: false, baseEntry: null, compareRunId: null, diff: null, loading: false, error: null });
  }, []);

  const handleSelectCompareRun = useCallback(
    (runId: string) => {
      if (!runId || !compareState.baseEntry) {
        return;
      }
      if (compareState.compareRunId === runId && !compareState.loading) {
        return;
      }
      setCompareState((current) => {
        if (!current.baseEntry) {
          return current;
        }
        return { ...current, compareRunId: runId };
      });
      void loadCompareDiff(compareState.baseEntry, runId);
    },
    [compareState.baseEntry, compareState.compareRunId, compareState.loading, loadCompareDiff]
  );

  const handleWorkflowRetrigger = useCallback(
    async (entry: WorkflowActivityRunEntry) => {
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

  const handleWorkflowReplay = useCallback(
    async (entry: WorkflowActivityRunEntry, options: { allowStaleAssets?: boolean } = {}) => {
      setReplayState({ runId: entry.run.id, loading: true, warnings: [] });
      try {
        await replayWorkflowRun(authorizedFetch, entry.run.id, {
          allowStaleAssets: options.allowStaleAssets ?? false
        });
        pushToast({
          tone: 'success',
          title: 'Replay enqueued',
          description: `Workflow ${entry.workflow.slug} run replay queued`
        });
        setReplayState({ runId: null, loading: false, warnings: [] });
        await loadWorkflowRuns();
      } catch (err) {
        if (err instanceof WorkflowRunReplayBlockedError) {
          setReplayState({ runId: entry.run.id, loading: false, warnings: err.staleAssets });
          pushToast({
            tone: 'warning',
            title: 'Replay requires confirmation',
            description: 'Stale assets were detected for this workflow run.'
          });
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to replay workflow run';
        pushToast({
          tone: 'error',
          title: 'Replay failed',
          description: message
        });
        setReplayState({ runId: null, loading: false, warnings: [] });
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

  const handleWorkflowSelect = useCallback((entry: WorkflowActivityEntry) => {
    setSelectedWorkflowEntry((current) => {
      if (!current) {
        return entry;
      }
      if (current.kind === 'run' && entry.kind === 'run' && current.run.id === entry.run.id) {
        return null;
      }
      if (current.kind === 'delivery' && entry.kind === 'delivery' && current.delivery.id === entry.delivery.id) {
        return null;
      }
      return entry;
    });
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

  const handleWorkflowKindToggle = useCallback((kind: WorkflowKindOption) => {
    setWorkflowFilters((prev) => {
      const exists = prev.kinds.includes(kind);
      let nextKinds = exists ? prev.kinds.filter((item) => item !== kind) : [...prev.kinds, kind];
      if (nextKinds.length === 0) {
        nextKinds = [kind];
      }
      return { ...prev, kinds: nextKinds };
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

  const compareCandidates = useMemo(() => {
    if (!compareState.baseEntry) {
      return [] as WorkflowActivityRunEntry[];
    }
    return workflowState.items.filter(
      (item): item is WorkflowActivityRunEntry =>
        item.kind === 'run' &&
        item.workflow.id === compareState.baseEntry?.workflow.id &&
        item.run.id !== compareState.baseEntry?.run.id
    );
  }, [workflowState.items, compareState.baseEntry]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={PAGE_HEADER_TITLE_CLASSES}>Runs</h1>
        <p className={PAGE_HEADER_SUBTITLE_CLASSES}>
          Monitor recent workflow and job runs, inspect timing, and retrigger executions when needed.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <div className={TAB_SWITCHER_CONTAINER_CLASSES}>
          {TABS.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={classNames(
                  TAB_BUTTON_BASE_CLASSES,
                  isActive ? TAB_BUTTON_ACTIVE_CLASSES : TAB_BUTTON_INACTIVE_CLASSES
                )}
                aria-pressed={isActive}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <p className={TAB_DESCRIPTION_CLASSES}>
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
            onKindToggle={handleWorkflowKindToggle}
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
              if (selectedWorkflowEntry.kind === 'run') {
                params.set('run', selectedWorkflowEntry.run.id);
              } else if (selectedWorkflowEntry.delivery.workflowRunId) {
                params.set('run', selectedWorkflowEntry.delivery.workflowRunId);
              }
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
      <WorkflowRunCompareDialog
        open={compareState.open}
        baseEntry={compareState.baseEntry}
        compareRunId={compareState.compareRunId}
        candidates={compareCandidates}
        diff={compareState.diff}
        loading={compareState.loading}
        error={compareState.error}
        onClose={handleCloseCompareDialog}
        onSelectCompare={handleSelectCompareRun}
      />
    </div>
  );
}

type WorkflowRunsTableProps = {
  state: WorkflowRunsState;
  onRetry: (entry: WorkflowActivityRunEntry) => void;
  pendingRunId: string | null;
  onReload: () => void;
  onLoadMore: () => void;
  onSelect: (entry: WorkflowActivityEntry) => void;
  selectedEntry: WorkflowActivityEntry | null;
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
  const selectedRunId = selectedEntry?.kind === 'run' ? selectedEntry.run.id : null;
  const selectedDeliveryId = selectedEntry?.kind === 'delivery' ? selectedEntry.delivery.id : null;

  if (loading && !state.loaded) {
    return (
      <div className={LOADING_PANEL_CLASSES}>
        <Spinner label="Loading workflow runs…" />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className={ERROR_PANEL_CLASSES}>
        <span>{error}</span>
        <button
          type="button"
          className={PRIMARY_RETRY_BUTTON_CLASSES}
          onClick={onReload}
          disabled={loading}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={TABLE_CARD_CLASSES}>
      <div className={TABLE_HEADER_BAR_CLASSES}>
        <span>Workflow runs</span>
        {loading && state.loaded && (
          <span className={TABLE_META_TEXT_CLASSES}>Updating…</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE_ELEMENT_CLASSES}>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Type
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Workflow
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Identifiers
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Context
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Timing
              </th>
              <th scope="col" className={`${TABLE_HEAD_CELL_CLASSES} text-right`}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {items.length === 0 ? (
              <tr>
                <td colSpan={6} className={TABLE_EMPTY_TEXT_CLASSES}>No workflow activity recorded yet.</td>
              </tr>
            ) : (
              items.map((entry) => {
                const runEntry = entry.kind === 'run' ? entry : null;
                const deliveryEntry = entry.kind === 'delivery' ? entry : null;
                const isRun = Boolean(runEntry);
                const rowKey = runEntry ? runEntry.run.id : deliveryEntry!.delivery.id;
                const isSelected = runEntry
                  ? selectedRunId === runEntry.run.id
                  : selectedDeliveryId === deliveryEntry!.delivery.id;
                const detailForEntry = runEntry && detail?.run.id === runEntry.run.id ? detail : null;
                const detailErrorForEntry = runEntry && isSelected ? detailError : null;
                const detailLoadingForEntry = runEntry && isSelected ? detailLoading : false;
                const durationMs = runEntry
                  ? computeDurationMs(runEntry.run.startedAt, runEntry.run.completedAt, runEntry.run.durationMs)
                  : null;
                const isPending = runEntry ? pendingRunId === runEntry.run.id : false;
                const replayIsLoading =
                  runEntry && replayState.runId === runEntry.run.id ? replayState.loading : false;
                const replayWarningsForEntry =
                  runEntry && replayState.runId === runEntry.run.id ? replayState.warnings : [];
                const nextAttemptText = deliveryEntry
                  ? deliveryEntry.delivery.nextAttemptAt
                    ? `Next attempt ${formatDateTime(deliveryEntry.delivery.nextAttemptAt)}`
                    : deliveryEntry.delivery.throttledUntil
                      ? `Throttled until ${formatDateTime(deliveryEntry.delivery.throttledUntil)}`
                      : null
                  : null;
                const linkedRunId = deliveryEntry?.delivery.workflowRunId ?? null;

                return (
                  <Fragment key={rowKey}>
                    <tr
                      className={classNames(
                        TABLE_BODY_ROW_BASE_CLASSES,
                        isSelected ? TABLE_BODY_ROW_SELECTED_CLASSES : TABLE_BODY_ROW_DEFAULT_CLASSES
                      )}
                      onClick={() => onSelect(entry)}
                      aria-selected={isSelected}
                    >
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col gap-2">
                          <span className="text-[11px] font-weight-semibold uppercase tracking-[0.3em] text-muted">
                            {isRun ? 'Run' : 'Delivery'}
                          </span>
                          <span className={`${STATUS_CHIP_BASE_CLASSES} ${statusChipClass(entry.status)}`}>
                            {formatFilterLabel(entry.status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col text-scale-sm">
                          <span className="font-weight-semibold text-primary">
                            {entry.workflow.name}
                          </span>
                          <span className={TABLE_META_TEXT_CLASSES}>{entry.workflow.slug}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        {runEntry ? (
                          <div className={TABLE_STACK_TEXT_CLASSES}>
                            {runEntry.run.runKey ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={TABLE_BADGE_LABEL_CLASSES}>
                                  Key
                                </span>
                                <code className="break-all font-mono text-[11px] text-secondary">
                                  {runEntry.run.runKey}
                                </code>
                                <CopyButton value={runEntry.run.runKey} ariaLabel="Copy run key" />
                              </div>
                            ) : (
                          <span className={TABLE_META_TEXT_CLASSES}>—</span>
                            )}
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={TABLE_BADGE_LABEL_CLASSES}>
                                ID
                              </span>
                              <code className="break-all font-mono text-[11px] text-secondary">
                                {runEntry.run.id}
                              </code>
                              <CopyButton value={runEntry.run.id} ariaLabel="Copy run id" />
                            </div>
                          </div>
                        ) : (
                          <div className={TABLE_STACK_TEXT_CLASSES}>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={TABLE_BADGE_LABEL_CLASSES}>
                                Delivery
                              </span>
                              <code className="break-all font-mono text-[11px] text-secondary">
                                {deliveryEntry!.delivery.id}
                              </code>
                              <CopyButton value={deliveryEntry!.delivery.id} ariaLabel="Copy delivery id" />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={TABLE_BADGE_LABEL_CLASSES}>
                                Event
                              </span>
                              <code className="break-all font-mono text-[11px] text-secondary">
                                {deliveryEntry!.delivery.eventId ?? '—'}
                              </code>
                              {deliveryEntry!.delivery.eventId && (
                                <CopyButton value={deliveryEntry!.delivery.eventId!} ariaLabel="Copy event id" />
                              )}
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={TABLE_BADGE_LABEL_CLASSES}>
                                Dedupe
                              </span>
                              <code className="break-all font-mono text-[11px] text-secondary">
                                {deliveryEntry!.delivery.dedupeKey ?? '—'}
                              </code>
                              {deliveryEntry!.delivery.dedupeKey && (
                                <CopyButton value={deliveryEntry!.delivery.dedupeKey!} ariaLabel="Copy dedupe key" />
                              )}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        {runEntry ? (
                          <div className={TABLE_STACK_TEXT_CLASSES}>
                            <span>Triggered by: {runEntry.run.triggeredBy ?? '—'}</span>
                            <span>Partition: {runEntry.run.partitionKey ?? '—'}</span>
                          </div>
                        ) : (
                          <div className={TABLE_STACK_TEXT_CLASSES}>
                            <span>
                              Trigger:{' '}
                              {entry.trigger
                                ? `${entry.trigger.name ?? entry.trigger.id ?? '—'} (${entry.trigger.eventType ?? 'unknown'})`
                                : '—'}
                            </span>
                            <span>Attempts: {deliveryEntry!.delivery.attempts}</span>
                            <span>Linked run: {linkedRunId ?? '—'}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        <div className={TABLE_STACK_TEXT_CLASSES}>
                          <span>
                            {runEntry
                              ? `Started: ${formatDateTime(runEntry.run.startedAt)}`
                              : `Occurred: ${formatDateTime(entry.occurredAt)}`}
                          </span>
                          {runEntry ? (
                            <span>Completed: {formatDateTime(runEntry.run.completedAt)}</span>
                          ) : (
                            <>
                              {nextAttemptText && <span>{nextAttemptText}</span>}
                              <span>Updated: {formatDateTime(deliveryEntry!.delivery.updatedAt)}</span>
                            </>
                          )}
                          {runEntry && <span>Duration: {formatDuration(durationMs)}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        {runEntry ? (
                          <button
                            type="button"
                            className={PRIMARY_RETRY_BUTTON_CLASSES}
                            onClick={(event) => {
                              event.stopPropagation();
                              onRetry(runEntry);
                            }}
                            disabled={isPending}
                          >
                            {isPending ? 'Retriggering…' : 'Retrigger'}
                          </button>
                        ) : (
                          <span className="text-scale-xs text-muted">—</span>
                        )}
                      </td>
                    </tr>
                    {runEntry && isSelected && (
                      <tr className="bg-accent-soft/60">
                        <td colSpan={6} className="px-4 pb-6 pt-2 text-left align-top">
                          <WorkflowRunDetailPanel
                            entry={runEntry}
                            detail={detailForEntry}
                            loading={detailLoadingForEntry}
                            error={detailErrorForEntry}
                            onClose={onCloseDetail}
                            onViewWorkflow={onViewWorkflow}
                            onReplay={handleWorkflowReplay}
                            replayLoading={replayIsLoading}
                            replayWarnings={replayWarningsForEntry}
                            onCompare={handleOpenCompareDialog}
                          />
                        </td>
                      </tr>
                    )}
                    {deliveryEntry && isSelected && (
                      <tr className="bg-accent-soft/60">
                        <td colSpan={6} className="px-4 pb-6 pt-2 text-left align-top">
                          <WorkflowDeliveryDetailPanel
                            entry={deliveryEntry}
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
      {error && items.length > 0 && <div className={TABLE_ERROR_BAR_CLASSES}>{error}</div>}
      {hasMore && (
        <div className={TABLE_LOAD_MORE_CONTAINER_CLASSES}>
          <button
            type="button"
            className={TERTIARY_BUTTON_CLASSES}
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

type WorkflowRunCompareDialogProps = {
  open: boolean;
  baseEntry: WorkflowActivityRunEntry | null;
  compareRunId: string | null;
  candidates: WorkflowActivityRunEntry[];
  diff: WorkflowRunDiffPayload | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectCompare: (runId: string) => void;
};

function WorkflowRunCompareDialog({
  open,
  baseEntry,
  compareRunId,
  candidates,
  diff,
  loading,
  error,
  onClose,
  onSelectCompare
}: WorkflowRunCompareDialogProps) {
  const baseRun = baseEntry?.run ?? null;
  const compareRun = diff?.compare.run ?? null;
  const statusDiff = diff?.diff.statusTransitions ?? [];

  return (
    <Modal open={open} onClose={onClose} contentClassName="max-w-5xl p-6">
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <span className={DETAIL_PANEL_HEADER_LABEL_CLASSES}>Compare workflow runs</span>
          <h3 className={DETAIL_PANEL_HEADER_TITLE_CLASSES}>{baseEntry?.workflow.name ?? 'Select run'}</h3>
        </header>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-muted">
            Compare against
            <select
              className="rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-elevation-sm"
              value={compareRunId ?? ''}
              onChange={(event) => onSelectCompare(event.target.value)}
              disabled={candidates.length === 0}
            >
              <option value="" disabled>
                Select a run…
              </option>
              {candidates.map((candidate) => (
                <option key={candidate.run.id} value={candidate.run.id}>
                  {`${formatDateTime(candidate.run.createdAt)} · ${candidate.run.status}`}
                </option>
              ))}
            </select>
          </label>
          {candidates.length === 0 && (
            <span className="text-scale-xs text-muted">No other runs available for comparison.</span>
          )}
          {error && (
            <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('warning')}`}>{error}</div>
          )}
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-scale-sm text-secondary">
            <Spinner label="Loading diff…" size="sm" />
          </div>
        )}
        {!loading && !diff && (!compareRunId || compareRunId.length === 0) && (
          <div className={DETAIL_PANEL_EMPTY_STATE_CLASSES}>Select another run to generate a diff.</div>
        )}
        {diff && !loading && (
          <div className="flex flex-col gap-4">
            <section className="grid gap-3 md:grid-cols-2">
              <InfoRow label="Base run" value={baseRun?.id ?? '—'} copyValue={baseRun?.id ?? null} monospace />
              <InfoRow
                label="Compared run"
                value={compareRun?.id ?? (compareRunId ? compareRunId : '—')}
                copyValue={compareRun?.id ?? compareRunId}
                monospace
              />
              <InfoRow label="Base status" value={baseRun?.status ?? '—'} />
              <InfoRow label="Compared status" value={compareRun?.status ?? '—'} />
            </section>

            <JsonDiffSection title="Parameters" entries={diff.diff.parameters} />
            <JsonDiffSection title="Context" entries={diff.diff.context} />
            <JsonDiffSection title="Output" entries={diff.diff.output} />
            <StatusDiffSection entries={statusDiff} />
            <AssetDiffSection entries={diff.diff.assets} />
            {diff.staleAssets.length > 0 && (
              <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('warning')}`}>
                <span className="font-weight-semibold">Stale assets recorded on base run:</span>
                <ul className="mt-2 flex flex-col gap-1 text-scale-xs">
                  {diff.staleAssets.map((warning) => (
                    <li key={`${warning.assetId}:${warning.partitionKey ?? 'global'}`}>
                      <span className="font-weight-medium text-primary">{warning.assetId}</span>
                      {warning.partitionKey ? ` · Partition ${warning.partitionKey}` : ''}
                      {` · Requested ${formatDateTime(warning.requestedAt)}`}
                      {warning.requestedBy ? ` · by ${warning.requestedBy}` : ''}
                      {warning.note ? ` · ${warning.note}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

type JsonDiffSectionProps = {
  title: string;
  entries: WorkflowRunDiffEntry[];
};

function JsonDiffSection({ title, entries }: JsonDiffSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={DETAIL_PANEL_STEP_TITLE_CLASSES}>{title}</h4>
      {entries.length === 0 ? (
        <span className={DETAIL_PANEL_EMPTY_STATE_CLASSES}>No differences detected.</span>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={`${title}:${entry.path}`} className={JSON_PREVIEW_CONTAINER_CLASSES}>
              <div className="flex items-center justify-between gap-2 text-scale-xs font-weight-semibold text-primary">
                <span>{entry.path}</span>
                <span className="uppercase tracking-[0.24em] text-muted">{entry.change}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <span className={JSON_PREVIEW_TITLE_CLASSES}>Before</span>
                  <pre className={`${JSON_PREVIEW_CONTENT_CLASSES} whitespace-pre-wrap`}>
                    {formatJson(entry.before)}
                  </pre>
                </div>
                <div>
                  <span className={JSON_PREVIEW_TITLE_CLASSES}>After</span>
                  <pre className={`${JSON_PREVIEW_CONTENT_CLASSES} whitespace-pre-wrap`}>
                    {formatJson(entry.after)}
                  </pre>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type StatusDiffSectionProps = {
  entries: WorkflowRunStatusDiffEntry[];
};

function StatusDiffSection({ entries }: StatusDiffSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={DETAIL_PANEL_STEP_TITLE_CLASSES}>Status transitions</h4>
      {entries.length === 0 ? (
        <span className={DETAIL_PANEL_EMPTY_STATE_CLASSES}>No status differences detected.</span>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.index} className={DETAIL_PANEL_STEP_CARD_CLASSES}>
              <div className="flex items-center justify-between">
                <span className="text-scale-xs uppercase tracking-[0.24em] text-muted">Transition {entry.index + 1}</span>
                <span className="font-weight-semibold text-primary">{entry.change}</span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2 text-scale-xs text-secondary">
                <div>
                  <span className="font-weight-semibold text-primary">Base</span>
                  <div>{entry.base ? entry.base.eventType : '—'}</div>
                  {entry.base && <div>{formatDateTime(entry.base.createdAt)}</div>}
                </div>
                <div>
                  <span className="font-weight-semibold text-primary">Compared</span>
                  <div>{entry.compare ? entry.compare.eventType : '—'}</div>
                  {entry.compare && <div>{formatDateTime(entry.compare.createdAt)}</div>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type AssetDiffSectionProps = {
  entries: WorkflowRunAssetDiffEntry[];
};

function AssetDiffSection({ entries }: AssetDiffSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className={DETAIL_PANEL_STEP_TITLE_CLASSES}>Asset snapshots</h4>
      {entries.length === 0 ? (
        <span className={DETAIL_PANEL_EMPTY_STATE_CLASSES}>No asset differences detected.</span>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={`${entry.assetId}:${entry.partitionKey ?? 'global'}`} className={DETAIL_PANEL_STEP_CARD_CLASSES}>
              <div className="flex items-center justify-between">
                <span className="font-weight-semibold text-primary">
                  {entry.assetId}
                  {entry.partitionKey ? ` · ${entry.partitionKey}` : ''}
                </span>
                <span className="uppercase tracking-[0.24em] text-muted">{entry.change}</span>
              </div>
              <div className="mt-2 grid gap-2 md:grid-cols-2 text-scale-xs text-secondary">
                <div>
                  <span className="font-weight-semibold text-primary">Base</span>
                  <pre className={`${JSON_PREVIEW_CONTENT_CLASSES} whitespace-pre-wrap`}>
                    {formatJson(entry.base?.payload ?? null)}
                  </pre>
                </div>
                <div>
                  <span className="font-weight-semibold text-primary">Compared</span>
                  <pre className={`${JSON_PREVIEW_CONTENT_CLASSES} whitespace-pre-wrap`}>
                    {formatJson(entry.compare?.payload ?? null)}
                  </pre>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '—';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

type WorkflowRunDetailPanelProps = {
  entry: WorkflowActivityRunEntry;
  detail: { run: WorkflowRun; steps: WorkflowRunStep[] } | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onViewWorkflow: () => void;
  onReplay: (entry: WorkflowActivityRunEntry, options?: { allowStaleAssets?: boolean }) => void;
  replayLoading: boolean;
  replayWarnings: WorkflowRunStaleAssetWarning[];
  onCompare: (entry: WorkflowActivityRunEntry) => void;
};

function WorkflowRunDetailPanel({
  entry,
  detail,
  loading,
  error,
  onClose,
  onViewWorkflow,
  onReplay,
  replayLoading,
  replayWarnings,
  onCompare
}: WorkflowRunDetailPanelProps) {
  const run = detail?.run ?? entry.run;
  const steps = detail?.steps ?? [];
  const duration = computeDurationMs(run.startedAt, run.completedAt, run.durationMs);

  return (
    <div className={DETAIL_PANEL_CONTAINER_CLASSES}>
      <div className="flex items-center justify-between gap-3">
        <div className={TABLE_STACK_TEXT_CLASSES}>
          <span className={DETAIL_PANEL_HEADER_LABEL_CLASSES}>Workflow run detail</span>
          <h3 className={DETAIL_PANEL_HEADER_TITLE_CLASSES}>{entry.workflow.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${STATUS_CHIP_BASE_CLASSES} px-4 ${statusChipClass(run.status)}`}>
            {run.status}
          </span>
          <button
            type="button"
            className={DETAIL_PANEL_ACTION_PRIMARY}
            onClick={() => onReplay(entry)}
            disabled={replayLoading}
          >
            {replayLoading ? <Spinner label="Replaying" size="xs" /> : 'Replay with prior inputs'}
          </button>
          <button type="button" className={DETAIL_PANEL_ACTION_SECONDARY} onClick={() => onCompare(entry)}>
            Compare runs
          </button>
          <button type="button" className={DETAIL_PANEL_ACTION_SECONDARY} onClick={onViewWorkflow}>
            View workflow
          </button>
          <button type="button" className={DETAIL_PANEL_ACTION_SECONDARY} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      {replayWarnings.length > 0 && (
        <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('warning')}`}>
          <div className="flex flex-col gap-2">
            <span className="font-weight-semibold">Stale assets detected for this replay:</span>
            <ul className="flex flex-col gap-1 text-scale-xs">
              {replayWarnings.map((warning) => (
                <li key={`${warning.assetId}:${warning.partitionKey ?? 'global'}`}>
                  <span className="font-weight-medium text-primary">{warning.assetId}</span>
                  {warning.partitionKey ? ` · Partition ${warning.partitionKey}` : ' · Unpartitioned'}
                  {` · Requested ${formatDateTime(warning.requestedAt)}`}
                  {warning.requestedBy ? ` · by ${warning.requestedBy}` : ''}
                  {warning.note ? ` · ${warning.note}` : ''}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={DETAIL_PANEL_ACTION_PRIMARY}
                onClick={() => onReplay(entry, { allowStaleAssets: true })}
              >
                Replay anyway
              </button>
              <button type="button" className={DETAIL_PANEL_ACTION_SECONDARY} onClick={() => onCompare(entry)}>
                Review diff
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <InfoRow label="Run key" value={run.runKey ?? '—'} copyValue={run.runKey ?? null} monospace />
        <InfoRow label="Run ID" value={run.id} copyValue={run.id} monospace />
        <InfoRow label="Workflow slug" value={entry.workflow.slug} />
        <InfoRow label="Triggered by" value={run.triggeredBy ?? '—'} />
        <InfoRow label="Partition" value={run.partitionKey ?? '—'} />
        <InfoRow label="Started" value={formatDateTime(run.startedAt)} />
        <InfoRow label="Completed" value={formatDateTime(run.completedAt)} />
        <InfoRow label="Duration" value={formatDuration(duration)} />
        <InfoRow label="Current step" value={run.currentStepId ?? '—'} />
      </div>

      {run.errorMessage && (
        <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('failed')}`}>
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
          <h4 className={DETAIL_PANEL_STEP_TITLE_CLASSES}>Step timeline</h4>
          {loading && (
            <span className={DETAIL_PANEL_STEP_META_CLASSES}>
              <Spinner label="Loading steps…" size="xs" />
            </span>
          )}
        </div>
        {error && (
          <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('warning')}`}>
            {error}
          </div>
        )}
        {!loading && steps.length === 0 && !error && (
          <div className={DETAIL_PANEL_EMPTY_STATE_CLASSES}>No steps recorded yet.</div>
        )}
        {steps.length > 0 && (
          <ul className="flex flex-col gap-2">
            {steps.map((step) => {
              const stepDuration = computeDurationMs(step.startedAt, step.completedAt, null);
              return (
                <li key={step.id} className={DETAIL_PANEL_STEP_CARD_CLASSES}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col">
                      <span className={DETAIL_PANEL_STEP_TITLE_CLASSES}>{step.stepId}</span>
                      {step.parentStepId && (
                        <span className={DETAIL_PANEL_STEP_META_CLASSES}>Parent: {step.parentStepId}</span>
                      )}
                    </div>
                    <span className={`${STATUS_CHIP_BASE_CLASSES} ${statusChipClass(step.status)}`}>
                      {formatFilterLabel(step.status ?? 'unknown')}
                    </span>
                  </div>
                  <div className={classNames('mt-2 grid gap-2 md:grid-cols-2', DETAIL_PANEL_BODY_TEXT_CLASSES)}>
                    <span>Started {formatDateTime(step.startedAt)}</span>
                    <span>Completed {formatDateTime(step.completedAt)}</span>
                    <span>Duration {formatDuration(stepDuration)}</span>
                  </div>
                  {step.errorMessage && (
                    <div
                      className={classNames(
                        'mt-2',
                        DETAIL_PANEL_ALERT_BASE_CLASSES,
                        getStatusToneClasses('failed')
                      )}
                    >
                      Error: {step.errorMessage}
                    </div>
                  )}
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
    <div className={DETAIL_PANEL_CONTAINER_CLASSES}>
      <div className="flex items-center justify-between gap-3">
        <div className={TABLE_STACK_TEXT_CLASSES}>
          <span className={DETAIL_PANEL_HEADER_LABEL_CLASSES}>Job run detail</span>
          <h3 className={DETAIL_PANEL_HEADER_TITLE_CLASSES}>{entry.job.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${STATUS_CHIP_BASE_CLASSES} px-4 ${statusChipClass(entry.run.status)}`}>
            {entry.run.status}
          </span>
          <button type="button" className={DETAIL_PANEL_ACTION_PRIMARY} onClick={onViewJob}>
            View jobs
          </button>
          <button type="button" className={DETAIL_PANEL_ACTION_SECONDARY} onClick={onClose}>
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
        <InfoRow label="Duration" value={formatDuration(duration)} />
        <InfoRow label="Attempt" value={`${entry.run.attempt} of ${entry.run.maxAttempts ?? '∞'}`} />
        <InfoRow label="Timeout" value={entry.run.timeoutMs ? `${Math.round(entry.run.timeoutMs / 1000)}s` : '—'} />
      </div>

      {entry.run.errorMessage && (
        <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('failed')}`}>
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
    <div className={INFO_ROW_CONTAINER_CLASSES}>
      <span className={INFO_ROW_LABEL_CLASSES}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className={classNames(INFO_ROW_VALUE_CLASSES, monospace ? INFO_ROW_MONO_VALUE_CLASSES : undefined)}>
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
    <div className={JSON_PREVIEW_CONTAINER_CLASSES}>
      <span className={JSON_PREVIEW_TITLE_CLASSES}>{title}</span>
      {content ? (
        <pre className={JSON_PREVIEW_CONTENT_CLASSES}>{content}</pre>
      ) : (
        <span className={JSON_PREVIEW_EMPTY_TEXT_CLASSES}>No data</span>
      )}
    </div>
  );
}

type WorkflowDeliveryDetailPanelProps = {
  entry: WorkflowActivityDeliveryEntry;
  onClose: () => void;
  onViewWorkflow: () => void;
};

function WorkflowDeliveryDetailPanel({ entry, onClose, onViewWorkflow }: WorkflowDeliveryDetailPanelProps) {
  const { delivery, workflow, trigger } = entry;
  const retryMetadata =
    delivery && typeof delivery === 'object' && 'retryMetadata' in delivery
      ? (delivery as { retryMetadata?: unknown }).retryMetadata ?? null
      : null;

  return (
    <div className={DETAIL_PANEL_CONTAINER_CLASSES}>
      <div className="flex items-center justify-between gap-3">
        <div className={TABLE_STACK_TEXT_CLASSES}>
          <span className={DETAIL_PANEL_HEADER_LABEL_CLASSES}>Delivery detail</span>
          <h3 className={DETAIL_PANEL_HEADER_TITLE_CLASSES}>{workflow.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`${STATUS_CHIP_BASE_CLASSES} px-4 ${statusChipClass(entry.status)}`}>
            {formatFilterLabel(entry.status)}
          </span>
          <button type="button" className={DETAIL_PANEL_ACTION_PRIMARY} onClick={onViewWorkflow}>
            View workflow
          </button>
          <button type="button" className={DETAIL_PANEL_ACTION_SECONDARY} onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoRow label="Delivery ID" value={delivery.id} copyValue={delivery.id} monospace />
        <InfoRow label="Workflow slug" value={workflow.slug} />
        <InfoRow label="Event ID" value={delivery.eventId ?? '—'} copyValue={delivery.eventId ?? null} monospace />
        <InfoRow label="Dedupe key" value={delivery.dedupeKey ?? '—'} copyValue={delivery.dedupeKey ?? null} monospace />
        <InfoRow label="Attempts" value={String(delivery.attempts)} />
        <InfoRow label="Linked run" value={delivery.workflowRunId ?? '—'} copyValue={delivery.workflowRunId ?? null} monospace />
        <InfoRow label="Next attempt" value={formatDateTime(delivery.nextAttemptAt)} />
        <InfoRow label="Throttled until" value={formatDateTime(delivery.throttledUntil)} />
        <InfoRow label="Created" value={formatDateTime(delivery.createdAt)} />
        <InfoRow label="Updated" value={formatDateTime(delivery.updatedAt)} />
      </div>

      {delivery.lastError && (
        <div className={`${DETAIL_PANEL_ALERT_BASE_CLASSES} ${getStatusToneClasses('failed')}`}>
          {delivery.lastError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <InfoRow label="Trigger" value={trigger ? trigger.name ?? trigger.id ?? '—' : '—'} />
        <InfoRow label="Trigger status" value={trigger?.status ?? '—'} />
        <InfoRow label="Event type" value={trigger?.eventType ?? '—'} />
        <InfoRow label="Event source" value={trigger?.eventSource ?? '—'} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <JsonPreview title="Retry metadata" value={retryMetadata} />
        <JsonPreview title="Trigger summary" value={trigger} />
      </div>
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
  const selectedRunId = selectedEntry?.run?.id ?? null;

  if (loading && !state.loaded) {
    return (
      <div className={LOADING_PANEL_CLASSES}>
        <Spinner label="Loading job runs…" />
      </div>
    );
  }

  if (error && items.length === 0) {
    return (
      <div className={ERROR_PANEL_CLASSES}>
        <span>{error}</span>
        <button
          type="button"
          className={PRIMARY_RETRY_BUTTON_CLASSES}
          onClick={onReload}
          disabled={loading}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className={TABLE_CARD_CLASSES}>
      <div className={TABLE_HEADER_BAR_CLASSES}>
        <span>Job runs</span>
        {loading && state.loaded && <span className={TABLE_META_TEXT_CLASSES}>Updating…</span>}
      </div>
      <div className="overflow-x-auto">
        <table className={TABLE_ELEMENT_CLASSES}>
          <thead className="bg-surface-muted">
            <tr>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Status
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Job
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Runtime
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Started
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Completed
              </th>
              <th scope="col" className={TABLE_HEAD_CELL_CLASSES}>
                Duration
              </th>
              <th scope="col" className={`${TABLE_HEAD_CELL_CLASSES} text-right`}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle">
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className={TABLE_EMPTY_TEXT_CLASSES}>
                  No job runs recorded yet.
                </td>
              </tr>
            ) : (
              items.map((entry) => {
                const durationMs = computeDurationMs(entry.run.startedAt, entry.run.completedAt, entry.run.durationMs);
                const isPending = pendingRunId === entry.run.id;
                const isSelected = selectedRunId === entry.run.id;
                return (
                  <Fragment key={entry.run.id}>
                    <tr
                      className={classNames(
                        TABLE_BODY_ROW_BASE_CLASSES,
                        isSelected ? TABLE_BODY_ROW_SELECTED_CLASSES : TABLE_BODY_ROW_DEFAULT_CLASSES
                      )}
                      onClick={() => onSelect(entry)}
                      aria-selected={isSelected}
                    >
                      <td className="px-4 py-3">
                        <span className={`${STATUS_CHIP_BASE_CLASSES} ${statusChipClass(entry.run.status)}`}>
                          {entry.run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-col text-scale-sm">
                          <span className="font-weight-semibold text-primary">
                            {entry.job.name}
                          </span>
                          <span className={TABLE_META_TEXT_CLASSES}>{entry.job.slug}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        {entry.job.runtime}
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        {formatDateTime(entry.run.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        {formatDateTime(entry.run.completedAt)}
                      </td>
                      <td className="px-4 py-3 text-scale-xs text-secondary">
                        {formatDuration(durationMs)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          className={PRIMARY_RETRY_BUTTON_CLASSES}
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
                      <tr className="bg-accent-soft/60">
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
        <div className={TABLE_ERROR_BAR_CLASSES}>{error}</div>
      )}
      {hasMore && (
        <div className={TABLE_LOAD_MORE_CONTAINER_CLASSES}>
          <button
            type="button"
            className={TERTIARY_BUTTON_CLASSES}
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
