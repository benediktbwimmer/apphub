import { formatTimestamp } from '../formatters';
import StatusBadge from './StatusBadge';
import type {
  WorkflowAssetDetail,
  WorkflowAssetInventoryEntry,
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
  onRefreshAssetDetail: (assetId: string) => void;
};

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
        {roles.map((role) => (
          <li
            key={`${role.stepId}-${role.stepType}`}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-slate-50/80 px-3 py-1 text-xs font-medium text-slate-600 dark:border-slate-700/70 dark:bg-slate-800/60 dark:text-slate-200"
          >
            <span className="font-semibold text-slate-700 dark:text-slate-100">{role.stepName}</span>
            <span className="uppercase tracking-wide text-slate-500 dark:text-slate-400">{role.stepType}</span>
          </li>
        ))}
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
  onRefreshAssetDetail
}: WorkflowAssetPanelProps) {
  const hasAssets = assets.length > 0;
  const hasSelection = Boolean(selectedAssetId);

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
              onClick={() => onRefreshAssetDetail(selectedAssetId)}
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

      {loading && <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Loading assets…</p>}

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
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Loading history…</p>
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
        </div>
      )}
    </section>
  );
}
