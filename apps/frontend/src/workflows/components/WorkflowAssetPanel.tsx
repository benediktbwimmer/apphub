import { useCallback } from 'react';
import { Spinner } from '../../components';
import { formatDuration, formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
  WorkflowAssetPartitions,
  WorkflowAssetRoleDescriptor
} from '../types';

type WorkflowAssetPanelProps = {
  assets: WorkflowAssetInventoryEntry[];
  loading: boolean;
  error: string | null;
  selectedAssetId: string | null;
  onSelectAsset: (assetId: string) => void;
  onClearSelection: () => void;
  assetDetail: WorkflowAssetDetail | null;
  assetDetailLoading: boolean;
  assetDetailError: string | null;
  assetPartitions: WorkflowAssetPartitions | null;
  assetPartitionsLoading: boolean;
  assetPartitionsError: string | null;
  onRefreshAssetDetail: (assetId: string) => void;
};

function summarizePartitioning(partitioning: WorkflowAssetRoleDescriptor['partitioning']) {
  if (!partitioning) {
    return null;
  }
  if (partitioning.type === 'timeWindow') {
    const bits: string[] = [`Time window (${partitioning.granularity})`];
    if (partitioning.timezone) {
      bits.push(`TZ ${partitioning.timezone}`);
    }
    if (typeof partitioning.lookbackWindows === 'number' && partitioning.lookbackWindows > 0) {
      bits.push(`Lookback ${partitioning.lookbackWindows}`);
    }
    return bits.join(' • ');
  }
  if (partitioning.type === 'static') {
    return `Static (${partitioning.keys.length} keys)`;
  }
  if (partitioning.type === 'dynamic') {
    const bits: string[] = ['Dynamic'];
    if (typeof partitioning.maxKeys === 'number' && partitioning.maxKeys > 0) {
      bits.push(`max ${partitioning.maxKeys}`);
    }
    if (typeof partitioning.retentionDays === 'number' && partitioning.retentionDays > 0) {
      bits.push(`retention ${partitioning.retentionDays}d`);
    }
    return bits.join(' • ');
  }
  return null;
}

function buildRoleMetadataChips(role: WorkflowAssetRoleDescriptor) {
  const chips: string[] = [];
  const { freshness, autoMaterialize, partitioning } = role;
  if (freshness) {
    if (typeof freshness.ttlMs === 'number' && freshness.ttlMs > 0) {
      chips.push(`TTL ${formatDuration(freshness.ttlMs)}`);
    }
    if (typeof freshness.cadenceMs === 'number' && freshness.cadenceMs > 0) {
      chips.push(`Cadence ${formatDuration(freshness.cadenceMs)}`);
    }
    if (typeof freshness.maxAgeMs === 'number' && freshness.maxAgeMs > 0) {
      chips.push(`Max age ${formatDuration(freshness.maxAgeMs)}`);
    }
  }
  if (autoMaterialize) {
    if (autoMaterialize.onUpstreamUpdate) {
      chips.push('Auto on upstream update');
    }
    if (typeof autoMaterialize.priority === 'number') {
      chips.push(`Priority ${autoMaterialize.priority}`);
    }
  }
  const partitioningSummary = summarizePartitioning(partitioning);
  if (partitioningSummary) {
    chips.push(partitioningSummary);
  }
  return chips;
}

function renderRoleList(label: string, roles: WorkflowAssetRoleDescriptor[]) {
  if (roles.length === 0) {
    return (
      <li className="text-sm text-slate-500 dark:text-slate-400">
        {label}: none declared
      </li>
    );
  }
  return (
    <li className="text-sm text-slate-600 dark:text-slate-300">
      <span className="font-semibold text-slate-700 dark:text-slate-200">{label}:</span>
      <ul className="mt-1 flex flex-wrap gap-2 pl-0">
        {roles.map((role) => {
          const metadataChips = buildRoleMetadataChips(role);
          return (
            <li
              key={`${role.stepId}-${role.stepType}`}
              className="inline-flex min-w-[200px] max-w-full flex-col gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-200"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-100">{role.stepName}</span>
                <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">{role.stepType}</span>
              </div>
              {metadataChips.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {metadataChips.map((chip) => (
                    <span
                      key={`${role.stepId}-${chip}`}
                      className="inline-flex items-center rounded-full bg-slate-200/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-700/70 dark:text-slate-200"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export default function WorkflowAssetPanel({
  assets,
  loading,
  error,
  selectedAssetId,
  onSelectAsset,
  onClearSelection,
  assetDetail,
  assetDetailLoading,
  assetDetailError,
  assetPartitions,
  assetPartitionsLoading,
  assetPartitionsError,
  onRefreshAssetDetail
}: WorkflowAssetPanelProps) {
  const hasAssets = assets.length > 0;
  const hasSelection = Boolean(selectedAssetId);
  const handleRefreshAssetDetail = useCallback(() => {
    if (!selectedAssetId) {
      return;
    }
    onRefreshAssetDetail(selectedAssetId);
  }, [onRefreshAssetDetail, selectedAssetId]);

  return (
    <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-[0_30px_70px_-45px_rgba(15,23,42,0.65)] backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-200">Asset Inventory</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Discover the producers, consumers, and freshness of workflow data assets.
          </p>
        </div>
        {hasSelection && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              onClick={handleRefreshAssetDetail}
            >
              Refresh history
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200/60 bg-white/70 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 dark:border-slate-700/60 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800"
              onClick={onClearSelection}
            >
              Clear selection
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400">{error}</p>
      )}

      {loading && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          <Spinner label="Loading assets…" size="xs" />
        </p>
      )}

      {!loading && !error && !hasAssets && (
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">No assets declared for this workflow.</p>
      )}

      {!loading && !error && hasAssets && (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200/60 dark:border-slate-700/60">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
            <thead className="bg-slate-50/80 dark:bg-slate-800/80">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Asset
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Producers
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Consumers
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Partition
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Latest Snapshot
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {assets.map((asset) => {
                const isSelected = asset.assetId === selectedAssetId;
                const latest = asset.latest;
                return (
                  <tr
                    key={asset.assetId}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-violet-500/5 dark:bg-violet-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/70'
                    }`}
                    onClick={() => onSelectAsset(asset.assetId)}
                  >
                    <td className="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-100">
                      {asset.assetId}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {asset.producers.length > 0 ? asset.producers.map((role) => role.stepName).join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {asset.consumers.length > 0 ? asset.consumers.map((role) => role.stepName).join(', ') : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {latest?.partitionKey ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                      {latest ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <StatusBadge status={latest.runStatus} />
                            <span className="text-xs text-slate-500 dark:text-slate-400">{latest.stepName}</span>
                          </div>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Produced {formatTimestamp(latest.producedAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-400">No runs yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {hasSelection && (
        <div className="mt-6 rounded-2xl border border-slate-200/60 bg-white/70 p-5 dark:border-slate-700/60 dark:bg-slate-900/40">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Asset history · {selectedAssetId}
          </h3>
          {assetDetailError && (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{assetDetailError}</p>
          )}
          {assetDetailLoading && (
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              <Spinner label="Loading history…" size="xs" />
            </p>
          )}
          {!assetDetailLoading && !assetDetailError && assetDetail && (
            <div className="mt-3 space-y-4">
              <ul className="space-y-2">
                {renderRoleList('Producers', assetDetail.producers)}
                {renderRoleList('Consumers', assetDetail.consumers)}
              </ul>

              {assetDetail.history.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">No production history yet.</p>
              ) : (
                <div className="overflow-hidden rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                  <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                    <thead className="bg-slate-50/80 dark:bg-slate-800/80">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Produced
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Run Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Step
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Partition
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          Step Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {assetDetail.history.map((entry) => (
                        <tr key={`${entry.runId}-${entry.stepId}-${entry.producedAt}`}>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {formatTimestamp(entry.producedAt)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <StatusBadge status={entry.runStatus} />
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {entry.stepName}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {entry.partitionKey ?? '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                            {entry.stepStatus}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-slate-200/60 pt-4 dark:border-slate-700/60">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Partitions
            </h4>
            {assetPartitionsError && (
              <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{assetPartitionsError}</p>
            )}
            {assetPartitionsLoading && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                <Spinner label="Loading partitions…" size="xs" />
              </p>
            )}
            {!assetPartitionsLoading && !assetPartitionsError && assetPartitions && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {summarizePartitioning(assetPartitions.partitioning) ?? 'No partitioning declared.'}
                </p>
                {assetPartitions.partitions.length === 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    No partition materializations yet.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-xl border border-slate-200/60 dark:border-slate-700/60">
                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                      <thead className="bg-slate-50/80 dark:bg-slate-800/80">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Partition
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Status
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Materializations
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Latest Run
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Produced
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                        {assetPartitions.partitions.map((partition) => (
                          <tr
                            key={partition.partitionKey ?? 'default'}
                            className={partition.isStale ? 'bg-amber-50/70 dark:bg-amber-500/10' : undefined}
                          >
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {partition.partitionKey ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {partition.isStale ? (
                                <div className="flex flex-col gap-1">
                                  <span className="inline-flex w-fit items-center rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                                    Stale
                                  </span>
                                  {partition.staleMetadata && (
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      Since {formatTimestamp(partition.staleMetadata.requestedAt)}
                                      {partition.staleMetadata.note
                                        ? ` · ${partition.staleMetadata.note}`
                                        : partition.staleMetadata.requestedBy
                                        ? ` · ${partition.staleMetadata.requestedBy}`
                                        : ''}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">Fresh</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {partition.materializations}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {partition.latest ? (
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-2">
                                    <StatusBadge status={partition.latest.runStatus} />
                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                      {partition.latest.stepName}
                                    </span>
                                  </div>
                                  <span className="text-xs text-slate-500 dark:text-slate-400">
                                    Step {partition.latest.stepStatus}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-slate-500 dark:text-slate-400">No runs yet</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                              {partition.latest ? formatTimestamp(partition.latest.producedAt) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {!assetPartitionsLoading && !assetPartitionsError && !assetPartitions && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                This asset has no recorded partition metadata.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
