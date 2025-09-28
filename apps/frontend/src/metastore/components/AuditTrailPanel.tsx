import { useEffect, useMemo, useRef, useState } from 'react';
import type { MetastoreRecordDetail } from '../types';
import type {
  MetastoreAuditAction,
  MetastoreAuditDiff,
  MetastoreAuditEntry,
  MetastoreAuditResponse
} from '../types';
import { fetchRecordAudits, fetchRecordAuditDiff, restoreRecordFromAudit } from '../api';
import { formatInstant, mapMetastoreError } from '../utils';
import { Spinner } from '../../components';
import JsonSyntaxHighlighter from '../../components/JsonSyntaxHighlighter';
import { Modal } from '../../components/Modal';

const AUDIT_PAGE_SIZE = 20;

const ACTION_LABELS: Record<MetastoreAuditAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  restore: 'Restore'
};

const ACTION_BADGE_CLASSES: Record<MetastoreAuditAction, string> = {
  create: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
  update: 'bg-blue-500/10 text-blue-600 dark:text-blue-300',
  delete: 'bg-rose-500/10 text-rose-600 dark:text-rose-300',
  restore: 'bg-amber-500/10 text-amber-600 dark:text-amber-300'
};

type ToastHelpers = {
  showSuccess: (title: string, description?: string) => void;
  showError: (title: string, error?: unknown) => void;
  showInfo: (title: string, description?: string) => void;
};

type AuthorizedFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type AuditTrailPanelProps = {
  record: MetastoreRecordDetail;
  authorizedFetch: AuthorizedFetch;
  hasWriteScope: boolean;
  onRecordRestored: (record: MetastoreRecordDetail) => void;
  onRefreshRecords: () => void;
} & ToastHelpers;

type PaginationState = MetastoreAuditResponse['pagination'];

type DiffState = {
  open: boolean;
  target: MetastoreAuditEntry | null;
  loading: boolean;
  error: string | null;
  data: MetastoreAuditDiff | null;
  showRestoreConfirm: boolean;
  restoreLoading: boolean;
  restoreError: string | null;
};

const INITIAL_DIFF_STATE: DiffState = {
  open: false,
  target: null,
  loading: false,
  error: null,
  data: null,
  showRestoreConfirm: false,
  restoreLoading: false,
  restoreError: null
};

function stringifyValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatVersionRange(entry: MetastoreAuditEntry): string {
  const before = entry.previousVersion ? `v${entry.previousVersion}` : '—';
  const after = entry.version ? `v${entry.version}` : '—';
  if (before === after) {
    return after;
  }
  return `${before} → ${after}`;
}

function joinClassNames(...values: Array<string | null | undefined | false>) {
  return values
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

export function AuditTrailPanel({
  record,
  authorizedFetch,
  hasWriteScope,
  onRecordRestored,
  onRefreshRecords,
  showSuccess,
  showError,
  showInfo
}: AuditTrailPanelProps) {
  const [audits, setAudits] = useState<MetastoreAuditEntry[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ total: 0, limit: AUDIT_PAGE_SIZE, offset: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [filters, setFilters] = useState<MetastoreAuditAction[]>([]);
  const [diffState, setDiffState] = useState<DiffState>(INITIAL_DIFF_STATE);
  const diffAbortRef = useRef<AbortController | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const totalPages = useMemo(() => {
    return pagination.total === 0 ? 1 : Math.max(Math.ceil(pagination.total / pagination.limit), 1);
  }, [pagination]);

  const filteredAudits = useMemo(() => {
    if (filters.length === 0) {
      return audits;
    }
    const active = new Set(filters);
    return audits.filter((entry) => active.has(entry.action));
  }, [audits, filters]);

  useEffect(() => {
    setPageIndex(0);
    setFilters([]);
    setAudits([]);
    setPagination({ total: 0, limit: AUDIT_PAGE_SIZE, offset: 0 });
    setError(null);
    setDiffState(INITIAL_DIFF_STATE);
  }, [record.namespace, record.recordKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchRecordAudits(authorizedFetch, record.namespace, record.recordKey, {
      limit: AUDIT_PAGE_SIZE,
      offset: pageIndex * AUDIT_PAGE_SIZE,
      signal: controller.signal
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setAudits(response.entries);
        setPagination(response.pagination);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        const message = err instanceof Error ? err.message : 'Failed to load audit entries';
        setError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [authorizedFetch, record.namespace, record.recordKey, pageIndex, refreshToken]);

  const requestDiff = async (entry: MetastoreAuditEntry) => {
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    setDiffState((previous) => ({
      ...INITIAL_DIFF_STATE,
      open: true,
      target: entry,
      loading: true
    }));

    try {
      const diff = await fetchRecordAuditDiff(
        authorizedFetch,
        record.namespace,
        record.recordKey,
        entry.id,
        { signal: controller.signal }
      );
      setDiffState((previous) => ({
        ...previous,
        loading: false,
        data: diff
      }));
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const message = err instanceof Error ? err.message : 'Failed to load audit diff';
      setDiffState((previous) => ({
        ...previous,
        loading: false,
        error: message
      }));
    } finally {
      diffAbortRef.current = null;
    }
  };

  const closeDiff = () => {
    diffAbortRef.current?.abort();
    diffAbortRef.current = null;
    setDiffState(INITIAL_DIFF_STATE);
  };

  const toggleFilter = (action: MetastoreAuditAction) => {
    setFilters((previous) => {
      if (previous.includes(action)) {
        return previous.filter((entry) => entry !== action);
      }
      return [...previous, action];
    });
  };

  const clearFilters = () => {
    setFilters([]);
  };

  const handleRestore = async () => {
    if (!diffState.target) {
      return;
    }
    if (!hasWriteScope) {
      showInfo('Missing scope', 'metastore:write scope is required to restore records.');
      return;
    }

    setDiffState((previous) => ({
      ...previous,
      restoreLoading: true,
      restoreError: null
    }));

    try {
      const payload = {
        auditId: diffState.target.id,
        expectedVersion: record.version
      } as const;
      const response = await restoreRecordFromAudit(
        authorizedFetch,
        record.namespace,
        record.recordKey,
        payload
      );
      showSuccess('Record restored', `Restored from audit #${response.restoredFrom.auditId}`);
      onRecordRestored(response.record);
      onRefreshRecords();
      setDiffState((previous) => ({
        ...previous,
        restoreLoading: false,
        showRestoreConfirm: false
      }));
      setRefreshToken((value) => value + 1);
      setPageIndex(0);
      closeDiff();
    } catch (err) {
      const message = mapMetastoreError(err);
      setDiffState((previous) => ({
        ...previous,
        restoreLoading: false,
        restoreError: message
      }));
      showError('Restore failed', err);
    }
  };

  const activeDiff = diffState.data;
  const correlationAvailable = Boolean(diffState.target?.correlationId);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500 dark:text-slate-400">
          Audit trail
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
          >
            Refresh
          </button>
          <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
            Page {Math.min(pageIndex + 1, totalPages)} of {totalPages}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>Filters:</span>
        <button
          type="button"
          onClick={clearFilters}
          className={joinClassNames(
            'rounded-full border border-slate-300/70 px-3 py-1 font-semibold transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300',
            filters.length === 0 ? 'bg-slate-200/60 dark:bg-slate-700/40' : undefined
          )}
        >
          All
        </button>
        {Object.entries(ACTION_LABELS).map(([value, label]) => {
          const active = filters.includes(value as MetastoreAuditAction);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggleFilter(value as MetastoreAuditAction)}
              className={joinClassNames(
                'rounded-full border border-slate-300/70 px-3 py-1 font-semibold transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300',
                active ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300 border-violet-400/70' : undefined
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          <Spinner size="xs" label="Loading audit history" />
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
          {error}
        </div>
      ) : pagination.total === 0 ? (
        <div className="rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-300">
          No audit entries recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Version</th>
                  <th className="px-3 py-2 font-semibold">Actor</th>
                  <th className="px-3 py-2 font-semibold">Correlation</th>
                  <th className="px-3 py-2 font-semibold">When</th>
                  <th className="px-3 py-2 font-semibold" aria-label="actions"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm text-slate-600 dark:divide-slate-700 dark:text-slate-300">
                {filteredAudits.map((entry) => (
                  <tr key={entry.id} className="hover:bg-slate-100/60 dark:hover:bg-slate-800/40">
                    <td className="px-3 py-2">
                      <span
                        className={joinClassNames(
                          'inline-flex rounded-full px-3 py-1 text-xs font-semibold',
                          ACTION_BADGE_CLASSES[entry.action]
                        )}
                      >
                        {ACTION_LABELS[entry.action]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{formatVersionRange(entry)}</td>
                    <td className="px-3 py-2">{entry.actor ?? 'system'}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      {entry.correlationId ?? '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatInstant(entry.createdAt)}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => requestDiff(entry)}
                        className="rounded-full border border-violet-500 px-3 py-1 text-xs font-semibold text-violet-600 transition-colors hover:bg-violet-500/10 dark:border-violet-400 dark:text-violet-300"
                      >
                        View diff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing {filteredAudits.length} entries • Page {Math.min(pageIndex + 1, totalPages)} of {totalPages} • Total {pagination.total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((value) => Math.max(value - 1, 0))}
                disabled={pageIndex === 0}
                className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  setPageIndex((value) => (value >= totalPages - 1 ? value : value + 1))
                }
                disabled={pageIndex >= totalPages - 1}
                className="rounded-full border border-slate-300/70 px-3 py-1 font-semibold transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={diffState.open}
        onClose={closeDiff}
        labelledBy="metastore-audit-diff-title"
        className="items-start"
        contentClassName="w-full max-w-4xl"
      >
        <div className="flex flex-col gap-4 p-6">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h3 id="metastore-audit-diff-title" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Audit diff
              </h3>
              {diffState.target ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {ACTION_LABELS[diffState.target.action]} • {formatVersionRange(diffState.target)} •{' '}
                  {formatInstant(diffState.target.createdAt)}
                </p>
              ) : null}
              {diffState.target?.actor ? (
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Actor: {diffState.target.actor}
                </p>
              ) : (
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">Actor: system</p>
              )}
              {correlationAvailable ? (
                <p className="text-xs font-mono uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                  Correlation: {diffState.target?.correlationId}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeDiff}
              className="rounded-full border border-slate-300/70 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 dark:border-slate-700/70 dark:text-slate-300"
            >
              Close
            </button>
          </header>

          {diffState.loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner label="Loading diff" />
            </div>
          ) : diffState.error ? (
            <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-600 dark:border-rose-500/60 dark:bg-rose-500/10 dark:text-rose-200">
              {diffState.error}
            </div>
          ) : activeDiff ? (
            <div className="space-y-4">
              <section className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300">
                <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Metadata changes
                </h4>
                {activeDiff.metadata.added.length === 0 &&
                activeDiff.metadata.removed.length === 0 &&
                activeDiff.metadata.changed.length === 0 ? (
                  <p className="mt-2 text-sm">No metadata differences.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {activeDiff.metadata.added.length > 0 ? (
                      <details className="rounded-xl border border-emerald-300/60 bg-emerald-50/60 p-3 dark:border-emerald-500/40 dark:bg-emerald-500/10">
                        <summary className="cursor-pointer text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                          Added paths ({activeDiff.metadata.added.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {activeDiff.metadata.added.map((item) => (
                            <li key={`added-${item.path}`} className="space-y-1">
                              <div className="font-mono text-xs text-emerald-700 dark:text-emerald-300">{item.path}</div>
                              <pre className="max-h-40 overflow-auto rounded-lg bg-white/70 p-2 font-mono text-xs text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                                {stringifyValue(item.value)}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {activeDiff.metadata.removed.length > 0 ? (
                      <details className="rounded-xl border border-rose-300/60 bg-rose-50/60 p-3 dark:border-rose-500/40 dark:bg-rose-500/10">
                        <summary className="cursor-pointer text-sm font-semibold text-rose-700 dark:text-rose-300">
                          Removed paths ({activeDiff.metadata.removed.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {activeDiff.metadata.removed.map((item) => (
                            <li key={`removed-${item.path}`} className="space-y-1">
                              <div className="font-mono text-xs text-rose-700 dark:text-rose-300">{item.path}</div>
                              <pre className="max-h-40 overflow-auto rounded-lg bg-white/70 p-2 font-mono text-xs text-slate-700 dark:bg-slate-900/70 dark:text-slate-200">
                                {stringifyValue(item.value)}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {activeDiff.metadata.changed.length > 0 ? (
                      <details className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-500/40 dark:bg-amber-500/10">
                        <summary className="cursor-pointer text-sm font-semibold text-amber-700 dark:text-amber-300">
                          Changed paths ({activeDiff.metadata.changed.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {activeDiff.metadata.changed.map((item) => (
                            <li key={`changed-${item.path}`} className="space-y-1">
                              <div className="font-mono text-xs text-amber-700 dark:text-amber-300">{item.path}</div>
                              <div className="grid gap-2 rounded-lg bg-white/80 p-2 text-xs dark:bg-slate-900/60">
                                <div>
                                  <span className="font-semibold text-rose-600 dark:text-rose-300">Before:</span>
                                  <pre className="max-h-32 overflow-auto rounded bg-rose-100/70 p-2 font-mono text-xs text-rose-700 dark:bg-rose-500/10 dark:text-rose-200">
                                    {stringifyValue(item.before)}
                                  </pre>
                                </div>
                                <div>
                                  <span className="font-semibold text-emerald-600 dark:text-emerald-300">After:</span>
                                  <pre className="max-h-32 overflow-auto rounded bg-emerald-100/70 p-2 font-mono text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
                                    {stringifyValue(item.after)}
                                  </pre>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </div>
                )}
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Tags
                  </h4>
                  {activeDiff.tags.added.length === 0 && activeDiff.tags.removed.length === 0 ? (
                    <p className="mt-2">No tag differences.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {activeDiff.tags.added.length > 0 ? (
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">
                            Added
                          </span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {activeDiff.tags.added.map((tag) => (
                              <span
                                key={`tag-added-${tag}`}
                                className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {activeDiff.tags.removed.length > 0 ? (
                        <div>
                          <span className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600 dark:text-rose-300">
                            Removed
                          </span>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {activeDiff.tags.removed.map((tag) => (
                              <span
                                key={`tag-removed-${tag}`}
                                className="rounded-full bg-rose-500/10 px-2 py-1 text-xs font-semibold text-rose-600 dark:text-rose-300"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                <div className="grid gap-3">
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Owner
                    </h4>
                    {activeDiff.owner.changed ? (
                      <div className="mt-2 space-y-2">
                        <div className="text-xs text-rose-600 dark:text-rose-300">{activeDiff.owner.before ?? '—'}</div>
                        <div className="text-xs text-emerald-600 dark:text-emerald-300">{activeDiff.owner.after ?? '—'}</div>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm">No owner change.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-4 text-sm text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-300">
                    <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      Schema hash
                    </h4>
                    {activeDiff.schemaHash.changed ? (
                      <div className="mt-2 space-y-2 font-mono text-xs">
                        <div className="text-rose-600 dark:text-rose-300">{activeDiff.schemaHash.before ?? '—'}</div>
                        <div className="text-emerald-600 dark:text-emerald-300">{activeDiff.schemaHash.after ?? '—'}</div>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm">No schema hash change.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <details className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-inner dark:border-slate-700/70 dark:bg-slate-900/80" open={false}>
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Snapshot after change
                  </summary>
                  <div className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-900/90 p-3">
                    <JsonSyntaxHighlighter value={activeDiff.snapshots.current.metadata ?? {}} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Tags: {activeDiff.snapshots.current.tags.join(', ') || '—'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Owner: {activeDiff.snapshots.current.owner ?? '—'}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Schema hash: {activeDiff.snapshots.current.schemaHash ?? '—'}
                  </div>
                </details>
                <details className="rounded-2xl border border-slate-200/70 bg-white/80 p-4 shadow-inner dark:border-slate-700/70 dark:bg-slate-900/80" open={false}>
                  <summary className="cursor-pointer text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                    Snapshot before change
                  </summary>
                  <div className="mt-3 max-h-72 overflow-auto rounded-xl bg-slate-900/90 p-3">
                    <JsonSyntaxHighlighter value={activeDiff.snapshots.previous.metadata ?? {}} />
                  </div>
                  <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                    Tags: {activeDiff.snapshots.previous.tags.join(', ') || '—'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Owner: {activeDiff.snapshots.previous.owner ?? '—'}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Schema hash: {activeDiff.snapshots.previous.schemaHash ?? '—'}
                  </div>
                </details>
              </section>
            </div>
          ) : (
            <div className="text-sm text-slate-600 dark:text-slate-300">Select an audit entry to view details.</div>
          )}

          {hasWriteScope && diffState.target ? (
            <div className="mt-2 space-y-3 rounded-2xl border border-violet-300/70 bg-violet-50/60 p-4 text-sm text-slate-700 dark:border-violet-500/60 dark:bg-violet-500/10 dark:text-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-[0.2em] text-violet-600 dark:text-violet-300">
                    Restore
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Replays metadata, tags, owner, and schema hash from this version with optimistic locking against v{record.version}.
                  </p>
                </div>
                {!diffState.showRestoreConfirm ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDiffState((previous) => ({ ...previous, showRestoreConfirm: true, restoreError: null }))
                    }
                    className="rounded-full bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-violet-500 disabled:opacity-40"
                  >
                    Restore this version
                  </button>
                ) : null}
              </div>

              {diffState.showRestoreConfirm ? (
                <div className="rounded-xl border border-violet-400/70 bg-white/80 p-3 text-xs text-slate-600 shadow-inner dark:border-violet-400/40 dark:bg-slate-900/70 dark:text-slate-200">
                  <p>
                    Confirm to overwrite the current record with the snapshot captured at{' '}
                    {formatInstant(diffState.target.createdAt)}. If a newer version exists, the restore will fail and you
                    can refresh to retry.
                  </p>
                  {diffState.restoreError ? (
                    <p className="mt-2 text-xs text-rose-600 dark:text-rose-300">{diffState.restoreError}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRestore}
                      disabled={diffState.restoreLoading}
                      className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {diffState.restoreLoading ? 'Restoring…' : 'Confirm restore'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setDiffState((previous) => ({
                          ...previous,
                          showRestoreConfirm: false,
                          restoreError: null
                        }))
                      }
                      disabled={diffState.restoreLoading}
                      className="rounded-full border border-slate-300/70 px-4 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700/70 dark:text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Modal>
    </section>
  );
}

export default AuditTrailPanel;
