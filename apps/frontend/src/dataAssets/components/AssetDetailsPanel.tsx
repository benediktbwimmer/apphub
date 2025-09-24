import type { AssetGraphNode } from '../types';
import type { WorkflowAssetPartitions } from '../../workflows/types';
import { formatTimestamp } from '../../workflows/formatters';
import StatusBadge from '../../workflows/components/StatusBadge';

type AssetDetailsPanelProps = {
  asset: AssetGraphNode | null;
  selectedWorkflowSlug: string | null;
  onSelectWorkflow: (slug: string) => void;
  partitions: WorkflowAssetPartitions | null;
  partitionsLoading: boolean;
  partitionsError: string | null;
  onMarkStale: (partitionKey: string | null) => void;
  onClearStale: (partitionKey: string | null) => void;
  onTriggerRun: (partition: WorkflowAssetPartitions['partitions'][number]) => void;
  pendingActionKeys: Set<string>;
};

function buildActionKey(action: string, partitionKey: string | null): string {
  return `${action}:${partitionKey ?? '::default::'}`;
}

export function AssetDetailsPanel({
  asset,
  selectedWorkflowSlug,
  onSelectWorkflow,
  partitions,
  partitionsLoading,
  partitionsError,
  onMarkStale,
  onClearStale,
  onTriggerRun,
  pendingActionKeys
}: AssetDetailsPanelProps) {
  if (!asset) {
    return (
      <div className="flex h-[520px] flex-col items-center justify-center gap-2 rounded-3xl border border-slate-200/70 bg-white/80 text-sm text-slate-500 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40 dark:text-slate-300">
        <span>Select an asset from the graph to view details.</span>
      </div>
    );
  }

  const producers = asset.producers;
  const consumers = asset.consumers;
  const selectedProducer = producers.find((producer) => producer.workflowSlug === selectedWorkflowSlug);

  return (
    <div className="flex h-[520px] flex-col gap-4 overflow-hidden rounded-3xl border border-slate-200/70 bg-white/90 p-5 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/40">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">{asset.assetId}</h2>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              {asset.normalizedAssetId}
            </p>
          </div>
          {asset.hasStalePartitions && (
            <span className="inline-flex items-center rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
              Stale partitions
            </span>
          )}
        </div>

        {producers.length > 0 && (
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Producer workflow
            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              value={selectedProducer?.workflowSlug ?? producers[0]?.workflowSlug ?? ''}
              onChange={(event) => onSelectWorkflow(event.target.value)}
            >
              {producers.map((producer) => (
                <option key={producer.workflowSlug} value={producer.workflowSlug}>
                  {producer.workflowName}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto pr-1">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Producers
          </h3>
          {producers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No producing steps declared.</p>
          ) : (
            <ul className="space-y-2">
              {producers.map((producer) => (
                <li
                  key={`${producer.workflowSlug}:${producer.stepId}`}
                  className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                      {producer.workflowName}
                    </span>
                    <span className="uppercase text-xs tracking-wide text-slate-400 dark:text-slate-500">
                      {producer.stepType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{producer.stepName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Consumers
          </h3>
          {consumers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No consumers declared.</p>
          ) : (
            <ul className="space-y-2">
              {consumers.map((consumer) => (
                <li
                  key={`${consumer.workflowSlug}:${consumer.stepId}`}
                  className="rounded-xl border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-sm text-slate-600 dark:border-slate-700/60 dark:bg-slate-800/60 dark:text-slate-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-700 dark:text-slate-100">
                      {consumer.workflowName}
                    </span>
                    <span className="uppercase text-xs tracking-wide text-slate-400 dark:text-slate-500">
                      {consumer.stepType}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{consumer.stepName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Partitions
            </h3>
          </div>
          {partitionsError && (
            <p className="text-sm text-rose-600 dark:text-rose-400">{partitionsError}</p>
          )}
          {partitionsLoading && (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading partitions…</p>
          )}
          {!partitionsLoading && !partitionsError && partitions && (
            <div className="overflow-hidden rounded-xl border border-slate-200/70 dark:border-slate-700/60">
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
                      Latest Run
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Produced
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                  {partitions.partitions.map((partition) => {
                    const partitionKey = partition.partitionKey ?? null;
                    const markKey = buildActionKey('mark', partitionKey);
                    const clearKey = buildActionKey('clear', partitionKey);
                    const runKey = buildActionKey('run', partitionKey);
                    const paramsKey = buildActionKey('params', partitionKey);
                    const latest = partition.latest;
                    const parameterSourceLabel = (() => {
                      const source = partition.parametersSource;
                      if (!source) {
                        return null;
                      }
                      switch (source) {
                        case 'workflow-run':
                          return 'Parameters captured from workflow run';
                        case 'manual':
                          return 'Manually stored parameters';
                        case 'system':
                          return 'System parameters';
                        default:
                          return source;
                      }
                    })();
                    const parameterUpdatedAt = partition.parametersUpdatedAt
                      ? formatTimestamp(partition.parametersUpdatedAt)
                      : null;
                    return (
                      <tr
                        key={partitionKey ?? 'default'}
                        className={partition.isStale ? 'bg-amber-50/70 dark:bg-amber-500/10' : undefined}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-slate-700 dark:text-slate-100">
                          <div className="flex flex-col gap-1">
                            <span>{partitionKey ?? '—'}</span>
                            {parameterSourceLabel && (
                              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                                {parameterSourceLabel}
                                {parameterUpdatedAt ? ` · ${parameterUpdatedAt}` : ''}
                              </span>
                            )}
                          </div>
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
                          {latest ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <StatusBadge status={latest.runStatus} />
                                <span className="text-xs text-slate-500 dark:text-slate-400">
                                  {latest.stepName}
                                </span>
                              </div>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                Step {latest.stepStatus}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 dark:text-slate-400">No runs yet</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
                          {latest ? formatTimestamp(latest.producedAt) : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="inline-flex items-center rounded-full border border-amber-500/60 bg-amber-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-800 transition-colors hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-400/50 dark:bg-amber-500/10 dark:text-amber-200"
                              onClick={() => onMarkStale(partitionKey)}
                              disabled={partition.isStale || pendingActionKeys.has(markKey)}
                            >
                              Mark stale
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 transition-colors hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400/50 dark:bg-emerald-500/10 dark:text-emerald-200"
                              onClick={() => onClearStale(partitionKey)}
                              disabled={!partition.isStale || pendingActionKeys.has(clearKey)}
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              className="inline-flex items-center rounded-full border border-indigo-500/70 bg-indigo-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-700 transition-colors hover:bg-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:text-indigo-200"
                              onClick={() => onTriggerRun(partition)}
                              disabled={pendingActionKeys.has(runKey) || pendingActionKeys.has(paramsKey)}
                            >
                              Recompute
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
