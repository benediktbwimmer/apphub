import classNames from 'classnames';
import type { AssetGraphNode } from '../types';
import type { WorkflowAssetPartitions } from '../../workflows/types';
import { formatTimestamp } from '../../workflows/formatters';
import StatusBadge from '../../workflows/components/StatusBadge';
import { Spinner } from '../../components';
import {
  DATA_ASSET_ACTION_PILL_ACCENT,
  DATA_ASSET_ACTION_PILL_SUCCESS,
  DATA_ASSET_ACTION_PILL_WARNING,
  DATA_ASSET_ALERT_ERROR,
  DATA_ASSET_ALERT_INFO,
  DATA_ASSET_CARD,
  DATA_ASSET_DETAIL_PANEL,
  DATA_ASSET_DETAIL_SUBTITLE,
  DATA_ASSET_DETAIL_TITLE,
  DATA_ASSET_EMPTY_STATE,
  DATA_ASSET_NOTE,
  DATA_ASSET_PARTITION_META,
  DATA_ASSET_SECTION_TEXT,
  DATA_ASSET_SECTION_TITLE,
  DATA_ASSET_SELECT,
  DATA_ASSET_SELECT_LABEL,
  DATA_ASSET_STATUS_BADGE_FRESH,
  DATA_ASSET_STATUS_BADGE_REFRESH,
  DATA_ASSET_STATUS_BADGE_STALE,
  DATA_ASSET_TABLE_CELL,
  DATA_ASSET_TABLE_CONTAINER,
  DATA_ASSET_TABLE_HEADER,
  DATA_ASSET_TABLE_ROW_HIGHLIGHT
} from '../dataAssetsTokens';

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
      <div className={DATA_ASSET_EMPTY_STATE}>
        <span className="text-center">
          Select an asset from the graph to view details.
        </span>
      </div>
    );
  }

  const producers = asset.producers;
  const consumers = asset.consumers;
  const selectedProducer = producers.find((producer) => producer.workflowSlug === selectedWorkflowSlug);
  const outdatedUpstreamList = asset.outdatedUpstreamAssetIds;
  const outdatedUpstreamMessage = asset.hasOutdatedUpstreams && outdatedUpstreamList.length > 0
    ? outdatedUpstreamList.length === 1
      ? `${outdatedUpstreamList[0]} was recomputed after this asset. Trigger a recompute to refresh downstream data.`
      : `Upstream assets ${outdatedUpstreamList.join(', ')} were recomputed after this asset. Trigger a recompute to refresh downstream data.`
    : null;

  return (
    <div className={DATA_ASSET_DETAIL_PANEL}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className={DATA_ASSET_DETAIL_TITLE}>{asset.assetId}</h2>
            <p className={DATA_ASSET_DETAIL_SUBTITLE}>{asset.normalizedAssetId}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {asset.hasOutdatedUpstreams ? (
              <span className={DATA_ASSET_STATUS_BADGE_REFRESH}>Needs refresh</span>
            ) : null}
            {asset.hasStalePartitions ? (
              <span className={DATA_ASSET_STATUS_BADGE_STALE}>Stale partitions</span>
            ) : null}
          </div>
        </div>

        {outdatedUpstreamMessage ? (
          <div className={DATA_ASSET_ALERT_INFO}>{outdatedUpstreamMessage}</div>
        ) : null}

        {producers.length > 0 ? (
          <label className={DATA_ASSET_SELECT_LABEL}>
            Producer workflow
            <select
              className={DATA_ASSET_SELECT}
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
        ) : null}
      </div>

      <div className="flex flex-col gap-3 overflow-y-auto pr-1">
        <section className="space-y-2">
          <h3 className={DATA_ASSET_SECTION_TITLE}>Producers</h3>
          {producers.length === 0 ? (
            <p className={DATA_ASSET_SECTION_TEXT}>No producing steps declared.</p>
          ) : (
            <ul className="space-y-2">
              {producers.map((producer) => (
                <li
                  key={`${producer.workflowSlug}:${producer.stepId}`}
                  className={classNames(DATA_ASSET_CARD, 'px-3 py-2')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-scale-sm font-weight-semibold text-primary">
                      {producer.workflowName}
                    </span>
                    <span className="text-scale-2xs font-weight-semibold uppercase tracking-[0.28em] text-muted">
                      {producer.stepType}
                    </span>
                  </div>
                  <p className={DATA_ASSET_NOTE}>{producer.stepName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <h3 className={DATA_ASSET_SECTION_TITLE}>Consumers</h3>
          {consumers.length === 0 ? (
            <p className={DATA_ASSET_SECTION_TEXT}>No consumers declared.</p>
          ) : (
            <ul className="space-y-2">
              {consumers.map((consumer) => (
                <li
                  key={`${consumer.workflowSlug}:${consumer.stepId}`}
                  className={classNames(DATA_ASSET_CARD, 'px-3 py-2')}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-scale-sm font-weight-semibold text-primary">
                      {consumer.workflowName}
                    </span>
                    <span className="text-scale-2xs font-weight-semibold uppercase tracking-[0.28em] text-muted">
                      {consumer.stepType}
                    </span>
                  </div>
                  <p className={DATA_ASSET_NOTE}>{consumer.stepName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className={DATA_ASSET_SECTION_TITLE}>Partitions</h3>
          </div>
          {partitionsError ? <div className={DATA_ASSET_ALERT_ERROR}>{partitionsError}</div> : null}
          {partitionsLoading ? (
            <p className={DATA_ASSET_SECTION_TEXT}>
              <Spinner label="Loading partitions…" size="xs" />
            </p>
          ) : null}
          {!partitionsLoading && !partitionsError && partitions ? (
            <div className={DATA_ASSET_TABLE_CONTAINER}>
              <table className="min-w-full divide-y divide-subtle">
                <thead className="bg-surface-muted">
                  <tr>
                    <th className={DATA_ASSET_TABLE_HEADER}>Partition</th>
                    <th className={DATA_ASSET_TABLE_HEADER}>Status</th>
                    <th className={DATA_ASSET_TABLE_HEADER}>Latest Run</th>
                    <th className={DATA_ASSET_TABLE_HEADER}>Produced</th>
                    <th className={DATA_ASSET_TABLE_HEADER}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle">
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
                    const rowClassName = classNames(partition.isStale ? DATA_ASSET_TABLE_ROW_HIGHLIGHT : null);
                    return (
                      <tr key={partitionKey ?? 'default'} className={rowClassName}>
                        <td className={classNames(DATA_ASSET_TABLE_CELL, 'font-weight-semibold text-primary')}>
                          <div className="flex flex-col gap-1">
                            <span>{partitionKey ?? '—'}</span>
                            {parameterSourceLabel ? (
                              <span className={DATA_ASSET_PARTITION_META}>
                                {parameterSourceLabel}
                                {parameterUpdatedAt ? ` · ${parameterUpdatedAt}` : ''}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className={DATA_ASSET_TABLE_CELL}>
                          {partition.isStale ? (
                            <div className="flex flex-col gap-1">
                              <span className={DATA_ASSET_STATUS_BADGE_STALE}>Stale</span>
                              {partition.staleMetadata ? (
                                <span className={DATA_ASSET_PARTITION_META}>
                                  Since {formatTimestamp(partition.staleMetadata.requestedAt)}
                                  {partition.staleMetadata.note
                                    ? ` · ${partition.staleMetadata.note}`
                                    : partition.staleMetadata.requestedBy
                                    ? ` · ${partition.staleMetadata.requestedBy}`
                                    : ''}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className={DATA_ASSET_STATUS_BADGE_FRESH}>Fresh</span>
                          )}
                        </td>
                        <td className={DATA_ASSET_TABLE_CELL}>
                          {latest ? (
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <StatusBadge status={latest.runStatus} />
                                <span className={DATA_ASSET_PARTITION_META}>{latest.stepName}</span>
                              </div>
                              <span className={DATA_ASSET_PARTITION_META}>Step {latest.stepStatus}</span>
                            </div>
                          ) : (
                            <span className={DATA_ASSET_PARTITION_META}>No runs yet</span>
                          )}
                        </td>
                        <td className={DATA_ASSET_TABLE_CELL}>
                          {latest ? formatTimestamp(latest.producedAt) : '—'}
                        </td>
                        <td className={classNames(DATA_ASSET_TABLE_CELL, 'text-scale-2xs')}>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={DATA_ASSET_ACTION_PILL_WARNING}
                              onClick={() => onMarkStale(partitionKey)}
                              disabled={partition.isStale || pendingActionKeys.has(markKey)}
                            >
                              Mark stale
                            </button>
                            <button
                              type="button"
                              className={DATA_ASSET_ACTION_PILL_SUCCESS}
                              onClick={() => onClearStale(partitionKey)}
                              disabled={!partition.isStale || pendingActionKeys.has(clearKey)}
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              className={DATA_ASSET_ACTION_PILL_ACCENT}
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
          ) : null}
        </section>
      </div>
    </div>
  );
}
