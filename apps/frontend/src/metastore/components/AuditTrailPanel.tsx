import classNames from 'classnames';
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
import {
  METASTORE_ALERT_ERROR_CLASSES,
  METASTORE_ALERT_WARNING_CLASSES,
  METASTORE_CARD_CONTAINER_CLASSES,
  METASTORE_DIALOG_CONTENT_CLASSES,
  METASTORE_DIALOG_SUBTITLE_CLASSES,
  METASTORE_DIALOG_TITLE_CLASSES,
  METASTORE_ERROR_TEXT_CLASSES,
  METASTORE_META_TEXT_CLASSES,
  METASTORE_PRIMARY_BUTTON_SMALL_CLASSES,
  METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
  METASTORE_STATUS_TONE_CLASSES,
  METASTORE_SUMMARY_CARD_CLASSES,
  METASTORE_SUMMARY_LABEL_CLASSES,
  METASTORE_TABLE_CONTAINER_CLASSES,
  METASTORE_TABLE_REFRESH_BUTTON_CLASSES,
  METASTORE_TAG_BADGE_CLASSES
} from '../metastoreTokens';

const AUDIT_PAGE_SIZE = 20;

const ACTION_LABELS: Record<MetastoreAuditAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  restore: 'Restore'
};

const ACTION_TONES: Record<MetastoreAuditAction, 'success' | 'info' | 'warn' | 'error'> = {
  create: 'success',
  update: 'info',
  delete: 'error',
  restore: 'warn'
};

type ToastHelpers = {
  showSuccess: (title: string, description?: string) => void;
  showError: (title: string, error?: unknown) => void;
  showInfo: (title: string, description?: string) => void;
};

type AuditTrailPanelProps = {
  record: MetastoreRecordDetail;
  token: string | null;
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

export function AuditTrailPanel({
  record,
  token,
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

    fetchRecordAudits(token, record.namespace, record.recordKey, {
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
  }, [token, record.namespace, record.recordKey, pageIndex, refreshToken]);

  const requestDiff = async (entry: MetastoreAuditEntry) => {
    diffAbortRef.current?.abort();
    const controller = new AbortController();
    diffAbortRef.current = controller;
    setDiffState({
      ...INITIAL_DIFF_STATE,
      open: true,
      target: entry,
      loading: true
    });

    try {
      const diff = await fetchRecordAuditDiff(token, record.namespace, record.recordKey, entry.id, {
        signal: controller.signal
      });
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
      const response = await restoreRecordFromAudit(token, record.namespace, record.recordKey, payload);
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
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className={METASTORE_SUMMARY_LABEL_CLASSES}>Audit trail</h4>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setRefreshToken((value) => value + 1)}
            className={METASTORE_TABLE_REFRESH_BUTTON_CLASSES}
          >
            Refresh
          </button>
          <div
            className={classNames(
              'flex items-center gap-2 uppercase tracking-[0.2em]',
              METASTORE_META_TEXT_CLASSES
            )}
          >
            Page {Math.min(pageIndex + 1, totalPages)} of {totalPages}
          </div>
        </div>
      </div>

      <div className={classNames('flex flex-wrap items-center gap-2', METASTORE_META_TEXT_CLASSES)}>
        <span>Filters:</span>
        <button
          type="button"
          onClick={clearFilters}
          className={classNames(
            METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
            filters.length === 0 ? 'border-accent bg-accent-soft text-accent-strong' : undefined
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
              className={classNames(
                METASTORE_SECONDARY_BUTTON_SMALL_CLASSES,
                active ? 'border-accent bg-accent-soft text-accent-strong' : undefined
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div
          className={classNames(
            METASTORE_CARD_CONTAINER_CLASSES,
            'flex items-center gap-2 text-scale-sm text-secondary'
          )}
        >
          <Spinner size="xs" label="Loading audit history" />
        </div>
      ) : error ? (
        <div className={METASTORE_ALERT_ERROR_CLASSES}>{error}</div>
      ) : pagination.total === 0 ? (
        <div className={METASTORE_ALERT_WARNING_CLASSES}>No audit entries recorded yet.</div>
      ) : (
        <div className="space-y-3">
          <div className={classNames(METASTORE_TABLE_CONTAINER_CLASSES, 'overflow-hidden')}>
            <table className="min-w-full border-separate border-spacing-0 text-left">
              <thead className="bg-surface-muted">
                <tr
                  className={classNames(
                    'uppercase tracking-[0.2em]',
                    METASTORE_META_TEXT_CLASSES
                  )}
                >
                  <th className="px-4 py-3 text-left font-weight-semibold">Action</th>
                  <th className="px-4 py-3 text-left font-weight-semibold">Version</th>
                  <th className="px-4 py-3 text-left font-weight-semibold">Actor</th>
                  <th className="px-4 py-3 text-left font-weight-semibold">Correlation</th>
                  <th className="px-4 py-3 text-left font-weight-semibold">When</th>
                  <th className="px-4 py-3 text-left font-weight-semibold" aria-label="actions" />
                </tr>
              </thead>
              <tbody>
                {filteredAudits.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-subtle transition-colors last:border-b-0 hover:bg-accent-soft/40"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={classNames(
                          'inline-flex items-center rounded-full border px-3 py-1 text-scale-xs font-weight-semibold uppercase tracking-[0.25em]',
                          METASTORE_STATUS_TONE_CLASSES[ACTION_TONES[entry.action]]
                        )}
                      >
                        {ACTION_LABELS[entry.action]}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-scale-xs text-primary">
                      {formatVersionRange(entry)}
                    </td>
                    <td className="px-4 py-3 text-scale-sm text-primary">{entry.actor ?? 'system'}</td>
                    <td className="px-4 py-3 font-mono text-scale-xs text-muted">
                      {entry.correlationId ?? '—'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-scale-sm text-secondary">
                      {formatInstant(entry.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => requestDiff(entry)}
                        className={METASTORE_PRIMARY_BUTTON_SMALL_CLASSES}
                      >
                        View diff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className={classNames(
              'flex flex-wrap items-center justify-between gap-2',
              METASTORE_META_TEXT_CLASSES
            )}
          >
            <span>
              Showing {filteredAudits.length} entries • Page {Math.min(pageIndex + 1, totalPages)} of{' '}
              {totalPages} • Total {pagination.total}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPageIndex((value) => Math.max(value - 1, 0))}
                disabled={pageIndex === 0}
                className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  setPageIndex((value) => (value >= totalPages - 1 ? value : value + 1))
                }
                disabled={pageIndex >= totalPages - 1}
                className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
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
        contentClassName={METASTORE_DIALOG_CONTENT_CLASSES}
      >
        <div className="flex flex-col gap-5">
          <header className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h3 id="metastore-audit-diff-title" className={METASTORE_DIALOG_TITLE_CLASSES}>
                Audit diff
              </h3>
              {diffState.target ? (
                <p className={METASTORE_DIALOG_SUBTITLE_CLASSES}>
                  {ACTION_LABELS[diffState.target.action]} • {formatVersionRange(diffState.target)} •{' '}
                  {formatInstant(diffState.target.createdAt)}
                </p>
              ) : null}
              <p
                className={classNames(
                  'text-scale-xs uppercase tracking-[0.2em]',
                  METASTORE_META_TEXT_CLASSES
                )}
              >
                Actor: {diffState.target?.actor ?? 'system'}
              </p>
              {correlationAvailable ? (
                <p
                  className={classNames(
                    'font-mono text-scale-xs uppercase tracking-[0.2em]',
                    METASTORE_META_TEXT_CLASSES
                  )}
                >
                  Correlation: {diffState.target?.correlationId}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={closeDiff}
              className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
            >
              Close
            </button>
          </header>

          {diffState.loading ? (
            <div className="flex items-center justify-center py-10 text-secondary">
              <Spinner label="Loading diff" />
            </div>
          ) : diffState.error ? (
            <div className={METASTORE_ALERT_ERROR_CLASSES}>{diffState.error}</div>
          ) : activeDiff ? (
            <div className="space-y-4 text-scale-sm text-secondary">
              <section className={classNames(METASTORE_SUMMARY_CARD_CLASSES, 'space-y-3 p-4')}>
                <h4 className={METASTORE_SUMMARY_LABEL_CLASSES}>Metadata changes</h4>
                {activeDiff.metadata.added.length === 0 &&
                activeDiff.metadata.removed.length === 0 &&
                activeDiff.metadata.changed.length === 0 ? (
                  <p>No metadata differences.</p>
                ) : (
                  <div className="space-y-3">
                    {activeDiff.metadata.added.length > 0 ? (
                      <details className="rounded-2xl border border-status-success bg-status-success-soft p-3 text-secondary">
                        <summary className="cursor-pointer text-scale-sm font-weight-semibold text-status-success">
                          Added paths ({activeDiff.metadata.added.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {activeDiff.metadata.added.map((item) => (
                            <li key={`added-${item.path}`} className="space-y-1">
                              <div className="font-mono text-scale-xs text-status-success">{item.path}</div>
                              <pre className="max-h-40 overflow-auto rounded-xl border border-subtle bg-surface-sunken p-3 font-mono text-scale-xs text-primary">
                                {stringifyValue(item.value)}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {activeDiff.metadata.removed.length > 0 ? (
                      <details className="rounded-2xl border border-status-danger bg-status-danger-soft p-3 text-secondary">
                        <summary className="cursor-pointer text-scale-sm font-weight-semibold text-status-danger">
                          Removed paths ({activeDiff.metadata.removed.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {activeDiff.metadata.removed.map((item) => (
                            <li key={`removed-${item.path}`} className="space-y-1">
                              <div className="font-mono text-scale-xs text-status-danger">{item.path}</div>
                              <pre className="max-h-40 overflow-auto rounded-xl border border-subtle bg-surface-sunken p-3 font-mono text-scale-xs text-primary">
                                {stringifyValue(item.value)}
                              </pre>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {activeDiff.metadata.changed.length > 0 ? (
                      <details className="rounded-2xl border border-status-warning bg-status-warning-soft p-3 text-secondary">
                        <summary className="cursor-pointer text-scale-sm font-weight-semibold text-status-warning">
                          Changed paths ({activeDiff.metadata.changed.length})
                        </summary>
                        <ul className="mt-2 space-y-2">
                          {activeDiff.metadata.changed.map((item) => (
                            <li key={`changed-${item.path}`} className="space-y-2">
                              <div className="font-mono text-scale-xs text-status-warning">{item.path}</div>
                              <div className="grid gap-3 rounded-2xl border border-subtle bg-surface-glass p-3 text-scale-xs text-secondary">
                                <div className="space-y-2">
                                  <span className="font-weight-semibold text-status-danger">Before</span>
                                  <pre className="max-h-32 overflow-auto rounded border border-subtle bg-surface-sunken p-3 font-mono text-scale-xs text-status-danger">
                                    {stringifyValue(item.before)}
                                  </pre>
                                </div>
                                <div className="space-y-2">
                                  <span className="font-weight-semibold text-status-success">After</span>
                                  <pre className="max-h-32 overflow-auto rounded border border-subtle bg-surface-sunken p-3 font-mono text-scale-xs text-status-success">
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
                <div className={classNames(METASTORE_SUMMARY_CARD_CLASSES, 'space-y-2 p-4')}>
                  <h4 className={METASTORE_SUMMARY_LABEL_CLASSES}>Tags</h4>
                  {activeDiff.tags.added.length === 0 && activeDiff.tags.removed.length === 0 ? (
                    <p>No tag differences.</p>
                  ) : (
                    <div className="space-y-3">
                      {activeDiff.tags.added.length > 0 ? (
                        <div className="space-y-1">
                          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-status-success">
                            Added
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {activeDiff.tags.added.map((tag) => (
                              <span
                                key={`tag-added-${tag}`}
                                className={classNames(
                                  METASTORE_TAG_BADGE_CLASSES,
                                  'border-status-success bg-status-success-soft text-status-success'
                                )}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      {activeDiff.tags.removed.length > 0 ? (
                        <div className="space-y-1">
                          <span className="text-scale-xs font-weight-semibold uppercase tracking-[0.2em] text-status-danger">
                            Removed
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {activeDiff.tags.removed.map((tag) => (
                              <span
                                key={`tag-removed-${tag}`}
                                className={classNames(
                                  METASTORE_TAG_BADGE_CLASSES,
                                  'border-status-danger bg-status-danger-soft text-status-danger'
                                )}
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
                  <div className={classNames(METASTORE_SUMMARY_CARD_CLASSES, 'space-y-2 p-4')}>
                    <h4 className={METASTORE_SUMMARY_LABEL_CLASSES}>Owner</h4>
                    {activeDiff.owner.changed ? (
                      <div className="space-y-2 text-scale-xs font-mono">
                        <div className="text-status-danger">{activeDiff.owner.before ?? '—'}</div>
                        <div className="text-status-success">{activeDiff.owner.after ?? '—'}</div>
                      </div>
                    ) : (
                      <p>No owner change.</p>
                    )}
                  </div>
                  <div className={classNames(METASTORE_SUMMARY_CARD_CLASSES, 'space-y-2 p-4')}>
                    <h4 className={METASTORE_SUMMARY_LABEL_CLASSES}>Schema hash</h4>
                    {activeDiff.schemaHash.changed ? (
                      <div className="space-y-2 font-mono text-scale-xs">
                        <div className="text-status-danger">{activeDiff.schemaHash.before ?? '—'}</div>
                        <div className="text-status-success">{activeDiff.schemaHash.after ?? '—'}</div>
                      </div>
                    ) : (
                      <p>No schema hash change.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="grid gap-3 md:grid-cols-2">
                <details className="rounded-2xl border border-subtle bg-surface-glass p-4 text-secondary">
                  <summary className={classNames('cursor-pointer', METASTORE_SUMMARY_LABEL_CLASSES)}>
                    Snapshot after change
                  </summary>
                  <div className="mt-3 max-h-72 overflow-auto rounded-2xl border border-subtle bg-surface-sunken p-3">
                    <JsonSyntaxHighlighter value={activeDiff.snapshots.current.metadata ?? {}} />
                  </div>
                  <div className="mt-3 space-y-1 text-scale-xs text-muted">
                    <div>Tags: {activeDiff.snapshots.current.tags.join(', ') || '—'}</div>
                    <div>Owner: {activeDiff.snapshots.current.owner ?? '—'}</div>
                    <div>Schema hash: {activeDiff.snapshots.current.schemaHash ?? '—'}</div>
                  </div>
                </details>
                <details className="rounded-2xl border border-subtle bg-surface-glass p-4 text-secondary">
                  <summary className={classNames('cursor-pointer', METASTORE_SUMMARY_LABEL_CLASSES)}>
                    Snapshot before change
                  </summary>
                  <div className="mt-3 max-h-72 overflow-auto rounded-2xl border border-subtle bg-surface-sunken p-3">
                    <JsonSyntaxHighlighter value={activeDiff.snapshots.previous.metadata ?? {}} />
                  </div>
                  <div className="mt-3 space-y-1 text-scale-xs text-muted">
                    <div>Tags: {activeDiff.snapshots.previous.tags.join(', ') || '—'}</div>
                    <div>Owner: {activeDiff.snapshots.previous.owner ?? '—'}</div>
                    <div>Schema hash: {activeDiff.snapshots.previous.schemaHash ?? '—'}</div>
                  </div>
                </details>
              </section>
            </div>
          ) : (
            <div className="text-scale-sm text-secondary">Select an audit entry to view details.</div>
          )}

          {hasWriteScope && diffState.target ? (
            <div className="space-y-3 rounded-2xl border border-status-warning bg-status-warning-soft px-4 py-4 text-scale-sm text-secondary">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <h4 className={METASTORE_SUMMARY_LABEL_CLASSES}>Restore</h4>
                  <p className="text-scale-xs text-secondary">
                    Replays metadata, tags, owner, and schema hash from this version with optimistic locking against v{record.version}.
                  </p>
                </div>
                {!diffState.showRestoreConfirm ? (
                  <button
                    type="button"
                    onClick={() =>
                      setDiffState((previous) => ({ ...previous, showRestoreConfirm: true, restoreError: null }))
                    }
                    className={METASTORE_PRIMARY_BUTTON_SMALL_CLASSES}
                  >
                    Restore this version
                  </button>
                ) : null}
              </div>

              {diffState.showRestoreConfirm ? (
                <div className="rounded-2xl border border-subtle bg-surface-glass p-4 text-scale-sm text-secondary">
                  <p>
                    Confirm to overwrite the current record with the snapshot captured at{' '}
                    {formatInstant(diffState.target.createdAt)}. If a newer version exists, the restore will fail and you
                    can refresh to retry.
                  </p>
                  {diffState.restoreError ? (
                    <p className={classNames(METASTORE_ERROR_TEXT_CLASSES, 'mt-2')}>
                      {diffState.restoreError}
                    </p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRestore}
                      disabled={diffState.restoreLoading}
                      className={METASTORE_PRIMARY_BUTTON_SMALL_CLASSES}
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
                      className={METASTORE_SECONDARY_BUTTON_SMALL_CLASSES}
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
