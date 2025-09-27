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
  const runs = ops?.runs ?? [];
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
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
            Auto-Materialization Activity
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Inspect recent auto-runs, in-flight materializer claims, and cooldown timers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ops?.updatedAt && (
            <span className="text-xs text-slate-400 dark:text-slate-500">
              Updated {formatTimestamp(ops.updatedAt)}
            </span>
          )}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
            onClick={onRefresh}
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Spinner label="Loading auto-materialization data…" size="xs" />
        </div>
      ) : null}

      {!loading && !error && !ops && (
        <p className="mt-6 text-sm text-slate-600 dark:text-slate-300">
          This workflow has not produced any auto-materialized runs yet.
        </p>
      )}

      {ops && (
        <div className="mt-6 space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                In-flight claim
              </h3>
              {ops.inFlight ? (
                <dl className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-200">Asset</dt>
                    <dd>{ops.inFlight.assetId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-200">Reason</dt>
                    <dd className="capitalize">{ops.inFlight.reason}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-200">Partition</dt>
                    <dd>{ops.inFlight.partitionKey ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-200">Claimed</dt>
                    <dd>{formatTimestamp(ops.inFlight.claimedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No active claims.</p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Cooldown
              </h3>
              {ops.cooldown ? (
                <dl className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-200">Recent failures</dt>
                    <dd>{ops.cooldown.failures}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-200">Next eligible run</dt>
                    <dd>{ops.cooldown.nextEligibleAt ? formatTimestamp(ops.cooldown.nextEligibleAt) : 'Ready now'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">No backoff in effect.</p>
              )}
            </div>
            <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-4 dark:border-slate-700/60 dark:bg-slate-900/60">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Recent activity
              </h3>
              <dl className="mt-2 space-y-2 text-sm text-slate-600 dark:text-slate-300">
                <div>
                  <dt className="font-medium text-slate-700 dark:text-slate-200">Runs tracked</dt>
                  <dd>{runs.length}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-700 dark:text-slate-200">Last run status</dt>
                  <dd className="flex items-center gap-2">
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
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Filter by asset
              <select
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
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
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Filter by status
              <select
                className="ml-2 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
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

          <div className="overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50/80 dark:bg-slate-800/80">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Run
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Asset
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Started
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {filteredRuns.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-sm text-slate-600 dark:text-slate-300" colSpan={6}>
                      No runs match the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredRuns.map(({ run, trigger }) => (
                    <tr key={run.id} className="bg-white/70 dark:bg-slate-900/50">
                      <td className="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100">
                        {run.id}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                        {trigger.assetId ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm capitalize text-slate-600 dark:text-slate-300">
                        {trigger.reason ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                        {formatTimestamp(run.startedAt)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                        {formatDuration(run.durationMs)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-100">Auto-managed assets</h3>
            {autoAssets.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
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
                      className="rounded-2xl border border-slate-200/60 bg-white/70 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-900/60"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                            {asset.assetId}
                          </h4>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {asset.producers.map((role) => role.stepName).join(', ') || 'Unknown producer'}
                          </p>
                        </div>
                        {policyChips.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {policyChips.map((chip) => (
                              <span
                                key={`${asset.assetId}-${chip}`}
                                className="inline-flex items-center rounded-full bg-violet-200/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <dl className="mt-3 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                        <div className="flex items-center justify-between gap-2">
                          <dt className="font-medium text-slate-700 dark:text-slate-200">Latest materialization</dt>
                          <dd>{latest ? formatTimestamp(latest.producedAt) : '—'}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className="font-medium text-slate-700 dark:text-slate-200">Run status</dt>
                          <dd>{latest ? <StatusBadge status={latest.runStatus} /> : '—'}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <dt className="font-medium text-slate-700 dark:text-slate-200">Partition</dt>
                          <dd>{latest?.partitionKey ?? 'Global'}</dd>
                        </div>
                        {latest?.freshness && typeof latest.freshness.ttlMs === 'number' && latest.freshness.ttlMs > 0 && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className="font-medium text-slate-700 dark:text-slate-200">TTL</dt>
                            <dd>{formatDuration(latest.freshness.ttlMs)}</dd>
                          </div>
                        )}
                        {latest?.freshness && typeof latest.freshness.maxAgeMs === 'number' && latest.freshness.maxAgeMs > 0 && (
                          <div className="flex items-center justify-between gap-2">
                            <dt className="font-medium text-slate-700 dark:text-slate-200">Max age</dt>
                            <dd>{formatDuration(latest.freshness.maxAgeMs)}</dd>
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
