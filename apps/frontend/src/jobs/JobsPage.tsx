import { useEffect, useMemo, useState } from 'react';
import type { JobDefinitionSummary } from '../workflows/api';
import { Spinner } from '../components';
import { useJobsList } from './hooks/useJobsList';
import { useJobSnapshot } from './hooks/useJobSnapshot';
import { formatDate } from './utils';
import {
  JOB_CARD_CONTAINER_CLASSES,
  JOB_FORM_ERROR_TEXT_CLASSES,
  JOB_SECTION_PARAGRAPH_CLASSES,
  JOB_SECTION_TITLE_SMALL_CLASSES,
  JOB_STATUS_BADGE_BASE_CLASSES
} from './jobTokens';
import type { BundleEditorData, JobRunSummary } from './api';
import { getStatusToneClasses } from '../theme/statusTokens';
import { formatDuration } from '../workflows/formatters';
import { useModuleScope } from '../modules/ModuleScopeContext';
import { ModuleScopeGate } from '../modules/ModuleScopeGate';

const SIDEBAR_CONTAINER_CLASSES =
  'rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-md transition-colors';
const SIDEBAR_INPUT_CLASSES =
  'w-full rounded-lg border border-subtle bg-surface-glass px-3 py-2 text-scale-sm text-primary shadow-sm outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SIDEBAR_JOB_BUTTON_BASE =
  'w-full rounded-xl border border-transparent px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';
const SIDEBAR_JOB_BUTTON_ACTIVE = 'border-accent bg-accent text-on-accent shadow-elevation-md';
const SIDEBAR_JOB_BUTTON_INACTIVE =
  'hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong text-secondary';

const BADGE_NEUTRAL_CLASSES = 'border-subtle bg-surface-muted text-secondary';
const CAPABILITY_BADGE_CLASSES =
  'inline-flex items-center gap-1 rounded-full border border-subtle bg-surface-muted px-2 py-1 text-[11px] font-weight-semibold uppercase tracking-[0.2em] text-secondary';

const MAX_RECENT_RUNS = 5;

type ModuleJobsSidebarProps = {
  jobs: JobDefinitionSummary[];
  filteredJobs: JobDefinitionSummary[];
  selectedSlug: string | null;
  searchTerm: string;
  loading: boolean;
  error: string | null;
  onSearchTermChange: (value: string) => void;
  onSelectJob: (slug: string) => void;
  moduleName: string;
};

function ModuleJobsSidebar({
  jobs,
  filteredJobs,
  selectedSlug,
  searchTerm,
  loading,
  error,
  onSearchTermChange,
  onSelectJob,
  moduleName
}: ModuleJobsSidebarProps) {
  return (
    <aside className="lg:w-72">
      <div className={SIDEBAR_CONTAINER_CLASSES}>
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-scale-sm font-weight-semibold text-primary">Module jobs</h2>
            {loading && <Spinner label="Loading jobs…" size="xs" className="text-muted" />}
          </div>
          {error && <p className="text-scale-xs text-status-danger">{error}</p>}
          <input
            type="search"
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="Filter by name or slug"
            className={SIDEBAR_INPUT_CLASSES}
          />
          <div className="text-scale-xs text-muted">
            Showing {filteredJobs.length} of {jobs.length} jobs in {moduleName}
          </div>
        </div>
        <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto pr-2">
          {filteredJobs.map((job) => {
            const isActive = job.slug === selectedSlug;
            return (
              <li key={job.id}>
                <button
                  type="button"
                  onClick={() => onSelectJob(job.slug)}
                  className={`${SIDEBAR_JOB_BUTTON_BASE} ${isActive ? SIDEBAR_JOB_BUTTON_ACTIVE : SIDEBAR_JOB_BUTTON_INACTIVE}`}
                >
                  <div className="font-weight-semibold text-primary">{job.name}</div>
                  <div className="text-scale-xs text-muted">{job.slug}</div>
                </button>
              </li>
            );
          })}
          {filteredJobs.length === 0 && !loading && !error && (
            <li className="rounded-xl border border-dashed border-subtle bg-surface-muted px-3 py-6 text-center text-scale-xs text-muted">
              {jobs.length === 0 ? 'No module jobs registered yet.' : 'No jobs match your filter.'}
            </li>
          )}
        </ul>
      </div>
    </aside>
  );
}

type ModuleJobDetailProps = {
  job: JobDefinitionSummary;
  bundle: BundleEditorData | null;
  runs: JobRunSummary[];
  detailLoading: boolean;
  bundleLoading: boolean;
  detailError: string | null;
  bundleError: string | null;
};

function ModuleJobDetail({
  job,
  bundle,
  runs,
  detailLoading,
  bundleLoading,
  detailError,
  bundleError
}: ModuleJobDetailProps) {
  const moduleSlug = job.registryRef ?? '—';
  const capabilityFlags = bundle?.bundle.capabilityFlags ?? [];
  const bundleStatus = bundle?.bundle.status ?? null;
  const bundleVersion = bundle?.bundle.version ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className={JOB_CARD_CONTAINER_CLASSES}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-scale-lg font-weight-semibold text-primary">{job.name}</h2>
            <p className="text-scale-xs text-muted">{job.slug}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${JOB_STATUS_BADGE_BASE_CLASSES} ${BADGE_NEUTRAL_CLASSES}`}>Module runtime</span>
            {bundleStatus && (
              <span className={`${JOB_STATUS_BADGE_BASE_CLASSES} ${getStatusToneClasses(bundleStatus)}`}>
                {bundleStatus}
              </span>
            )}
            {bundleVersion && (
              <span className={`${JOB_STATUS_BADGE_BASE_CLASSES} ${BADGE_NEUTRAL_CLASSES}`}>
                v{bundleVersion}
              </span>
            )}
          </div>
          <dl className="grid gap-3 text-scale-sm text-primary sm:grid-cols-2">
            <div>
              <dt className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
                Module binding
              </dt>
              <dd>{moduleSlug}</dd>
            </div>
            <div>
              <dt className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
                Entry point
              </dt>
              <dd>{job.entryPoint || '—'}</dd>
            </div>
            <div>
              <dt className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
                Current version
              </dt>
              <dd>{bundleVersion ?? `rev ${job.version}`}</dd>
            </div>
            <div>
              <dt className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
                Updated
              </dt>
              <dd>{formatDate(job.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
                Created
              </dt>
              <dd>{formatDate(job.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-secondary">
                Timeout
              </dt>
              <dd>{formatTimeout(job.timeoutMs)}</dd>
            </div>
          </dl>
          {capabilityFlags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {capabilityFlags.map((flag) => (
                <span key={flag} className={CAPABILITY_BADGE_CLASSES}>
                  {flag}
                </span>
              ))}
            </div>
          )}
          {bundleLoading && (
            <div className="flex items-center gap-2 text-scale-xs text-muted">
              <Spinner size="xs" />
              <span>Refreshing bundle metadata…</span>
            </div>
          )}
          {bundleError && !bundleLoading && (
            <p className="text-scale-xs text-status-warning">{bundleError}</p>
          )}
        </div>
      </div>
      <ModuleJobRuns runs={runs} loading={detailLoading} error={detailError} />
    </div>
  );
}

type ModuleJobRunsProps = {
  runs: JobRunSummary[];
  loading: boolean;
  error: string | null;
};

function ModuleJobRuns({ runs, loading, error }: ModuleJobRunsProps) {
  const recentRuns = runs.slice(0, MAX_RECENT_RUNS);

  return (
    <div className={JOB_CARD_CONTAINER_CLASSES}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className={JOB_SECTION_TITLE_SMALL_CLASSES}>Recent runs</h3>
          {recentRuns.length > 0 && (
            <span className="text-scale-xs text-muted">
              Showing latest {recentRuns.length === MAX_RECENT_RUNS ? MAX_RECENT_RUNS : recentRuns.length} run
              {recentRuns.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-scale-xs text-muted">
            <Spinner size="xs" />
            <span>Loading run history…</span>
          </div>
        )}
        {!loading && error && <p className={JOB_FORM_ERROR_TEXT_CLASSES}>{error}</p>}
        {!loading && !error && recentRuns.length === 0 && (
          <p className={JOB_SECTION_PARAGRAPH_CLASSES}>No runs recorded for this job yet.</p>
        )}
        {!loading && !error && recentRuns.length > 0 && (
          <ul className="flex flex-col gap-3">
            {recentRuns.map((run) => (
              <li
                key={run.id}
                className="rounded-xl border border-subtle bg-surface-muted px-3 py-2 text-scale-sm text-primary"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={`${JOB_STATUS_BADGE_BASE_CLASSES} ${getStatusToneClasses(run.status)}`}>
                    {run.status ?? 'Unknown'}
                  </span>
                  <span className="text-scale-xs text-muted">{formatDate(run.startedAt ?? run.createdAt)}</span>
                </div>
                <dl className="mt-3 grid gap-2 text-scale-xs text-secondary sm:grid-cols-2">
                  <div>
                    <dt className="uppercase tracking-[0.2em]">Duration</dt>
                    <dd className="text-scale-sm text-primary">{formatDuration(run.durationMs ?? null)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.2em]">Attempts</dt>
                    <dd className="text-scale-sm text-primary">
                      {run.attempt}{run.maxAttempts ? ` of ${run.maxAttempts}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-[0.2em]">Completed</dt>
                    <dd className="text-scale-sm text-primary">{formatDate(run.completedAt)}</dd>
                  </div>
                  {run.logsUrl && (
                    <div>
                      <dt className="uppercase tracking-[0.2em]">Logs</dt>
                      <dd>
                        <a
                          href={run.logsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-scale-xs font-weight-semibold text-accent underline decoration-accent-soft decoration-2"
                        >
                          Open logs
                        </a>
                      </dd>
                    </div>
                  )}
                  {run.errorMessage && (
                    <div className="sm:col-span-2">
                      <dt className="uppercase tracking-[0.2em]">Error</dt>
                      <dd className="text-scale-sm text-status-danger">{run.errorMessage}</dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function formatTimeout(timeoutMs: number | null | undefined): string {
  if (timeoutMs === null || timeoutMs === undefined) {
    return '—';
  }
  if (timeoutMs < 1000) {
    return `${timeoutMs} ms`;
  }
  const seconds = timeoutMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)} s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export default function JobsPage() {
  const {
    sortedJobs,
    loading: jobsLoading,
    error: jobsError
  } = useJobsList();
  const moduleScope = useModuleScope();
  const isModuleScoped = moduleScope.kind === 'module';

  const moduleJobIdSet = useMemo(() => {
    if (!isModuleScoped || !moduleScope.resources) {
      return null;
    }
    return new Set(
      moduleScope.resources
        .filter((context) => context.resourceType === 'job-definition')
        .map((context) => context.resourceId)
    );
  }, [isModuleScoped, moduleScope.resources]);

  const moduleJobs = useMemo(
    () =>
      sortedJobs.filter((job) => {
        if (job.runtime !== 'module') {
          return false;
        }
        if (!isModuleScoped) {
          return true;
        }
        return moduleJobIdSet ? moduleJobIdSet.has(job.id) : false;
      }),
    [moduleJobIdSet, isModuleScoped, sortedJobs]
  );

  const [searchTerm, setSearchTerm] = useState('');
  const filteredJobs = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase();
    if (!trimmed) {
      return moduleJobs;
    }
    return moduleJobs.filter((job) => {
      return (
        job.name.toLowerCase().includes(trimmed) ||
        job.slug.toLowerCase().includes(trimmed)
      );
    });
  }, [searchTerm, moduleJobs]);

  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (filteredJobs.length === 0) {
      setSelectedSlug(null);
      return;
    }
    setSelectedSlug((current) => {
      if (current && filteredJobs.some((job) => job.slug === current)) {
        return current;
      }
      return filteredJobs[0]?.slug ?? null;
    });
  }, [filteredJobs]);

  const selectedJob = useMemo(
    () => filteredJobs.find((job) => job.slug === selectedSlug) ?? null,
    [filteredJobs, selectedSlug]
  );

  const jobSnapshot = useJobSnapshot(selectedSlug);
  const moduleInfo = moduleScope.modules.find((module) => module.id === moduleScope.moduleId) ?? null;
  const moduleTitle = isModuleScoped
    ? moduleInfo?.displayName ?? moduleScope.moduleId ?? 'Module'
    : 'All modules';

  const shouldShowModuleGate =
    isModuleScoped && (moduleScope.loadingResources || Boolean(moduleScope.resourcesError));

  if (shouldShowModuleGate) {
    return <ModuleScopeGate resourceName="jobs" />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-scale-xl font-weight-semibold text-primary">{moduleTitle} jobs</h1>
        <p className="text-scale-sm text-secondary">
          {isModuleScoped
            ? 'Inspect module jobs, review their bindings, and check recent activity.'
            : 'Inspect module jobs across all modules, review their bindings, and check recent activity.'}
        </p>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <ModuleJobsSidebar
          jobs={moduleJobs}
          filteredJobs={filteredJobs}
          selectedSlug={selectedSlug}
          searchTerm={searchTerm}
          loading={jobsLoading}
          error={jobsError}
          onSearchTermChange={setSearchTerm}
          onSelectJob={setSelectedSlug}
          moduleName={moduleTitle}
        />
        <section className="flex-1">
          {moduleJobs.length === 0 && !jobsLoading ? (
            <div className={JOB_CARD_CONTAINER_CLASSES}>
              <p className={JOB_SECTION_PARAGRAPH_CLASSES}>
                Module jobs will appear here once they are registered in the control plane.
              </p>
            </div>
          ) : !selectedJob ? (
            <div className={JOB_CARD_CONTAINER_CLASSES}>
              <p className={JOB_SECTION_PARAGRAPH_CLASSES}>
                Adjust your filters or select a job from the list to view its configuration.
              </p>
            </div>
          ) : (
            <ModuleJobDetail
              job={jobSnapshot.detail?.job ?? selectedJob}
              bundle={jobSnapshot.bundle}
              runs={jobSnapshot.detail?.runs ?? []}
              detailLoading={jobSnapshot.detailLoading}
              bundleLoading={jobSnapshot.bundleLoading}
              detailError={jobSnapshot.detailError}
              bundleError={jobSnapshot.bundleError}
            />
          )}
        </section>
      </div>
    </div>
  );
}
