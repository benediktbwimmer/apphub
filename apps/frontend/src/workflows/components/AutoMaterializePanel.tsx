import { useMemo, useState } from 'react';
import { Spinner } from '../../components';
import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';
import type {
  WorkflowAssetInventoryEntry,
  WorkflowAutoMaterializeOps,
  WorkflowRun
} from '../types';

type AutoMaterializePanelProps = {
  ops: WorkflowAutoMaterializeOps | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  assetInventory: WorkflowAssetInventoryEntry[];
};

type AutoTriggerInfo = {
  type: string | null;
  assetId: string | null;
  reason: string | null;
  partitionKey: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled'
};

const PANEL_CONTAINER =
  'rounded-3xl border border-subtle bg-surface-glass p-6 shadow-elevation-lg backdrop-blur-md transition-colors';

const PANEL_TITLE = 'text-scale-lg font-weight-semibold text-primary';

const PANEL_SUBTEXT = 'text-scale-xs text-secondary';

const PANEL_META_TEXT = 'text-scale-xs text-muted';

const REFRESH_BUTTON_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-subtle bg-surface-glass px-3 py-1 text-scale-xs font-weight-semibold text-secondary shadow-elevation-sm transition-colors hover:border-accent-soft hover:bg-accent-soft hover:text-accent-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

const ERROR_TEXT_CLASSES = 'mt-3 text-scale-sm font-weight-semibold text-status-danger';

const CARD_CONTAINER = 'rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-sm transition-colors';

const CARD_TITLE_CLASSES = 'text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

const CARD_LIST_CLASSES = 'mt-2 space-y-2 text-scale-sm text-secondary';

const CARD_LABEL_CLASSES = 'font-weight-semibold text-primary';

const CARD_EMPTY_STATE_CLASSES = 'mt-2 text-scale-sm text-secondary';

const FILTER_LABEL_CLASSES = 'text-scale-xs font-weight-semibold text-secondary';

const FILTER_SELECT_CLASSES =
  'ml-2 rounded-2xl border border-subtle bg-surface-glass px-3 py-1.5 text-scale-xs text-primary shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted';

const TABLE_WRAPPER_CLASSES = 'overflow-hidden rounded-2xl border border-subtle';

const TABLE_CLASSES = 'min-w-full divide-y divide-subtle text-scale-sm';

const TABLE_HEAD_CLASSES = 'bg-surface-muted';

const TABLE_HEAD_CELL_CLASSES =
  'px-4 py-3 text-left text-scale-xs font-weight-semibold uppercase tracking-[0.3em] text-muted';

const TABLE_BODY_CLASSES = 'divide-y divide-subtle';

const TABLE_ROW_CLASSES = 'bg-surface-glass transition-colors hover:bg-surface-glass-soft';

const TABLE_CELL_CLASSES = 'px-4 py-3 text-scale-sm text-secondary';

const EMPTY_ROW_TEXT_CLASSES = 'px-4 py-4 text-scale-sm text-secondary';

const ASSET_SECTION_TITLE = 'text-scale-sm font-weight-semibold text-primary';

const AUTO_ASSET_CARD = 'rounded-2xl border border-subtle bg-surface-glass p-4 shadow-elevation-sm transition-colors';

const AUTO_ASSET_META = 'text-scale-xs text-muted';

const AUTO_ASSET_STATS = 'mt-3 space-y-2 text-scale-xs text-secondary';

const POLICY_CHIP_CLASSES =
  'inline-flex items-center rounded-full border border-subtle bg-surface-muted px-2 py-[2px] text-[10px] font-weight-semibold uppercase tracking-[0.25em] text-secondary';

function extractAutoTrigger(run: WorkflowRun): AutoTriggerInfo {
  const raw = run.trigger;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { type: null, assetId: null, reason: null, partitionKey: null };
  }
  const record = raw as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : null;
  const assetId = typeof record.assetId === 'string' ? record.assetId : null;
  const reason = typeof record.reason === 'string' ? record.reason : null;
  const partitionKey = typeof record.partitionKey === 'string' ? record.partitionKey : null;
  return { type, assetId, reason, partitionKey };
}

function formatPolicyChips(asset: WorkflowAssetInventoryEntry): string[] {
  const chips = new Set<string>();
  for (const role of asset.producers) {
    const policy = role.autoMaterialize;
    if (!policy) {
      continue;
    }
    if (policy.enabled === false) {
      chips.add('Auto disabled');
    }
    if (policy.onUpstreamUpdate) {
      chips.add('On upstream update');
    }
    if (typeof policy.priority === 'number') {
      chips.add(`Priority ${policy.priority}`);
    }
  }
  return Array.from(chips);
}

export default function AutoMaterializePanel({
  ops,
  loading,
  error,
  onRefresh,
  assetInventory
}: AutoMaterializePanelProps) {
  const runs = useMemo(() => ops?.runs ?? [], [ops]);
  const runsWithTriggers = useMemo(
    () =>
      runs.map((run) => ({
        run,
        trigger: extractAutoTrigger(run)
      })),
    [runs]
  );

  const assetOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const entry of runsWithTriggers) {
      if (entry.trigger.type === 'auto-materialize' && entry.trigger.assetId) {
        unique.add(entry.trigger.assetId);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [runsWithTriggers]);

  const statusOptions = useMemo(() => {
    const unique = new Set<string>();
    for (const entry of runsWithTriggers) {
      unique.add(entry.run.status);
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [runsWithTriggers]);

  const [assetFilter, setAssetFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredRuns = useMemo(() => {
    return runsWithTriggers.filter(({ run, trigger }) => {
      if (statusFilter !== 'all' && run.status !== statusFilter) {
        return false;
      }
      if (assetFilter !== 'all') {
        return trigger.assetId === assetFilter;
      }
      return true;
    });
  }, [runsWithTriggers, assetFilter, statusFilter]);

  const autoAssets = useMemo(
    () =>
      assetInventory.filter((asset) =>
        asset.producers.some((role) => role.autoMaterialize)
      ),
    [assetInventory]
  );

  return (
    <section className={PANEL_CONTAINER}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={PANEL_TITLE}>
            Auto-Materialization Activity
          </h2>
          <p className={PANEL_SUBTEXT}>
            Inspect recent auto-runs, in-flight materializer claims, and cooldown timers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ops?.updatedAt && (
            <span className={PANEL_META_TEXT}>
              Updated {formatTimestamp(ops.updatedAt)}
            </span>
          )}
          <button
            type="button"
            className={REFRESH_BUTTON_CLASSES}
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className={ERROR_TEXT_CLASSES}>{error}</p>}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-scale-sm text-secondary">
          <Spinner label="Loading auto-materialization data…" size="xs" />
        </div>
      ) : null}

      {!loading && !error && !ops && (
        <p className="mt-6 text-scale-sm text-secondary">
          This workflow has not produced any auto-materialized runs yet.
        </p>
      )}

      {ops && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className={CARD_CONTAINER}>
              <h3 className={CARD_TITLE_CLASSES}>
                In-flight claim
              </h3>
              {ops.inFlight ? (
                <dl className={CARD_LIST_CLASSES}>
                  <div>
                    <dt className={CARD_LABEL_CLASSES}>Asset</dt>
                    <dd className="text-secondary">{ops.inFlight.assetId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className={CARD_LABEL_CLASSES}>Reason</dt>
                    <dd className="capitalize text-secondary">{ops.inFlight.reason}</dd>
                  </div>
                  <div>
                    <dt className={CARD_LABEL_CLASSES}>Partition</dt>
                    <dd className="text-secondary">{ops.inFlight.partitionKey ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className={CARD_LABEL_CLASSES}>Claimed</dt>
                    <dd className="text-secondary">{formatTimestamp(ops.inFlight.claimedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <p className={CARD_EMPTY_STATE_CLASSES}>No active claims.</p>
              )}
            </div>
            <div className={CARD_CONTAINER}>
              <h3 className={CARD_TITLE_CLASSES}>
                Cooldown
              </h3>
              {ops.cooldown ? (
                <dl className={CARD_LIST_CLASSES}>
                  <div>
                    <dt className={CARD_LABEL_CLASSES}>Recent failures</dt>
                    <dd className="text-secondary">{ops.cooldown.failures}</dd>
                  </div>
                  <div>
                    <dt className={CARD_LABEL_CLASSES}>Next eligible run</dt>
                    <dd className="text-secondary">
                      {ops.cooldown.nextEligibleAt ? formatTimestamp(ops.cooldown.nextEligibleAt) : 'Ready now'}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className={CARD_EMPTY_STATE_CLASSES}>No backoff in effect.</p>
              )}
            </div>
            <div className={CARD_CONTAINER}>
              <h3 className={CARD_TITLE_CLASSES}>
                Recent activity
              </h3>
              <dl className={CARD_LIST_CLASSES}>
                <div>
                  <dt className={CARD_LABEL_CLASSES}>Runs tracked</dt>
                  <dd className="text-secondary">{runs.length}</dd>
                </div>
                <div>
                  <dt className={CARD_LABEL_CLASSES}>Last run status</dt>
                  <dd className="flex items-center gap-2 text-secondary">
                    {runs[0] ? (
                      <StatusBadge status={runs[0].status} />
                    ) : (
                      <span>—</span>
                    )}
                    {runs[0] ? formatTimestamp(runs[0].createdAt) : null}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className={FILTER_LABEL_CLASSES}>
              Filter by asset
              <select
                className={FILTER_SELECT_CLASSES}
                value={assetFilter}
                onChange={(event) => setAssetFilter(event.target.value)}
                disabled={assetOptions.length === 0}
              >
                <option value="all">All</option>
                {assetOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            <label className={FILTER_LABEL_CLASSES}>
              Filter by status
              <select
                className={FILTER_SELECT_CLASSES}
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
              >
                <option value="all">All</option>
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status] ?? status}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={TABLE_WRAPPER_CLASSES}>
            <table className={TABLE_CLASSES}>
              <thead className={TABLE_HEAD_CLASSES}>
                <tr>
                  <th className={TABLE_HEAD_CELL_CLASSES}>
                    Run
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASSES}>
                    Status
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASSES}>
                    Asset
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASSES}>
                    Reason
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASSES}>
                    Started
                  </th>
                  <th className={TABLE_HEAD_CELL_CLASSES}>
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className={TABLE_BODY_CLASSES}>
                {filteredRuns.length === 0 ? (
                  <tr>
                    <td className={EMPTY_ROW_TEXT_CLASSES} colSpan={6}>
                      No runs match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredRuns.map(({ run, trigger }) => (
                    <tr key={run.id} className={TABLE_ROW_CLASSES}>
                      <td className={`${TABLE_CELL_CLASSES} font-weight-semibold text-primary`}>
                        {run.id}
                      </td>
                      <td className={TABLE_CELL_CLASSES}>
                        <StatusBadge status={run.status} />
                      </td>
                      <td className={TABLE_CELL_CLASSES}>
                        {trigger.assetId ?? '—'}
                      </td>
                      <td className={`${TABLE_CELL_CLASSES} capitalize`}>{trigger.reason ?? '—'}</td>
                      <td className={TABLE_CELL_CLASSES}>
                        {formatTimestamp(run.startedAt)}
                      </td>
                      <td className={TABLE_CELL_CLASSES}>
                        {formatDuration(run.durationMs)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className={ASSET_SECTION_TITLE}>Auto-managed assets</h3>
            {autoAssets.length === 0 ? (
              <p className="mt-2 text-scale-sm text-secondary">
                No assets declare auto-materialize policies for this workflow.
              </p>
            ) : (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {autoAssets.map((asset) => {
                  const latest = asset.latest;
                  const policyChips = formatPolicyChips(asset);
                  return (
                    <div
                      key={asset.assetId}
                      className={AUTO_ASSET_CARD}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-scale-sm font-weight-semibold text-primary">
                            {asset.assetId}
                          </h4>
                          <p className={AUTO_ASSET_META}>
                            {asset.producers.map((role) => role.stepName).join(', ') || 'Unknown producer'}
                          </p>
                        </div>
                        {policyChips.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {policyChips.map((chip) => (
                              <span
                                key={`${asset.assetId}-${chip}`}
                                className={POLICY_CHIP_CLASSES}
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <dl className={AUTO_ASSET_STATS}>
                        <div className="flex items-center justify-between gap-2">
                          <dt className={CARD_LABEL_CLASSES}>Latest materialization</dt>
                          <dd className="text-secondary">{latest ? formatTimestamp(latest.producedAt) : '—'}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className={CARD_LABEL_CLASSES}>Run status</dt>
                          <dd className="text-secondary">{latest ? <StatusBadge status={latest.runStatus} /> : '—'}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className={CARD_LABEL_CLASSES}>Partition</dt>
                          <dd className="text-secondary">{latest?.partitionKey ?? 'Global'}</dd>
                        </div>
                        {latest?.freshness && typeof latest.freshness.ttlMs === 'number' && latest.freshness.ttlMs > 0 && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className={CARD_LABEL_CLASSES}>TTL</dt>
                            <dd className="text-secondary">{formatDuration(latest.freshness.ttlMs)}</dd>
                          </div>
                        )}
                        {latest?.freshness && typeof latest.freshness.maxAgeMs === 'number' && latest.freshness.maxAgeMs > 0 && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className={CARD_LABEL_CLASSES}>Max age</dt>
                            <dd className="text-secondary">{formatDuration(latest.freshness.maxAgeMs)}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
